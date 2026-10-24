import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { cloudRPC } from '../crm/cloud-store.ts';
import { ConnectionError, openConnection, sealConnection, type ConnectionConfig } from './config.ts';
import { connectionRepository, type BusinessConnection, type ConnectionRecord } from './store.ts';

export const workerOperations = ['gmail-credential', 'sheets-credential', 'crm-credential', 'workflow', 'verify', 'enable', 'pause'] as const;
export type WorkerOperation = typeof workerOperations[number];
export const canonicalJSON = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item);
export const workflowDigest = (workflow: { nodes: unknown; connections: unknown }) => createHash('sha256').update(canonicalJSON({ nodes: workflow.nodes, connections: workflow.connections })).digest('hex');
export function workerAuthorized(header: string | null, config: ConnectionConfig) {
  if (config.mode !== 'pull' || config.workerKey.length < 32) return false;
  const expected = Buffer.from('Bearer ' + config.workerKey), given = Buffer.from(header || '');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
export async function workerReady(config: ConnectionConfig) {
  return await cloudRPC('crm_onboarding_worker_ready', { p_worker_id: config.workerId }) === true;
}
export async function enqueueConnectionJob(workspace: string, record: ConnectionRecord, data: BusinessConnection, operation: WorkerOperation, payload: Record<string, unknown>, config: ConnectionConfig) {
  if (workspace === 'clearflow' || !record.data || record.data.pending) throw new ConnectionError('connection-busy');
  const id = randomUUID();
  const pending = { ...data, pending: { operation, startedAt: new Date().toISOString(), jobId: id }, error: undefined };
  const result = await cloudRPC('crm_connection_enqueue', { p_workspace_id: workspace, p_revision: record.revision, p_payload: sealConnection(pending, workspace, config.encryptionKey), p_job_id: id, p_operation: operation, p_job_payload: sealConnection(payload, workspace, config.encryptionKey) });
  if (!result?.applied) throw new ConnectionError('connection-busy');
  return { revision: result.revision, data: pending };
}
export function validatedWorkerResult(operation: string, value: unknown) {
  if (!workerOperations.includes(operation as WorkerOperation) || !value || typeof value !== 'object') throw new ConnectionError('verification-failed');
  const raw = value as Record<string, unknown>;
  if (raw.status === 'Failed' || raw.status === 'Uncertain') return { status: raw.status, code: raw.code === 'verification-failed' ? 'verification-failed' : raw.status === 'Uncertain' ? 'uncertain-result' : 'provider-unavailable' };
  if (raw.status !== 'Succeeded') throw new ConnectionError('verification-failed');
  if (operation.includes('credential') || operation === 'workflow') {
    if (typeof raw.id !== 'string' || !/^[\w-]{1,80}$/.test(raw.id)) throw new ConnectionError('verification-failed');
    return { status: 'Succeeded', id: raw.id };
  }
  if (operation === 'verify' && raw.verified === true) return { status: 'Succeeded', verified: true };
  if ((operation === 'enable' && raw.active === true) || (operation === 'pause' && raw.active === false)) return { status: 'Succeeded', active: raw.active };
  throw new ConnectionError('verification-failed');
}
export function applyWorkerResult(data: BusinessConnection, operation: string, result: ReturnType<typeof validatedWorkerResult>): BusinessConnection {
  const updated = structuredClone(data);
  if (result.status !== 'Succeeded') {
    updated.phase = 'attention'; updated.error = result.code;
    if (result.status === 'Failed') delete updated.pending;
    return updated;
  }
  const fields: Record<string, 'gmailCredentialId' | 'sheetsCredentialId' | 'crmCredentialId' | 'workflowId'> = { 'gmail-credential': 'gmailCredentialId', 'sheets-credential': 'sheetsCredentialId', 'crm-credential': 'crmCredentialId', workflow: 'workflowId' };
  if (fields[operation] && 'id' in result) updated[fields[operation]] = result.id;
  if (operation === 'verify') { updated.verifiedAt = new Date().toISOString(); updated.phase = 'ready'; }
  if (operation === 'enable') updated.phase = 'active';
  if (operation === 'pause') updated.phase = 'paused';
  delete updated.pending; delete updated.error;
  return updated;
}
export async function finishConnectionJob(jobId: string, claimId: string, resultValue: unknown, config: ConnectionConfig) {
  const job = await cloudRPC('crm_connection_job_read', { p_job_id: jobId, p_worker_id: config.workerId, p_claim_id: claimId });
  if (!job) throw new ConnectionError('verification-failed');
  const result = validatedWorkerResult(job.operation, resultValue), resultHash = createHash('sha256').update(canonicalJSON(result)).digest('hex');
  if (job.status !== 'Claimed') {
    if (job.status === result.status && job.result_hash === resultHash) return { accepted: true, duplicate: true };
    throw new ConnectionError('verification-failed');
  }
  const record = await connectionRepository(job.workspace_id, config).read();
  if (!record.data || record.data.pending?.jobId !== jobId) throw new ConnectionError('verification-failed');
  const updated = applyWorkerResult(record.data, job.operation, result);
  const saved = await cloudRPC('crm_connection_job_finish', { p_job_id: jobId, p_worker_id: config.workerId, p_claim_id: claimId, p_result_hash: resultHash, p_status: result.status, p_revision: record.revision, p_payload: sealConnection(updated, job.workspace_id, config.encryptionKey) });
  if (!saved?.applied) throw new ConnectionError('connection-busy');
  return { accepted: true, duplicate: Boolean(saved.duplicate) };
}
export async function claimConnectionJob(claimId: string, config: ConnectionConfig) {
  const job = await cloudRPC('crm_connection_job_claim', { p_worker_id: config.workerId, p_claim_id: claimId });
  if (!job) return null;
  return { id: job.id, workspaceId: job.workspace_id, operation: job.operation, status: job.status, payload: job.status === 'Claimed' ? openConnection<Record<string, unknown>>(job.payload, job.workspace_id, config.encryptionKey) : null };
}
