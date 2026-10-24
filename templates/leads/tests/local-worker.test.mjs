import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { runWorkerOnce, executeWorkerJob, WorkerError, validateWorkerConfig } from '../../../deploy/n8n-onboarding/pull-worker.mjs';

function memoryJournal(value = null) { return { value, async read() { return structuredClone(this.value); }, async write(v) { this.value = structuredClone(v); }, async clear() { this.value = null; } }; }
const job = () => ({ id: randomUUID(), workspaceId: randomUUID(), operation: 'workflow', status: 'Claimed', payload: {} });
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
