import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createSeed } from '../lib/crm/seed.ts';
import { applyMutation } from '../lib/crm/domain.ts';
import { claimMail } from '../lib/crm/mail.ts';
import { cloudConfiguration, cloudTransaction, cloudWorkspace, stageCloudWorkspace, cloudRPC } from '../lib/crm/cloud-store.ts';
import { readPrivateFile, writePrivateFile } from '../lib/crm/private-files.ts';
import { consumeSharedLimit } from '../lib/auth/rate-limit.ts';
import { startCloudSupabase } from '../../../scripts/qa/cloud-supabase.mjs';

test('cloud storage validates keys and refuses Vercel local fallback', () => {
  assert.equal(cloudConfiguration({}), null);
  assert.throws(() => cloudConfiguration({ VERCEL: '1' }), /Configure Supabase/);
  assert.throws(() => cloudConfiguration({ CRM_STORAGE_BACKEND: 'supabase', SUPABASE_SECRET_KEY: 'sb_publishable_qa' }), /server-only/);
  assert.throws(() => cloudConfiguration({ CRM_STORAGE_BACKEND: 'supabase', SUPABASE_SECRET_KEY: 'sb_secret_qa', NEXT_PUBLIC_SUPABASE_URL: 'http://external.test' }), /HTTPS/);
});

test('real SQL storage protects access, concurrent updates, claims, idempotent commits and private files', { timeout: 180000 }, async () => {
  const savedEnv = { ...process.env }, cloud = await startCloudSupabase();
  try {
    Object.assign(process.env, { CRM_STORAGE_BACKEND: 'supabase', SUPABASE_SECRET_KEY: cloud.secret, NEXT_PUBLIC_SUPABASE_URL: cloud.url });
    const original = createSeed(); original.leads = []; original.drafts = []; original.tasks = []; original.activities = []; original.mailJobs = []; original.syncChanges = [];
    await assert.rejects(() => cloudRPC('crm_store_read'), /imported workspace/);
    const fixture = new URL(`../../../.local-preview/cloud-import-qa/${randomUUID()}/`, import.meta.url);
    await mkdir(fixture, { recursive: true });
    await writeFile(new URL('crm.json', fixture), JSON.stringify(original));
    await writeFile(new URL('assistant-gemini.json', fixture), JSON.stringify({ apiKey: 'isolated-qa-only', model: 'gemini-qa' }));
    const migrate = (...args) => promisify(execFile)(process.execPath, ['--experimental-strip-types', fileURLToPath(new URL('../../../scripts/migrate-crm-to-supabase.mjs', import.meta.url)), '--data-dir', fileURLToPath(fixture), ...args], { env: process.env, maxBuffer: 1000000 });
    await assert.rejects(() => migrate('--apply'), /Stop the local CRM/);
    assert.match((await migrate('--apply', '--source-stopped')).stdout, /"exactWorkspaceMatch":true/);
    assert.match((await migrate('--check')).stdout, /"verifiedPrivateFiles":1/);
    const environment = new URL(`../qa-env-${randomUUID()}.env`, fixture); await writeFile(environment, 'ISOLATED_QA_ONLY=true\n');
    const backup = await promisify(execFile)(process.execPath, ['--experimental-strip-types', fileURLToPath(new URL('../../../scripts/backup-supabase-crm.mjs', import.meta.url)), '--environment-file', fileURLToPath(environment)], { env: process.env, maxBuffer: 1000000 });
    const backupResult = JSON.parse(backup.stdout.trim());
    assert.equal(backupResult.consistent, true);
    assert.deepEqual(JSON.parse(await readFile(backupResult.directory + '/crm-data/crm.json', 'utf8')), original);
    assert.equal((await cloudRPC('crm_store_import', { p_data: original })).imported, false);
    const changed = structuredClone(original); changed.settings.businessName = 'Must never overwrite';
    assert.equal((await cloudRPC('crm_store_import', { p_data: changed })).imported, false);
    assert.deepEqual((await cloudRPC('crm_store_read')).data, original);
    for (const role of ['anon', 'authenticated']) {
      await assert.rejects(() => cloud.sql(`set role ${role}; select * from public.crm_workspace_state;`));
      await assert.rejects(() => cloud.sql(`set role ${role}; select public.crm_store_read();`));
      await assert.rejects(() => cloud.sql(`set role ${role}; select public.crm_store_import('{}'::jsonb);`));
    }
    await assert.rejects(() => cloud.sql("set role service_role; select public.crm_store_import('{}'::jsonb);"));

    await Promise.all(Array.from({ length: 6 }, (_, i) => cloudTransaction(async () => {
      const data = cloudWorkspace(); await new Promise(resolve => setTimeout(resolve, 10));
      applyMutation(data, { action: 'lead.create', payload: { name: `Isolated QA ${i}`, email: `isolated-${i}@example.com`, service: `Concurrency ${i}`, message: 'Isolated storage test.', consent: false } }, new Date().toISOString(), randomUUID);
      stageCloudWorkspace(data);
    })));
    assert.equal((await cloudRPC('crm_store_read')).data.leads.length, 6);
    await assert.rejects(() => migrate('--apply', '--source-stopped'), /different cloud workspace/);
    cloud.control.lostCommits = 1;
    await cloudTransaction(async () => { const data = cloudWorkspace(); data.settings.ownerName = 'Committed exactly once'; stageCloudWorkspace(data); });
    assert.equal((await cloudRPC('crm_store_read')).revision, 7);

    await cloudTransaction(async () => {
      const data = cloudWorkspace(), now = new Date().toISOString(), lead = data.leads[0];
      data.mailSenderEmail = 'owner@example.com'; data.lastMailPollAt = now;
      applyMutation(data, { action: 'draft.create', payload: { leadId: lead.id } }, now, randomUUID);
      const draft = data.drafts[0];
      applyMutation(data, { action: 'draft.approve', payload: { id: draft.id, subject: 'Re: Isolated inquiry', body: 'Thank you for your inquiry. Please share your preferred time for an inspection.' } }, now, randomUUID);
      data.syncChanges.forEach(change => { change.status = 'Applied'; });
      applyMutation(data, { action: 'draft.send', payload: { id: draft.id, subject: draft.subject, body: draft.body, email: lead.email, senderEmail: data.mailSenderEmail, confirmed: true } }, now, randomUUID);
      stageCloudWorkspace(data);
    });
    const claims = await Promise.all(Array.from({ length: 5 }, (_, i) => cloudTransaction(async () => {
      const data = cloudWorkspace(), result = claimMail(data, { executionId: `qa-worker-${i}`, senderEmail: 'owner@example.com' }, new Date().toISOString());
      stageCloudWorkspace(data); return result;
    })));
    assert.equal(claims.filter(result => result.job).length, 1);

    const allowed = await Promise.all(Array.from({ length: 8 }, () => consumeSharedLimit('qa:shared-user', 3, 60000)));
    assert.equal(allowed.filter(Boolean).length, 3);
    const file = `reports/${randomUUID()}/report.pdf`, bytes = Buffer.from('%PDF-isolated-only');
    await writePrivateFile(file, bytes); await writePrivateFile(file, bytes);
    await assert.rejects(() => writePrivateFile(file, 'different bytes'), /not overwritten/);
    assert.deepEqual(await readPrivateFile(file), bytes);
    await assert.rejects(() => readPrivateFile('../crm.json'), /Invalid private/);
    cloud.control.unavailable = true;
    await assert.rejects(() => cloudTransaction(async () => {}), /Cloud (storage|workspace)/);
  } finally { process.env = savedEnv; await cloud.close(); }
});
