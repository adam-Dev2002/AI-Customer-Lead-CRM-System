import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { authorizedSetup, validateImport, importCredential } from '../../../deploy/n8n-onboarding/credential-importer.mjs';
const key = 'isolated-setup-key-at-least-32-characters';
const request = () => ({ requestId: randomUUID() + ':gmail', credential: { type: 'gmailOAuth2', data: { clientId: 'qa-client', clientSecret: 'qa-client-secret', oauthTokenData: { access_token: 'qa-access', refresh_token: 'qa-refresh', scope: 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/drive.file', expires_at: new Date(Date.now() + 3600000).toISOString(), expires_in: 3600, token_type: 'Bearer' } } } });
test('operator importer authenticates requests and accepts only fixed Google credential data', () => {
  assert(authorizedSetup(key, key)); assert(!authorizedSetup('wrong', key)); assert(!authorizedSetup(undefined, key));
  const body = request(); assert.equal(validateImport(body).type, 'gmailOAuth2');
  assert.throws(() => validateImport({ ...body, credential: { ...body.credential, type: 'httpRequest' } }), /invalid-request/);
  body.credential.data.clientSecret = '={{ malicious-expression }}'; assert.throws(() => validateImport(body), /invalid-request/);
});
test('credential import is idempotent, creates fresh IDs and removes its transient token file', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'customerlead-import-test-')); let calls = 0, filename;
  try {
    const body = request();
    const execute = async file => { calls++; filename = file; const values = JSON.parse(await readFile(file, 'utf8')); assert.equal(values.length, 1); assert(/^[\w-]{16}$/.test(values[0].id)); assert.equal(values[0].data.oauthTokenData.refresh_token, 'qa-refresh'); };
    const first = await importCredential(body, { directory, projectId: 'qa-project', execute });
    assert.deepEqual(await importCredential(body, { directory, projectId: 'qa-project', execute }), first); assert.equal(calls, 1);
    await assert.rejects(readFile(filename), /ENOENT/);
    const receipt = await readFile(path.join(directory, (await readdir(directory))[0]), 'utf8'); assert(!receipt.includes('qa-refresh')); assert(!receipt.includes('qa-client-secret'));
    const other = await importCredential(request(), { directory, projectId: 'qa-project', execute }); assert.notEqual(first.id, other.id);
  } finally { assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir())); await rm(directory, { recursive: true, force: true }); }
});
test('an interrupted credential import blocks retries and retains no raw token file', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'customerlead-import-test-')); let filename, calls = 0;
  try {
    const body = request(), execute = async file => { filename = file; calls++; throw new Error('simulated-interruption'); };
    await assert.rejects(importCredential(body, { directory, projectId: 'qa-project', execute }));
    await assert.rejects(readFile(filename), /ENOENT/);
    await assert.rejects(importCredential(body, { directory, projectId: 'qa-project', execute }), /import-unconfirmed/); assert.equal(calls, 1);
  } finally { assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir())); await rm(directory, { recursive: true, force: true }); }
});
