import { createHash, randomBytes } from 'node:crypto';
import { cloudRPC } from '../crm/cloud-store.ts';
import { ConnectionError, type ConnectionConfig } from './config.ts';
import { businessLabels, googleJSON, googleMailbox, refreshGoogleToken, remoteJSON } from './google.ts';
import { nextConnectionStep, type BusinessConnection, type ConnectionRecord, type ConnectionRepository } from './store.ts';
import { businessFormId, leadHeaders, reviewHeaders, provisionedWorkflow } from './workflow.ts';
import { enqueueConnectionJob, workerOperations, workerReady, workflowDigest, type WorkerOperation } from './pull.ts';

export async function n8nJSON(config: ConnectionConfig, resource: string, body?: unknown, method?: string, request: typeof fetch = fetch) {
  try { return await remoteJSON(config.n8nOrigin + '/api/v1' + resource, { method: method || (body ? 'POST' : 'GET'), headers: { 'X-N8N-API-KEY': config.apiKey, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }, method === 'POST' || Boolean(body), request); }
  catch (error) { if (error instanceof ConnectionError && error.code === 'google-reconnect') throw new ConnectionError('setup-unavailable'); throw error; }
}
export async function connectionPreflight(config: ConnectionConfig, request: typeof fetch = fetch) {
  if (config.mode === 'pull') {
    if (!await workerReady(config)) throw new ConnectionError('worker-offline');
    return;
  }
  const helper = await remoteJSON(config.n8nOrigin + '/customerlead-setup/health', { headers: { 'X-CustomerLead-Setup-Key': config.setupKey } }, false, request);
  if (helper.ready !== true || helper.version !== 1) throw new ConnectionError('setup-unavailable');
  const gemini = await n8nJSON(config, '/credentials/' + encodeURIComponent(config.geminiCredentialId), undefined, undefined, request);
  if (gemini.id !== config.geminiCredentialId || gemini.type !== 'httpHeaderAuth') throw new ConnectionError('setup-unavailable');
}
export function googleCredential(data: BusinessConnection, config: ConnectionConfig, type: 'gmailOAuth2' | 'googleSheetsOAuth2Api') {
  const token = data.google!;
  return { name: 'CustomerLead ' + data.id + (type === 'gmailOAuth2' ? ' Gmail' : ' Sheets'), type, data: { clientId: config.clientId, clientSecret: config.clientSecret, customScopes: true, enabledScopes: token.scope, scope: token.scope, oauthTokenData: { access_token: token.access_token, refresh_token: token.refresh_token, token_type: 'Bearer', scope: token.scope, expires_at: new Date(token.expires_at).toISOString(), expires_in: Math.max(1, Math.floor((token.expires_at - Date.now()) / 1000)) } } };
}
const canonical = (value: unknown): string => JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry) ? Object.fromEntries(Object.keys(entry).sort().map(k => [k, entry[k]])) : entry);
function credentialId(result: { id?: unknown }) {
  if (typeof result.id !== 'string' || !/^[\w-]+$/.test(result.id)) throw new ConnectionError('uncertain-result');
  return result.id;
}
function spreadsheetBody(name: string) {
  return { properties: { title: name.slice(0, 100) + ' — CustomerLead' }, sheets: [['Leads', leadHeaders], ['ReplyReviews', reviewHeaders]].map(([title, fields], index) => ({ properties: { sheetId: index, title, gridProperties: { frozenRowCount: 1 } }, data: [{ startRow: 0, rowData: [{ values: (fields as string[]).map(value => ({ userEnteredValue: { stringValue: value } })) }] }] })) };
}
export interface ProvisionDependencies { request?: typeof fetch; register?: (workspace: string, hash: string) => Promise<boolean> }
export async function advanceConnection(repo: ConnectionRepository, workspace: string, config: ConnectionConfig, deps: ProvisionDependencies = {}) {
  let record = await repo.read();
  if (!record.data?.google || !record.data.email) throw new ConnectionError('not-ready');
  if (record.data.pending) throw new ConnectionError(Date.now() - Date.parse(record.data.pending.startedAt) > 120000 ? 'uncertain-result' : 'connection-busy');
  const step = nextConnectionStep(record.data);
  if (step === 'complete') return record;
  if (config.mode === 'pull' && workerOperations.includes(step as WorkerOperation)) {
    let data = { ...record.data };
    if (data.google!.expires_at < Date.now() + 60000) {
      data.google = await refreshGoogleToken(config, data.google!, deps.request || fetch);
      record = await repo.save(record, data);
    }
    let payload: Record<string, unknown>;
    if (step === 'gmail-credential' || step === 'sheets-credential') payload = { requestId: data.id + (step === 'gmail-credential' ? ':gmail' : ':sheets'), credential: googleCredential(data, config, step === 'gmail-credential' ? 'gmailOAuth2' : 'googleSheetsOAuth2Api') };
    else if (step === 'crm-credential') {
      data.crmToken ||= 'clw_' + randomBytes(32).toString('base64url');
      payload = { name: 'CustomerLead ' + data.id + ' CRM', type: 'httpHeaderAuth', data: { name: 'Authorization', value: 'Bearer ' + data.crmToken } };
    } else if (step === 'workflow') {
      data.formId = businessFormId(workspace);
      payload = { workflow: provisionedWorkflow(data, workspace, config) };
    } else if (step === 'verify') {
      const request = deps.request || fetch;
      if (await googleMailbox(data.google!, request) !== data.email) throw new ConnectionError('verification-failed');
      const sheet = await googleJSON(data.google!, `https://sheets.googleapis.com/v4/spreadsheets/${data.spreadsheetId}?fields=spreadsheetId,sheets(properties(title))`, undefined, undefined, request);
      if (sheet.spreadsheetId !== data.spreadsheetId || !['Leads', 'ReplyReviews'].every(name => sheet.sheets?.some((s: { properties?: { title?: string } }) => s.properties?.title === name))) throw new ConnectionError('verification-failed');
      payload = { workflowId: data.workflowId, graphHash: workflowDigest(provisionedWorkflow(data, workspace, config)) };
    } else throw new ConnectionError('not-ready');
    return enqueueConnectionJob(workspace, record, { ...data, phase: 'setting-up' }, step as WorkerOperation, payload, config);
  }
  // A durable claim precedes each external side effect. A process crash leaves
  // the claim intact; a second request cannot recreate resources or send mail.
  record = await repo.save(record, { ...record.data, phase: 'setting-up', error: undefined, pending: { operation: step, startedAt: new Date().toISOString() }, ...(step === 'crm-credential' && !record.data.crmToken ? { crmToken: 'clw_' + randomBytes(32).toString('base64url') } : {}) });
  const data = { ...record.data! }, request = deps.request || fetch;
  try {
    if (data.google!.expires_at < Date.now() + 60000) {
      data.google = await refreshGoogleToken(config, data.google!, request);
      record = await repo.save(record, data);
    }
    const token = data.google!;
    if (step === 'labels') {
      const labels = await googleJSON(token, 'https://gmail.googleapis.com/gmail/v1/users/me/labels', undefined, undefined, request);
      if (!Array.isArray(labels.labels)) throw new ConnectionError('verification-failed');
      // Label creation is recoverable by name, but an uncertain response still
      // stops this claim for operator review rather than blindly repeating it.
      for (const name of businessLabels) if (!labels.labels.some((l: { name: string }) => l.name === name)) await googleJSON(token, 'https://gmail.googleapis.com/gmail/v1/users/me/labels', { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' }, undefined, request);
      data.labelsReady = true;
    } else if (step === 'spreadsheet') {
      const sheet = await googleJSON(token, 'https://sheets.googleapis.com/v4/spreadsheets', spreadsheetBody(data.businessName), undefined, request);
      if (typeof sheet.spreadsheetId !== 'string' || !/^[\w-]{20,}$/.test(sheet.spreadsheetId)) throw new ConnectionError('uncertain-result');
      data.spreadsheetId = sheet.spreadsheetId;
    } else if (step === 'gmail-credential' || step === 'sheets-credential') {
      const gmail = step === 'gmail-credential';
      // Public n8n credential schemas exclude hidden oauthTokenData. The hosted
      // operator helper imports a new fixed credential using the supported CLI.
      const credential = await remoteJSON(config.n8nOrigin + '/customerlead-setup/credentials', { method: 'POST', headers: { 'X-CustomerLead-Setup-Key': config.setupKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: data.id + (gmail ? ':gmail' : ':sheets'), credential: googleCredential(data, config, gmail ? 'gmailOAuth2' : 'googleSheetsOAuth2Api') }) }, true, request, 45000);
      if (gmail) data.gmailCredentialId = credentialId(credential); else data.sheetsCredentialId = credentialId(credential);
    } else if (step === 'crm-credential') {
      data.crmCredentialId = credentialId(await n8nJSON(config, '/credentials', { name: 'CustomerLead ' + data.id + ' CRM', type: 'httpHeaderAuth', data: { name: 'Authorization', value: 'Bearer ' + data.crmToken } }, undefined, request));
    } else if (step === 'register') {
      const hash = createHash('sha256').update(data.crmToken!).digest('hex');
      const registered = await (deps.register ? deps.register(workspace, hash) : cloudRPC('crm_connection_register', { p_workspace_id: workspace, p_token_hash: hash }));
      if (registered !== true) throw new ConnectionError('existing-connection');
      data.tokenRegistered = true;
    } else if (step === 'workflow') {
      const workflow = await n8nJSON(config, '/workflows', provisionedWorkflow(data, workspace, config), undefined, request);
      data.workflowId = credentialId(workflow); data.formId = businessFormId(workspace);
      if (workflow.active || workflow.activeVersionId) throw new ConnectionError('uncertain-result');
    } else if (step === 'verify') {
      const email = await googleMailbox(token, request);
      if (email !== data.email) throw new ConnectionError('verification-failed');
      const sheet = await googleJSON(token, `https://sheets.googleapis.com/v4/spreadsheets/${data.spreadsheetId}?fields=spreadsheetId,sheets(properties(title))`, undefined, undefined, request);
      if (sheet.spreadsheetId !== data.spreadsheetId || !['Leads', 'ReplyReviews'].every(name => sheet.sheets?.some((s: { properties?: { title?: string } }) => s.properties?.title === name))) throw new ConnectionError('verification-failed');
      const workflow = await n8nJSON(config, '/workflows/' + data.workflowId, undefined, undefined, request);
      const expected = provisionedWorkflow(data, workspace, config);
      if (workflow.active || workflow.activeVersionId || canonical(workflow.nodes) !== canonical(expected.nodes) || canonical(workflow.connections) !== canonical(expected.connections)) throw new ConnectionError('verification-failed');
      data.verifiedAt = new Date().toISOString(); data.phase = 'ready';
    }
    delete data.pending; delete data.error;
    return await repo.save(record, data);
  } catch (error) {
    const code = error instanceof ConnectionError ? error.code : 'uncertain-result';
    // Preserve the durable claim after any uncertain mutation/commit. This
    // blocks automatic retries; known rejected requests remain retryable.
    try { await repo.save(record, { ...record.data!, phase: 'attention', error: code, pending: code === 'uncertain-result' || code === 'connection-busy' ? record.data!.pending : undefined }); } catch { /* Original claim still prevents duplicate work. */ }
    throw new ConnectionError(code);
  }
}
export async function setProcessing(repo: ConnectionRepository, workspace: string, config: ConnectionConfig, enable: boolean, request: typeof fetch = fetch) {
  let record = await repo.read(), data = record.data;
  if (!data?.workflowId || !data.verifiedAt || data.pending) throw new ConnectionError('not-ready');
  if (!['ready', 'paused', 'active'].includes(data.phase)) throw new ConnectionError('not-ready');
  if ((enable && data.phase === 'active') || (!enable && data.phase === 'paused')) return record;
  if (enable && data.google && data.google.expires_at < Date.now() + 60000) {
    data = { ...data, google: await refreshGoogleToken(config, data.google, request) };
    record = await repo.save(record, data);
  }
  if (config.mode === 'pull') {
    if (enable && await googleMailbox(data.google!, request) !== data.email) throw new ConnectionError('verification-failed');
    return enqueueConnectionJob(workspace, record, data, enable ? 'enable' : 'pause', { workflowId: data.workflowId, graphHash: workflowDigest(provisionedWorkflow(data, workspace, config)) }, config);
  }
  if (enable) {
    const saved = await n8nJSON(config, '/workflows/' + data.workflowId, undefined, undefined, request);
    const expected = provisionedWorkflow(data, workspace, config);
    if (canonical(saved.nodes) !== canonical(expected.nodes) || canonical(saved.connections) !== canonical(expected.connections)) throw new ConnectionError('verification-failed');
    if (await googleMailbox(data.google!, request) !== data.email) throw new ConnectionError('verification-failed');
  }
  record = await repo.save(record, { ...data, pending: { operation: enable ? 'enable' : 'pause', startedAt: new Date().toISOString() } });
  try {
    await n8nJSON(config, `/workflows/${data.workflowId}/${enable ? 'activate' : 'deactivate'}`, {}, 'POST', request);
    const workflow = await n8nJSON(config, '/workflows/' + data.workflowId, undefined, undefined, request);
    if (Boolean(workflow.active || workflow.activeVersionId) !== enable) throw new ConnectionError('uncertain-result');
    data = { ...data, phase: enable ? 'active' : 'paused' }; delete data.pending;
    return repo.save(record, data);
  } catch { throw new ConnectionError('uncertain-result'); }
}
