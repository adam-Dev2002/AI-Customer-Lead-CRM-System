// Runs alongside n8n inside the existing Docker container. All requests to the
// public CRM are outbound. Only fixed setup operations are accepted.
import { createHash, randomUUID } from 'node:crypto';
import { importCredential } from './credential-importer.mjs';

export const canonicalJSON = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item);
export const workflowDigest = workflow => createHash('sha256').update(canonicalJSON({ nodes: workflow.nodes, connections: workflow.connections })).digest('hex');
export class WorkerError extends Error {
  constructor(code, uncertain = false) { super(code); this.code = code; this.uncertain = uncertain; }
}
export function validateWorkerConfig(value) {
  const crm = new URL(value.crmOrigin), local = new URL(value.n8nOrigin);
  if (crm.protocol !== 'https:' || crm.username || crm.password || crm.pathname !== '/' || crm.search || crm.hash) throw new WorkerError('invalid-config');
  if (local.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(local.hostname) || local.pathname !== '/' || local.username || local.password || local.search || local.hash) throw new WorkerError('invalid-config');
  if (!/^[\w-]{8,64}$/.test(value.workerId || '') || (value.workerKey?.length || 0) < 32 || !value.apiKey || !/^[\w-]{1,64}$/.test(value.projectId || '') || !/^[\w-]{1,80}$/.test(value.geminiCredentialId || '')) throw new WorkerError('invalid-config');
  return { ...value, crmOrigin: crm.origin, n8nOrigin: local.origin };
}
async function jsonRequest(url, init, mutation, request) {
  try {
    const response = await request(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new WorkerError('provider-unavailable', mutation && (response.status >= 500 || [408, 409].includes(response.status)));
    return await response.json().catch(() => { throw new WorkerError('provider-unavailable', mutation); });
  } catch (error) { if (error instanceof WorkerError) throw error; throw new WorkerError('provider-unavailable', mutation); }
}
export function workerClients(config, request = fetch) {
  return {
    post(body) { return jsonRequest(config.crmOrigin + '/api/n8n/onboarding', { method: 'POST', headers: { Authorization: 'Bearer ' + config.workerKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, workerId: config.workerId }) }, false, request); },
    n8n(resource, body, method, idempotencyKey) {
      const verb = method || (body ? 'POST' : 'GET');
      return jsonRequest(config.n8nOrigin + '/api/v1' + resource, { method: verb, headers: { 'X-N8N-API-KEY': config.apiKey, 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) }, body: body ? JSON.stringify(body) : undefined }, verb !== 'GET', request);
    },
  };
}
export async function localWorkerReady(clients, config) {
  try {
    const credential = await clients.n8n('/credentials/' + encodeURIComponent(config.geminiCredentialId));
    return credential.id === config.geminiCredentialId && credential.type === 'httpHeaderAuth';
  } catch { return false; }
}
function checkedId(value) {
  if (typeof value !== 'string' || !/^[\w-]{1,80}$/.test(value)) throw new WorkerError('verification-failed', true);
  return value;
}
export async function executeWorkerJob(job, config, clients, dependencies = {}) {
  const { payload = {}, operation, workspaceId } = job;
  if (!/^[a-f0-9-]{36}$/.test(workspaceId || '') || workspaceId === 'clearflow' || job.status !== 'Claimed') throw new WorkerError('verification-failed');
  if (operation === 'gmail-credential' || operation === 'sheets-credential') {
    const expected = operation === 'gmail-credential' ? 'gmailOAuth2' : 'googleSheetsOAuth2Api';
    if (payload.credential?.type !== expected) throw new WorkerError('verification-failed');
    try {
      const imported = await importCredential(payload, { directory: config.receiptDirectory, projectId: config.projectId, ...(dependencies.importExecute ? { execute: dependencies.importExecute } : {}) });
      return { status: 'Succeeded', id: checkedId(imported.id) };
    } catch { throw new WorkerError('provider-unavailable', true); }
  }
  if (operation === 'crm-credential') {
    if (payload.type !== 'httpHeaderAuth' || payload.data?.name !== 'Authorization' || !/^Bearer clw_[\w-]{43}$/.test(payload.data?.value || '')) throw new WorkerError('verification-failed');
    const id = createHash('sha256').update('crm-credential:' + job.id).digest('hex').slice(0, 16);
    const credential = await clients.n8n('/credentials', { id, projectId: config.projectId, name: 'CustomerLead ' + workspaceId + ' CRM', type: 'httpHeaderAuth', data: { name: 'Authorization', value: payload.data.value } });
    return { status: 'Succeeded', id: checkedId(credential.id) };
  }
  if (operation === 'workflow') {
    const workflow = payload.workflow;
    if (workflow?.name !== 'CustomerLead business ' + workspaceId || workflow.nodes?.filter(n => n.type.endsWith('.scheduleTrigger')).length !== 4) throw new WorkerError('verification-failed');
    const saved = await clients.n8n('/workflows', workflow, undefined, 'customerlead-setup-' + job.id);
    if (saved.active || saved.activeVersionId) throw new WorkerError('verification-failed', true);
    return { status: 'Succeeded', id: checkedId(saved.id) };
  }
  if (!['verify', 'enable', 'pause'].includes(operation) || !/^[a-f0-9]{64}$/.test(payload.graphHash || '')) throw new WorkerError('verification-failed');
  const id = checkedId(payload.workflowId), saved = await clients.n8n('/workflows/' + id);
  if (saved.name !== 'CustomerLead business ' + workspaceId) throw new WorkerError('verification-failed');
  if (operation !== 'pause' && workflowDigest(saved) !== payload.graphHash) throw new WorkerError('verification-failed');
  if (operation === 'verify') {
    if (saved.active || saved.activeVersionId) throw new WorkerError('verification-failed');
    return { status: 'Succeeded', verified: true };
  }
  const enable = operation === 'enable';
  await clients.n8n(`/workflows/${id}/${enable ? 'activate' : 'deactivate'}`, {}, 'POST');
  const result = await clients.n8n('/workflows/' + id);
  if (Boolean(result.active || result.activeVersionId) !== enable) throw new WorkerError('verification-failed', true);
  return { status: 'Succeeded', active: enable };
}
// The journal is saved before execution and after its result. Lost callbacks
// retry the result only. Restarting during a mutation reports Uncertain; it
// never repeats credential creation or workflow activation automatically.
export async function runWorkerOnce(config, clients, journal, execute = executeWorkerJob) {
  let saved = await journal.read();
  if (!saved) { saved = { phase: 'claiming', claimId: randomUUID() }; await journal.write(saved); }
  if (saved.phase === 'claiming') {
    const result = await clients.post({ action: 'claim', claimId: saved.claimId });
    if (!result.job || result.job.status !== 'Claimed') { await journal.clear(); return 'idle'; }
    saved = { ...saved, phase: 'claimed', job: result.job }; await journal.write(saved);
  } else if (saved.phase === 'executing') {
    saved = { ...saved, phase: 'result', result: { status: 'Uncertain', code: 'uncertain-result' } }; await journal.write(saved);
  }
  if (saved.phase === 'claimed') {
    saved = { ...saved, phase: 'executing' }; await journal.write(saved);
    let result;
    try { result = await execute(saved.job, config, clients); }
    catch (error) { result = { status: error instanceof WorkerError && !error.uncertain ? 'Failed' : 'Uncertain', code: error?.code === 'verification-failed' ? 'verification-failed' : 'provider-unavailable' }; }
    saved = { ...saved, phase: 'result', result }; await journal.write(saved);
  }
  if (saved.phase !== 'result') throw new WorkerError('invalid-journal');
  const response = await clients.post({ action: 'complete', claimId: saved.claimId, jobId: saved.job.id, result: saved.result });
  if (response.accepted !== true) throw new WorkerError('callback-unconfirmed');
  await journal.clear(); return saved.result.status;
}
