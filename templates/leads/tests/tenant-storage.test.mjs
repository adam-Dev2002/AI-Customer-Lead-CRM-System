import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { defaultSettings } from '../lib/crm/seed.ts';
import { cloudRPC, cloudTransaction, cloudWorkspace, stageCloudWorkspace } from '../lib/crm/cloud-store.ts';
import { currentWorkspaceId, workspaceId, withWorkspace } from '../lib/crm/workspace-context.ts';
import { privateFileStorageKey, readPrivateFile, writePrivateFile, removePrivateFiles } from '../lib/crm/private-files.ts';
import { assistantConfiguration } from '../lib/crm/assistant-gemini.ts';
import { photoConfiguration } from '../lib/crm/google-contact-photos.ts';
import { configuredInquiryForm } from '../lib/crm/inquiry-form-config.ts';

// Isolated embedded PostgreSQL; never starts Docker or touches a hosted project.
const empty = name => ({ version: 1, settings: { ...defaultSettings, businessName: name }, leads: [], drafts: [], tasks: [], activities: [], syncChanges: [], mailJobs: [], processedEventIds: [], archivedLeadIds: [], notificationsReadAt: '', lastAutomationEventAt: '', lastSyncPollAt: '', lastConfigReadAt: '', lastMailPollAt: '', mailSenderEmail: '', emailMirrorVersion: 1 });
const digest = text => createHash('sha256').update(text).digest('hex');

