import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { runWorkerOnce, executeWorkerJob, WorkerError, validateWorkerConfig, checkWorkerConnections, workerClients, workflowDigest } from '../../../deploy/n8n-onboarding/pull-worker.mjs';
import { workflowDigest as serverWorkflowDigest, validatedWorkerResult } from '../lib/connections/pull.ts';
import { isWorkerCommand } from '../../../deploy/n8n-onboarding/worker-control.mjs';

test('verification tolerates n8n credential display names but retains IDs, types, parameters and connections', async () => {
  const workspaceId = randomUUID();
  const graph = { name: 'CustomerLead business ' + workspaceId, nodes: [{ id: 'node-1', name: 'Read inquiry', type: 'gmail', position: [10, 20], parameters: { operation: 'read' }, credentials: { gmailOAuth2: { id: 'business-a-gmail', name: 'CustomerLead gmail' } } }], connections: { 'Read inquiry': { main: [] } }, active: false };
  const saved = structuredClone(graph); saved.nodes[0].credentials.gmailOAuth2.name = 'Actual imported Google credential';
  const before = JSON.stringify(saved), digest = serverWorkflowDigest(graph);
  assert.equal(workflowDigest(saved), digest); assert.equal(JSON.stringify(saved), before, 'Fingerprint must not change the actual workflow.');
  const verify = { id: randomUUID(), workspaceId, operation: 'verify', status: 'Claimed', payload: { workflowId: 'business-a-workflow', graphHash: digest } };
  let mutations = 0;
  const clients = { async n8n(_resource, body) { if (body) mutations++; return saved; } };
  assert.deepEqual(await executeWorkerJob(verify, {}, clients), { status: 'Succeeded', verified: true });
  for (const change of [
    value => { value.nodes[0].credentials.gmailOAuth2.id = 'business-b-gmail'; },
    value => { value.nodes[0].credentials = { otherType: value.nodes[0].credentials.gmailOAuth2 }; },
    value => { value.nodes[0].parameters.operation = 'send'; },
    value => { value.connections = {}; },
    value => { delete value.nodes[0].credentials.gmailOAuth2.id; },
  ]) {
    const changed = structuredClone(saved); change(changed);
    assert.notEqual(workflowDigest(changed), digest);
    await assert.rejects(executeWorkerJob(verify, {}, { n8n: async () => changed }), /connection-changed/);
  }
  await assert.rejects(executeWorkerJob(verify, {}, { n8n: async () => ({ ...saved, active: true }) }), /connection-active/);
  await assert.rejects(executeWorkerJob(verify, {}, { n8n: async () => { throw new WorkerError('provider-unavailable', false, 404); } }), /connection-missing/);
  assert.equal(mutations, 0, 'Rechecking performs reads only.');
  assert.equal(validatedWorkerResult('verify', { status: 'Failed', code: 'connection-changed' }).code, 'connection-changed');
  assert.equal(validatedWorkerResult('verify', { status: 'Failed', code: 'private provider response' }).code, 'provider-unavailable');
  assert.equal(validatedWorkerResult('verify', { status: 'Uncertain', code: 'verification-failed' }).code, 'verification-failed', 'Retain the result hash of already journaled legacy callbacks.');
});

test('transient metadata reads retry within a bound, while unauthorized reads and mutations do not retry', async () => {
  const config = { crmOrigin: 'https://crm.example.test', n8nOrigin: 'http://127.0.0.1:5678', apiKey: 'qa-key' };
  let reads = 0;
  const recovered = workerClients(config, async () => ++reads < 3 ? new Response('{}', { status: 503 }) : new Response('{"id":"ready"}'));
  assert.equal((await recovered.n8n('/workflows/qa')).id, 'ready'); assert.equal(reads, 3);
  for (const [method, status, maximum] of [['GET', 401, 1], ['GET', 503, 3], ['POST', 503, 1]]) {
    let calls = 0;
    const failed = workerClients(config, async () => { calls++; return new Response('{}', { status }); });
    await assert.rejects(failed.n8n('/workflows/qa', method === 'POST' ? {} : undefined, method), error => error instanceof WorkerError && error.uncertain === (method === 'POST'));
    assert.equal(calls, maximum);
  }
});

test('worker lifecycle matching cannot stop n8n, another config or another command', () => {
  const directory = '/home/node/.n8n/customerlead-onboarding-worker';
  const args = ['/usr/local/bin/node', directory + '/run-pull-worker.mjs', '--config', directory + '/worker.json', '--run'];
  assert.equal(isWorkerCommand(args, directory), true);
  for (const value of [['node', '/usr/local/bin/n8n'], [...args, '--extra'], [args[0], args[1], '--config', '/other/worker.json', '--run'], [args[0], args[1], '--config', args[3], '--check']]) assert.equal(isWorkerCommand(value, directory), false);
});

