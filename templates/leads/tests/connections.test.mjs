import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { connectionConfig, sealConnection, openConnection, ConnectionError } from '../lib/connections/config.ts';
import { oauthStart, validOAuth, googleScopes, businessLabels, exchangeGoogleCode } from '../lib/connections/google.ts';
import { nextConnectionStep } from '../lib/connections/store.ts';
import { advanceConnection, setProcessing } from '../lib/connections/provision.ts';
import { leadHeaders, reviewHeaders, provisionedWorkflow, businessFormId } from '../lib/connections/workflow.ts';
const config = connectionConfig({ CRM_GOOGLE_CONNECTIONS_ENABLED: 'true', CRM_PUBLIC_ORIGIN: 'https://crm.example.test', CRM_GOOGLE_CLIENT_ID: 'qa-client', CRM_GOOGLE_CLIENT_SECRET: 'qa-client-secret', CRM_CONNECTION_ENCRYPTION_KEY: randomBytes(32).toString('base64'), CRM_N8N_API_URL: 'https://automation.example.test', CRM_N8N_API_KEY: 'qa-operator-key', CRM_N8N_SETUP_KEY: 'qa-setup-key', CRM_N8N_GEMINI_CREDENTIAL_ID: 'qa-gemini', CRM_N8N_GEMINI_MODEL: 'qa-approved-model' });
const workspace = randomUUID();
const connected = () => ({ version: 1, id: randomUUID(), userId: randomUUID(), businessName: 'QA Business', phase: 'setting-up', email: 'inbox.qa@example.com', google: { access_token: 'qa-access', refresh_token: 'qa-refresh', expires_at: Date.now() + 3600000, scope: googleScopes.join(' '), token_type: 'Bearer' } });
function repository(data = connected()) {
  let record = { revision: 1, data: structuredClone(data) };
  return {
    async read() { return structuredClone(record); },
    async save(old, data) { if (old.revision !== record.revision) throw new ConnectionError('connection-busy'); record = { revision: record.revision + 1, data: structuredClone(data) }; return structuredClone(record); },
  };
}
function provider(options = {}) {
  const calls = [], credentials = [], workflows = new Map(); let sheetCreates = 0, createdSheet;
  const response = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  const request = async (input, init = {}) => {
    const url = new URL(input), body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: url.toString(), method: init.method || 'GET', body, headers: init.headers });
    if (url.hostname === 'gmail.googleapis.com' && url.pathname.endsWith('/labels')) return response(body ? { id: 'qa-label', name: body.name } : { labels: businessLabels.map(name => ({ name })) });
    if (url.hostname === 'gmail.googleapis.com' && url.pathname.endsWith('/profile')) return response({ emailAddress: 'inbox.qa@example.com' });
    if (url.hostname === 'sheets.googleapis.com') {
      if (body) { sheetCreates++; createdSheet = body; if (options.loseSheetResponse) throw new Error('Simulated lost response.'); if (options.rejectSheet) return new Response('{}', { status: 403 }); }
      return response({ spreadsheetId: 'qa_sheet_id_123456789012345', sheets: [{ properties: { title: 'Leads' } }, { properties: { title: 'ReplyReviews' } }] });
    }
    assert.equal(url.hostname, 'automation.example.test', 'unexpected outbound host');
    if (url.pathname === '/customerlead-setup/credentials') { assert.equal(init.headers['X-CustomerLead-Setup-Key'], 'qa-setup-key'); credentials.push(body.credential); return response({ id: 'qa-credential-' + credentials.length }); }
    assert.equal(init.headers['X-N8N-API-KEY'], 'qa-operator-key');
    if (url.pathname.endsWith('/credentials')) { credentials.push(body); return response({ id: 'qa-credential-' + credentials.length }); }
    if (url.pathname === '/api/v1/workflows' && body) { const id = 'qa-workflow'; workflows.set(id, { ...body, id, active: false }); return response(workflows.get(id)); }
    const id = url.pathname.split('/')[4], workflow = workflows.get(id);
    if (url.pathname.endsWith('/activate')) { workflow.active = true; return response(workflow); }
    if (url.pathname.endsWith('/deactivate')) { workflow.active = false; return response(workflow); }
    if (workflow) return response(workflow);
    throw new Error('Unexpected QA call: ' + url.pathname);
  };
  return { request, calls, credentials, workflows, get sheetCreates() { return sheetCreates; }, get sheet() { return createdSheet; } };
}
test('connection setup is opt-in and requires private HTTPS service configuration', () => {
  assert.equal(connectionConfig({}), null);
  assert.throws(() => connectionConfig({ CRM_GOOGLE_CONNECTIONS_ENABLED: 'true' }), /setup-unavailable/);
  assert(config.origin.startsWith('https://'));
});
test('Google grants are encrypted, authenticated and bound to one business workspace', () => {
  const token = connected(), encrypted = sealConnection(token, workspace, config.encryptionKey);
  assert(!encrypted.includes('qa-refresh')); assert.deepEqual(openConnection(encrypted, workspace, config.encryptionKey), token);
  assert.throws(() => openConnection(encrypted, randomUUID(), config.encryptionKey), /setup-unavailable/);
  assert.throws(() => openConnection(encrypted, workspace, randomBytes(32)), /setup-unavailable/);
  assert.throws(() => openConnection(encrypted.slice(0, -4) + 'bad!', workspace, config.encryptionKey), /setup-unavailable/);
});
test('OAuth uses offline PKCE and requires the same owner, browser state and unexpired connection', () => {
  const start = oauthStart(config), url = new URL(start.url), data = { ...connected(), oauth: start.oauth };
  assert.equal(url.origin, 'https://accounts.google.com'); assert.equal(url.searchParams.get('access_type'), 'offline'); assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('redirect_uri'), config.origin + '/api/connections/google/callback');
  assert(!url.toString().includes(config.clientSecret));
  assert(validOAuth(data, data.userId, start.state, start.state));
  assert(!validOAuth(data, randomUUID(), start.state, start.state));
  assert(!validOAuth(data, data.userId, start.state, 'other-browser'));
  assert(!validOAuth(data, data.userId, start.state, start.state, Date.now() + 700000));
  assert(!validOAuth({ ...data, oauth: undefined }, data.userId, start.state, start.state));
});
test('Google partial permission grants and missing offline refresh tokens block setup', async () => {
  const response = body => async () => new Response(JSON.stringify(body));
  await assert.rejects(exchangeGoogleCode(config, 'qa-code', 'qa-verifier', response({ access_token: 'qa', expires_in: 3600, scope: googleScopes[1], refresh_token: 'qa-refresh' })), /google-permissions/);
  await assert.rejects(exchangeGoogleCode(config, 'qa-code', 'qa-verifier', response({ access_token: 'qa', expires_in: 3600, scope: googleScopes.join(' ') })), /google-reconnect/);
});
test('automatic setup creates one sheet with exact headers, separate credentials and an inactive fixed workflow', async () => {
  const repo = repository(), remote = provider(), registrations = [];
  const deps = { request: remote.request, register: async (id, hash) => { registrations.push({ id, hash }); return true; } };
  for (let i = 0; i < 8; i++) await advanceConnection(repo, workspace, config, deps);
  const data = (await repo.read()).data;
  assert.equal(nextConnectionStep(data), 'complete'); assert.equal(data.phase, 'ready'); assert.equal(remote.sheetCreates, 1);
  assert.deepEqual(remote.sheet.sheets[0].data[0].rowData[0].values.map(c => c.userEnteredValue.stringValue), leadHeaders);
  assert.deepEqual(remote.sheet.sheets[1].data[0].rowData[0].values.map(c => c.userEnteredValue.stringValue), reviewHeaders);
  assert.equal(remote.credentials.length, 3); assert.equal(remote.credentials[0].data.customScopes, true);
  assert.equal(remote.credentials[0].data.enabledScopes, googleScopes.join(' ')); assert.equal(remote.credentials[1].type, 'googleSheetsOAuth2Api');
  assert.equal(registrations[0].id, workspace); assert(/^[a-f0-9]{64}$/.test(registrations[0].hash));
  const workflow = remote.workflows.get(data.workflowId);
  assert(!JSON.stringify(workflow).includes('crm.example.invalid'), 'all receiver addresses must use the hosted CRM');
  assert(!JSON.stringify(workflow).includes('inbox@example.invalid'), 'all email defaults must be scoped to this business');
  assert.equal(workflow.active, false); assert.equal(workflow.nodes.filter(n => n.type.endsWith('.scheduleTrigger')).length, 4);
  assert(workflow.nodes.filter(n => n.type.endsWith('.googleSheets')).every(n => n.credentials.googleSheetsOAuth2Api.id === data.sheetsCredentialId));
  assert.equal(workflow.nodes.find(n => n.type.endsWith('.formTrigger')).webhookId, businessFormId(workspace));
  const before = remote.calls.length; await advanceConnection(repo, workspace, config, deps); assert.equal(remote.calls.length, before, 'reopening completed setup creates nothing');
  assert(!remote.calls.some(c => /messages\/(send|insert)|drafts\/send|\/execute/.test(c.url)), 'setup never sends or executes an inquiry');
  await setProcessing(repo, workspace, config, true, remote.request); assert.equal((await repo.read()).data.phase, 'active');
  await setProcessing(repo, workspace, config, false, remote.request); assert.equal((await repo.read()).data.phase, 'paused');
});
test('two requests cannot both claim a sheet creation step', async () => {
  const repo = repository({ ...connected(), labelsReady: true }), remote = provider();
  const results = await Promise.allSettled([advanceConnection(repo, workspace, config, { request: remote.request }), advanceConnection(repo, workspace, config, { request: remote.request })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(remote.sheetCreates, 1);
});
test('lost sheet creation responses retain a durable claim and never automatically duplicate the sheet', async () => {
  const repo = repository({ ...connected(), labelsReady: true }), remote = provider({ loseSheetResponse: true });
  await assert.rejects(advanceConnection(repo, workspace, config, { request: remote.request }), /uncertain-result/);
  const saved = (await repo.read()).data; assert.equal(saved.pending.operation, 'spreadsheet'); assert.equal(saved.phase, 'attention');
  await assert.rejects(advanceConnection(repo, workspace, config, { request: remote.request }), /connection-busy|uncertain-result/);
  assert.equal(remote.sheetCreates, 1);
});
test('known rejected setup steps can resume without recreating previously confirmed resources', async () => {
  const repo = repository({ ...connected(), labelsReady: true }), options = { rejectSheet: true }, remote = provider(options);
  await assert.rejects(advanceConnection(repo, workspace, config, { request: remote.request }), /provider-unavailable/);
  assert.equal((await repo.read()).data.pending, undefined); options.rejectSheet = false;
  await advanceConnection(repo, workspace, config, { request: remote.request });
  assert.equal((await repo.read()).data.spreadsheetId, 'qa_sheet_id_123456789012345');
});
test('workflow bindings are rechecked before activation and customer inputs never become code', async () => {
  const repo = repository(), remote = provider();
  for (let i = 0; i < 8; i++) await advanceConnection(repo, workspace, config, { request: remote.request, register: async () => true });
  const saved = (await repo.read()).data, workflow = remote.workflows.get(saved.workflowId);
  workflow.nodes.find(n => n.credentials?.gmailOAuth2).credentials.gmailOAuth2.id = 'wrong-business';
  await assert.rejects(setProcessing(repo, workspace, config, true, remote.request), /verification-failed/);
  assert.equal(workflow.active, false);
  const materialized = provisionedWorkflow({ ...saved, businessName: "'); throw new Error('injected'); //" }, randomUUID(), config);
  assert(!materialized.nodes.filter(n => n.parameters.jsCode).some(n => n.parameters.jsCode.includes("throw new Error('injected')")));
});