test('private workspaces preserve ClearFlow and isolate SQL state, receipts, tokens and files', { timeout: 120000 }, async () => {
  const env = { ...process.env }, db = new PGlite(), objects = new Map(); let server;
  const query = async (expression, values = []) => (await db.query('select ' + expression + ' as result', values)).rows[0].result;
  const service = async (expression, values = []) => db.transaction(async tx => {
    await tx.exec('set local role service_role');
    return (await tx.query('select ' + expression + ' as result', values)).rows[0].result;
  });
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, deleted_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      create schema storage; create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint);`);
    for (const file of ['202610200001_crm_workspace_access.sql', '202610210001_crm_cloud_storage.sql', '202610220001_crm_private_workspaces.sql']) {
      await db.exec(await readFile(new URL('../../../supabase/migrations/' + file, import.meta.url), 'utf8'));
    }
    const old = empty('Existing ClearFlow'); old.leads = [{ id: 'existing-record-must-stay' }];
    await service('public.crm_store_import($1::jsonb)', [old]);
    const [owner, first, second, unconfirmed] = Array.from({ length: 4 }, randomUUID);
    for (const [id, email, confirmed] of [[owner, 'original@example.com', true], [first, 'first@example.com', true], [second, 'second@example.com', true], [unconfirmed, 'unconfirmed@example.com', false]]) {
      await db.query('insert into auth.users(id,email,email_confirmed_at) values ($1,$2,$3)', [id, email, confirmed ? '2026-01-01' : null]);
    }
    await db.query("insert into public.crm_workspace_members(user_id,workspace_id,role) values ($1,'clearflow','owner')", [owner]);
    assert.equal((await service('public.crm_provision_workspace($1::uuid,$2,$3::jsonb)', [owner, 'No replacement', empty('No replacement')])).workspace_id, 'clearflow');
    assert.deepEqual((await service('public.crm_store_read()')).data, old);
    await assert.rejects(() => service('public.crm_provision_workspace($1::uuid,$2,$3::jsonb)', [unconfirmed, 'Unconfirmed', empty('Unconfirmed')]), /Confirm the account/);
    const seeded = empty('Forbidden'); seeded.leads = [{ id: 'sample' }];
    await assert.rejects(() => service('public.crm_provision_workspace($1::uuid,$2,$3::jsonb)', [first, 'Forbidden', seeded]), /cannot contain/);
    const inherited = empty('Forbidden'); inherited.mailSenderEmail = 'original@example.com';
    await assert.rejects(() => service('public.crm_provision_workspace($1::uuid,$2,$3::jsonb)', [first, 'Forbidden', inherited]), /inherit automation/);
    const enabled = empty('Forbidden'); enabled.settings.automaticEmailsEnabled = true;
    await assert.rejects(() => service('public.crm_provision_workspace($1::uuid,$2,$3::jsonb)', [first, 'Forbidden', enabled]), /separate automation/);
    const provisioned = await Promise.all(Array.from({ length: 4 }, () => service('public.crm_provision_workspace($1::uuid,$2,$3::jsonb)', [first, 'First business', empty('First business')])));
    const a = provisioned[0].workspace_id, b = (await service('public.crm_provision_workspace($1::uuid,$2,$3::jsonb)', [second, 'Second business', empty('Second business')])).workspace_id;
    assert.equal(new Set(provisioned.map(item => item.workspace_id)).size, 1);
    assert.notEqual(a, b); assert.notEqual(a, 'clearflow');
    const firstState = (await service('public.crm_tenant_read($1)', [a])).data;
    assert.equal(firstState.settings.ownerEmail, 'first@example.com');
    for (const field of ['leads', 'drafts', 'tasks', 'activities', 'syncChanges', 'mailJobs', 'processedEventIds', 'archivedLeadIds']) assert.deepEqual(firstState[field], []);
    assert.equal((await query('(select count(*)::integer from public.crm_workspace_state)')), 3);

    for (const role of ['anon', 'authenticated']) {
      for (const statement of [
        'select * from public.crm_workspace_state', 'select * from public.crm_tenant_commit_receipts', 'select * from public.crm_workspace_integrations',
        `select public.crm_tenant_read('${a}')`, `select public.crm_tenant_commit('${a}',0,'{}',gen_random_uuid())`,
        `select public.crm_provision_workspace('${first}','Unauthorized','{}')`, `select public.crm_set_workspace_token('${a}','${digest('unauthorized')}')`,
        `select public.crm_resolve_workspace_token('${digest('secret')}')`, `select public.crm_workspace_connection('${a}')`,
      ]) await assert.rejects(() => db.transaction(async tx => { await tx.exec('set local role ' + role); await tx.exec(statement); }), /permission denied/);
    }
    assert.equal(await service('public.crm_workspace_connection($1)', [a]), false);
    await service('public.crm_set_workspace_token($1,$2)', [a, digest('first-private-token')]);
    await service('public.crm_set_workspace_token($1,$2)', [b, digest('second-private-token')]);
    assert.deepEqual(await service('public.crm_resolve_workspace_token($1)', [digest('first-private-token')]), { workspace_id: a });
    await assert.rejects(() => service('public.crm_set_workspace_token($1,$2)', [b, digest('first-private-token')]), /unique constraint/);
    await service('public.crm_set_workspace_token($1,$2)', [a, digest('rotated-first-private-token')]);
    assert.equal(await service('public.crm_resolve_workspace_token($1)', [digest('first-private-token')]), null);
    assert.equal(await service('public.crm_workspace_connection($1)', [a]), true);

    let lostCommits = 1; const calls = [];
    server = createServer(async (req, res) => {
      const send = (body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
      try {
        assert.equal(req.headers.apikey, 'sb_secret_tenant_isolated_qa');
        const pathname = new URL(req.url, 'http://localhost').pathname, chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const bytes = Buffer.concat(chunks); calls.push(pathname);
        if (pathname.startsWith('/storage/v1/object/crm-private/')) {
          const key = decodeURIComponent(pathname.slice('/storage/v1/object/crm-private/'.length));
          if (req.method === 'GET') { if (!objects.has(key)) return send({}, 404); res.writeHead(200); res.end(objects.get(key)); return; }
          if (req.method === 'POST') { if (objects.has(key)) return send({}, 409); objects.set(key, bytes); return send({}); }
        }
        const body = JSON.parse(bytes.toString() || '{}');
        if (pathname === '/storage/v1/object/crm-private' && req.method === 'DELETE') { body.prefixes.forEach(key => objects.delete(key)); return send({}); }
        let result;
        if (pathname.endsWith('/crm_store_read')) result = await service('public.crm_store_read()');
        else if (pathname.endsWith('/crm_store_commit')) result = await service('public.crm_store_commit($1,$2::jsonb,$3::uuid)', [body.p_revision, body.p_data, body.p_request_id]);
        else if (pathname.endsWith('/crm_tenant_read')) result = await service('public.crm_tenant_read($1)', [body.p_workspace_id]);
        else if (pathname.endsWith('/crm_tenant_commit')) {
          result = await service('public.crm_tenant_commit($1,$2,$3::jsonb,$4::uuid)', [body.p_workspace_id, body.p_revision, body.p_data, body.p_request_id]);
          if (lostCommits-- > 0) { res.destroy(); return; }
        } else return send({}, 404);
        send(result);
      } catch { send({}, 400); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    Object.assign(process.env, { CRM_STORAGE_BACKEND: 'supabase', SUPABASE_SECRET_KEY: 'sb_secret_tenant_isolated_qa', SUPABASE_URL: `http://127.0.0.1:${server.address().port}` });
    assert.throws(workspaceId, /authorized workspace/);
    await assert.rejects(() => withWorkspace('../clearflow', async () => {}), /Invalid workspace/);
    await Promise.all([a, b].map((id, i) => withWorkspace(id, async () => {
      assert.equal(workspaceId(), id);
      await cloudTransaction(async () => {
        const state = cloudWorkspace(); state.settings.phone = `tenant-${i}`; stageCloudWorkspace(state);
        await assert.rejects(() => withWorkspace(i ? a : b, async () => cloudWorkspace()), /authorized transaction/);
      });
    })));
    assert.equal(currentWorkspaceId(), undefined);
    assert.equal((await service('public.crm_tenant_read($1)', [a])).revision, 1);
    assert.equal((await service('public.crm_tenant_read($1)', [b])).data.settings.phone, 'tenant-1');
    assert.deepEqual((await service('public.crm_store_read()')).data, old);
    await Promise.all(Array.from({ length: 4 }, () => withWorkspace(a, () => cloudTransaction(async () => {
      const state = cloudWorkspace(); state.settings.maxEmailsPerScan++; stageCloudWorkspace(state);
    }))));
    assert.equal((await service('public.crm_tenant_read($1)', [a])).data.settings.maxEmailsPerScan, defaultSettings.maxEmailsPerScan + 4);
    const sameReceipt = randomUUID();
    for (const id of [a, b]) {
      const stored = await service('public.crm_tenant_read($1)', [id]);
      assert.equal((await service('public.crm_tenant_commit($1,$2,$3::jsonb,$4::uuid)', [id, stored.revision, stored.data, sameReceipt])).applied, true);
    }
    assert.equal(await query('(select count(*)::integer from public.crm_tenant_commit_receipts where request_id = $1::uuid)', [sameReceipt]), 2);
    await assert.rejects(() => withWorkspace(randomUUID(), () => cloudTransaction(async () => {})), /Cloud workspace/);

    const key = 'config/assistant-gemini.json', report = `reports/${randomUUID()}/report.pdf`;
    await withWorkspace('clearflow', async () => { await writePrivateFile(key, 'original-private-key'); await cloudTransaction(async () => assert.equal(cloudWorkspace().settings.businessName, old.settings.businessName)); });
    assert.ok(calls.includes('/rest/v1/rpc/crm_store_read'));
    for (const id of [a, b]) await withWorkspace(id, async () => {
      assert.equal(privateFileStorageKey(key), `workspaces/${id}/${key}`);
      await assert.rejects(() => readPrivateFile(key), error => error.code === 'ENOENT');
      await writePrivateFile(key, id); await writePrivateFile(report, id);
      assert.equal((await readPrivateFile(key)).toString(), id);
      assert.equal((await readPrivateFile(report)).toString(), id);
    });
    await withWorkspace(a, async () => removePrivateFiles([key, report]));
    await withWorkspace(a, async () => assert.rejects(() => readPrivateFile(key), error => error.code === 'ENOENT'));
    await withWorkspace(b, async () => assert.equal((await readPrivateFile(key)).toString(), b));
    await withWorkspace('clearflow', async () => assert.equal((await readPrivateFile(key)).toString(), 'original-private-key'));
    await withWorkspace(a, async () => assert.rejects(() => readPrivateFile('../crm.json'), /Invalid private/));
    Object.assign(process.env, { GEMINI_ASSISTANT_API_KEY: 'original-secret', GEMINI_ASSISTANT_MODEL: 'gemini-qa', GOOGLE_CONTACTS_CLIENT_ID: 'original-client', GOOGLE_CONTACTS_CLIENT_SECRET: 'original-contact-secret', GOOGLE_CONTACTS_REFRESH_TOKEN: 'original-refresh-token', CRM_CUSTOMER_FORM_URL: 'https://original.example.com/form' });
    await withWorkspace('clearflow', async () => {
      assert.equal((await assistantConfiguration()).apiKey, 'original-secret');
      assert.equal((await photoConfiguration()).clientId, 'original-client');
      assert.equal((await configuredInquiryForm()).url, 'https://original.example.com/form');
    });
    // Missing business-specific credentials cannot inherit deployment defaults.
    await withWorkspace(a, async () => {
      assert.equal(await assistantConfiguration(), null);
      assert.equal(await photoConfiguration(), null);
      assert.equal(await configuredInquiryForm(), null);
      await writePrivateFile(key, JSON.stringify({ apiKey: 'first-only-secret', model: 'gemini-qa' }));
      await writePrivateFile('config/google-contact-photos.json', JSON.stringify({ version: 1, clientId: 'first-only-client', clientSecret: 'first-only-client-secret', refreshToken: 'first-only-refresh', accountEmail: 'first@example.com' }));
      await writePrivateFile('config/customer-form.json', JSON.stringify({ version: 1, url: 'https://first.example.com/form' }));
      assert.equal((await assistantConfiguration()).apiKey, 'first-only-secret');
      assert.equal((await photoConfiguration()).clientId, 'first-only-client');
      assert.equal((await configuredInquiryForm()).url, 'https://first.example.com/form');
    });
    await withWorkspace(b, async () => {
      assert.equal(await assistantConfiguration(), null);
      assert.equal(await photoConfiguration(), null);
      assert.equal(await configuredInquiryForm(), null);
    });
    process.env.CRM_STORAGE_BACKEND = 'local'; delete process.env.VERCEL;
    await withWorkspace(a, async () => {
      await assert.rejects(() => cloudTransaction(async () => {}), /require cloud storage/);
      await assert.rejects(() => readPrivateFile(key), /require cloud storage/);
    });
  } finally {
    process.env = env;
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await db.close();
  }
});