function memoryJournal(value = null) { return { value, async read() { return structuredClone(this.value); }, async write(v) { this.value = structuredClone(v); }, async clear() { this.value = null; } }; }
const job = () => ({ id: randomUUID(), workspaceId: randomUUID(), operation: 'workflow', status: 'Claimed', payload: {} });
test('public readiness checks only metadata and heartbeat, and requires confirmed authentication', async () => {
  const config = { geminiCredentialId: 'qa-gemini' }, posts = [];
  const clients = {
    async n8n(resource, body) { assert.equal(resource, '/credentials/qa-gemini'); assert.equal(body, undefined); return { id: 'qa-gemini', type: 'httpHeaderAuth' }; },
    async post(body) { posts.push(body); return { accepted: true }; },
  };
  assert.deepEqual(await checkWorkerConnections(clients, config), { localN8nReady: true, publicCrmReady: true, jobsExecuted: 0 });
  assert.deepEqual(posts, [{ action: 'heartbeat', ready: true }]);
  assert.equal((await checkWorkerConnections({ ...clients, post: async () => { throw new Error('Private provider diagnostic'); } }, config)).publicCrmReady, false);
  assert.equal((await checkWorkerConnections({ ...clients, post: async () => ({ accepted: false }) }, config)).publicCrmReady, false);
  const offline = await checkWorkerConnections({ n8n: async () => { throw new Error('Offline'); }, post: async () => assert.fail('No public request while local readiness is unconfirmed.') }, config);
  assert.deepEqual(offline, { localN8nReady: false, publicCrmReady: false, jobsExecuted: 0 });
});
test('worker configuration only permits the public HTTPS CRM and loopback n8n', () => {
  const config = { crmOrigin: 'https://crm.example.test', n8nOrigin: 'http://127.0.0.1:5678', workerId: 'qa-worker-1234', workerKey: 'w'.repeat(40), apiKey: 'qa-api-key', projectId: 'qa-project', geminiCredentialId: 'qa-gemini' };
  assert.equal(validateWorkerConfig(config).n8nOrigin, 'http://127.0.0.1:5678');
  assert.throws(() => validateWorkerConfig({ ...config, n8nOrigin: 'http://external.test' }), /invalid-config/);
  assert.throws(() => validateWorkerConfig({ ...config, crmOrigin: 'http://crm.example.test' }), /invalid-config/);
});
test('lost result callbacks retry the callback without executing a job twice', async () => {
  const journal = memoryJournal(), queued = job(); let executions = 0, callbacks = 0;
  const clients = { async post(body) { if (body.action === 'claim') return { job: queued }; callbacks++; if (callbacks === 1) throw new Error('simulated lost callback'); return { accepted: true }; } };
  const execute = async () => { executions++; return { status: 'Succeeded', id: 'qa-created-id' }; };
  await assert.rejects(runWorkerOnce({}, clients, journal, execute));
  assert.equal(journal.value.phase, 'result');
  assert.equal(await runWorkerOnce({}, clients, journal, execute), 'Succeeded');
  assert.equal(executions, 1); assert.equal(callbacks, 2); assert.equal(journal.value, null);
});
test('restarting during execution reports Uncertain and never retries the mutation', async () => {
  const journal = memoryJournal({ phase: 'executing', claimId: randomUUID(), job: job() }); let executions = 0, reported;
  const clients = { async post(body) { reported = body.result; return { accepted: true }; } };
  await runWorkerOnce({}, clients, journal, async () => { executions++; });
  assert.equal(executions, 0); assert.equal(reported.status, 'Uncertain');
});
test('lost claims reuse their durable claim ID', async () => {
  const journal = memoryJournal(), queued = job(), ids = []; let first = true;
  const clients = { async post(body) { if (body.action === 'claim') { ids.push(body.claimId); if (first) { first = false; throw new Error('lost claim response'); } return { job: queued }; } return { accepted: true }; } };
  await assert.rejects(runWorkerOnce({}, clients, journal, async () => ({ status: 'Succeeded', id: 'qa-id' })));
  await runWorkerOnce({}, clients, journal, async () => ({ status: 'Succeeded', id: 'qa-id' }));
  assert.equal(ids[0], ids[1]);
});
test('worker refuses other business workflow IDs before verification or activation', async () => {
  let mutations = 0;
  const clients = { async n8n(_resource, body) { if (body) mutations++; return { name: 'CustomerLead business ' + randomUUID(), nodes: [], connections: {} }; } };
  await assert.rejects(executeWorkerJob({ ...job(), operation: 'enable', payload: { workflowId: 'wrong-business', graphHash: 'a'.repeat(64) } }, {}, clients), /verification-failed/);
  assert.equal(mutations, 0);
});
