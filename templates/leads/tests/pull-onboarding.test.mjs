import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startTenantSupabase } from '../../../scripts/qa/tenant-supabase.mjs';
import { createEmptyWorkspace } from '../lib/crm/new-workspace.ts';
import { connectionConfig, openConnection } from '../lib/connections/config.ts';
import { connectionRepository, nextConnectionStep } from '../lib/connections/store.ts';
import { advanceConnection, setProcessing, connectionPreflight } from '../lib/connections/provision.ts';
import { claimConnectionJob, finishConnectionJob, workerAuthorized } from '../lib/connections/pull.ts';
import { runWorkerOnce, executeWorkerJob } from '../../../deploy/n8n-onboarding/pull-worker.mjs';
import { googleScopes } from '../lib/connections/google.ts';

test('two private users provision and control separate workflows through an outbound worker', { timeout: 120000 }, async () => {
  const originalEnv = { ...process.env }, supabase = await startTenantSupabase();
  const receiptDirectory = await mkdtemp(path.join(os.tmpdir(), 'customerlead-pull-test-'));
  try {
    process.env.CRM_STORAGE_BACKEND = 'supabase'; process.env.SUPABASE_SECRET_KEY = supabase.secret; process.env.SUPABASE_URL = supabase.url;
    const config = connectionConfig({ CRM_GOOGLE_CONNECTIONS_ENABLED: 'true', CRM_N8N_CONNECTION_MODE: 'pull', CRM_PUBLIC_ORIGIN: 'https://crm.example.test', CRM_GOOGLE_CLIENT_ID: 'qa-client', CRM_GOOGLE_CLIENT_SECRET: 'qa-secret', CRM_CONNECTION_ENCRYPTION_KEY: randomBytes(32).toString('base64'), CRM_N8N_GEMINI_CREDENTIAL_ID: 'qa-gemini', CRM_N8N_GEMINI_MODEL: 'qa-model', CRM_N8N_WORKER_KEY: 'w'.repeat(40), CRM_N8N_WORKER_ID: 'qa-worker-1234' });
    assert.equal(config.n8nOrigin, ''); assert(workerAuthorized('Bearer ' + config.workerKey, config)); assert(!workerAuthorized('Bearer original-crm-token', config));
    await assert.rejects(connectionPreflight(config), /worker-offline/);
    await supabase.rpc('crm_onboarding_heartbeat', { p_worker_id: config.workerId, p_ready: true });
    await connectionPreflight(config);
    const original = await supabase.rpc('crm_store_read'), spaces = [], imports = [], workflows = new Map(), credentials = [];
    for (const [i, name] of ['One', 'Two'].entries()) {
      const userId = randomUUID(); await supabase.sql('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [userId, `owner${i}@example.com`]);
      const workspaceId = (await supabase.rpc('crm_provision_workspace', { p_user_id: userId, p_name: name, p_data: createEmptyWorkspace(name) })).workspace_id;
      const repo = connectionRepository(workspaceId, config), email = `business${i}@example.com`;
      await repo.save(await repo.read(), { version: 1, id: randomUUID(), userId, businessName: name, phase: 'setting-up', email, labelsReady: true, spreadsheetId: 'qa_sheet_' + i + '_123456789012345', google: { access_token: email, refresh_token: 'qa-refresh-' + i, expires_at: Date.now() + 3600000, scope: googleScopes.join(' '), token_type: 'Bearer' } });
      spaces.push({ workspaceId, repo, email });
    }
    const clients = {
      async post(body) { return body.action === 'claim' ? { job: await claimConnectionJob(body.claimId, config) } : finishConnectionJob(body.jobId, body.claimId, body.result, config); },
      async n8n(resource, body) {
        if (resource === '/credentials') { const result = { id: body.id }; credentials.push(body); return result; }
        if (resource === '/workflows') { const id = 'qa-workflow-' + workflows.size; workflows.set(id, { ...body, id, active: false }); return structuredClone(workflows.get(id)); }
        const id = resource.split('/')[2], saved = workflows.get(id);
        if (resource.endsWith('/activate')) saved.active = true;
        if (resource.endsWith('/deactivate')) saved.active = false;
        return structuredClone(saved);
      },
    };
    const request = async (input, options) => {
      const url = new URL(input), email = new Headers(options.headers).get('authorization').slice(7);
      if (url.hostname === 'gmail.googleapis.com') return new Response(JSON.stringify({ emailAddress: email }));
      assert.equal(url.hostname, 'sheets.googleapis.com'); const i = email.includes('business0') ? 0 : 1;
      return new Response(JSON.stringify({ spreadsheetId: 'qa_sheet_' + i + '_123456789012345', sheets: [{ properties: { title: 'Leads' } }, { properties: { title: 'ReplyReviews' } }] }));
    };
    const journal = { value: null, async read() { return structuredClone(this.value); }, async write(value) { this.value = structuredClone(value); }, async clear() { this.value = null; } };
    const execute = (job, worker, service) => executeWorkerJob(job, worker, service, { importExecute: async filename => imports.push(JSON.parse(await readFile(filename, 'utf8'))[0]) });
    const worker = { ...config, projectId: 'qa-project', receiptDirectory };
    for (let round = 0; round < 7; round++) {
      for (const space of spaces) {
        const saved = (await space.repo.read()).data;
        if (nextConnectionStep(saved) !== 'complete' && !saved.pending) await advanceConnection(space.repo, space.workspaceId, config, { request });
      }
      // Each business can have an independent queued job; one worker handles both.
      await runWorkerOnce(worker, clients, journal, execute); await runWorkerOnce(worker, clients, journal, execute);
    }
    const a = (await spaces[0].repo.read()).data, b = (await spaces[1].repo.read()).data;
    assert.equal(a.phase, 'ready'); assert.equal(b.phase, 'ready');
    assert.notEqual(a.gmailCredentialId, b.gmailCredentialId); assert.notEqual(a.sheetsCredentialId, b.sheetsCredentialId); assert.notEqual(a.crmCredentialId, b.crmCredentialId); assert.notEqual(a.crmToken, b.crmToken); assert.notEqual(a.workflowId, b.workflowId);
    assert.equal(imports.length, 4); assert.equal(workflows.size, 2);
    assert(workflows.get(a.workflowId).nodes.filter(n => n.credentials?.gmailOAuth2).every(n => n.credentials.gmailOAuth2.id === a.gmailCredentialId));
    assert(!JSON.stringify(workflows.get(a.workflowId)).includes('http://127.0.0.1'));
    assert.equal((await supabase.rpc('crm_resolve_workspace_token', { p_token_hash: (await import('node:crypto')).createHash('sha256').update(a.crmToken).digest('hex') })).workspace_id, spaces[0].workspaceId);
    await setProcessing(spaces[0].repo, spaces[0].workspaceId, config, true, request);
    assert.equal(workflows.get(a.workflowId).active, false, 'enqueueing is not activation');
    await runWorkerOnce(worker, clients, journal, execute);
    assert.equal((await spaces[0].repo.read()).data.phase, 'active'); assert.equal(workflows.get(b.workflowId).active, false);
    await setProcessing(spaces[0].repo, spaces[0].workspaceId, config, false, request); await runWorkerOnce(worker, clients, journal, execute);
    assert.equal((await spaces[0].repo.read()).data.phase, 'paused'); assert.equal((await spaces[1].repo.read()).data.phase, 'ready');
    assert.deepEqual(await supabase.rpc('crm_store_read'), original);
    const queuedRows = (await supabase.sql('select payload,workspace_id from public.crm_connection_jobs')).rows;
    assert(queuedRows.every(row => !row.payload.includes('qa-refresh')));
    assert.throws(() => openConnection(queuedRows[0].payload, randomUUID(), config.encryptionKey));
    for (const role of ['anon', 'authenticated']) for (const statement of ['select * from public.crm_connection_jobs', 'select * from public.crm_onboarding_workers', `select public.crm_connection_job_claim('qa-worker-1234','${randomUUID()}')`]) await assert.rejects(supabase.db.transaction(async tx => { await tx.exec('set local role ' + role); await tx.exec(statement); }), /permission denied/);
    assert.equal(await supabase.rpc('crm_connection_job_read', { p_job_id: (await supabase.sql('select id from public.crm_connection_jobs limit 1')).rows[0].id, p_worker_id: 'other-worker', p_claim_id: randomUUID() }), null);
  } finally { process.env = originalEnv; await supabase.close(); assert.equal(path.dirname(path.resolve(receiptDirectory)), path.resolve(os.tmpdir())); await rm(receiptDirectory, { recursive: true, force: true }); }
});
