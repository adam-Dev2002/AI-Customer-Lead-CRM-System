// Operator-only fixed-credential import. Does not expose an editor or accept
// arbitrary CLI arguments, file paths, credential IDs, types or expressions.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

export function authorizedSetup(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string' || expected.length < 32) return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function validateImport(body) {
  if (!body || !/^[a-f0-9-]{36}:(gmail|sheets)$/.test(body.requestId || '')) throw new Error('invalid-request');
  const value = body.credential, data = value?.data, token = data?.oauthTokenData;
  if (!['gmailOAuth2', 'googleSheetsOAuth2Api'].includes(value?.type) || !data || !token) throw new Error('invalid-request');
  if (body.requestId.endsWith(':gmail') !== (value.type === 'gmailOAuth2')) throw new Error('invalid-request');
  const allowed = new Set(['https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/drive.file']);
  if (typeof token.scope !== 'string' || token.scope.split(' ').length !== 2 || new Set(token.scope.split(' ')).size !== 2 || !token.scope.split(' ').every(s => allowed.has(s))) throw new Error('invalid-request');
  for (const field of [data.clientId, data.clientSecret, token.access_token, token.refresh_token]) if (typeof field !== 'string' || field.length < 1 || field.length > 16000 || field.includes('{{')) throw new Error('invalid-request');
  if (!Number.isFinite(Date.parse(token.expires_at)) || token.token_type !== 'Bearer') throw new Error('invalid-request');
  // Rebuild rather than importing caller-supplied fields or expression strings.
  return { name: 'CustomerLead ' + body.requestId, type: value.type, data: { clientId: data.clientId, clientSecret: data.clientSecret, customScopes: true, enabledScopes: token.scope, oauthTokenData: { access_token: token.access_token, refresh_token: token.refresh_token, scope: token.scope, token_type: 'Bearer', expires_at: token.expires_at, expires_in: Number(token.expires_in) || 3600 } } };
}
async function runImport(filename, projectId) {
  await new Promise((resolve, reject) => {
    const child = spawn('n8n', ['import:credentials', '--input', filename, '--projectId', projectId], { stdio: 'ignore', shell: false, timeout: 45000 });
    child.on('error', () => reject(new Error('import-unconfirmed')));
    child.on('exit', code => code === 0 ? resolve() : reject(new Error('import-unconfirmed')));
  });
}
export async function importCredential(body, { directory, projectId, execute = runImport }) {
  const credential = validateImport(body);
  if (!/^[\w-]{1,64}$/.test(projectId || '')) throw new Error('not-configured');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const requestHash = createHash('sha256').update(JSON.stringify(credential)).digest('hex');
  const receipt = path.join(directory, createHash('sha256').update(body.requestId).digest('hex') + '.json');
  let existing;
  try { existing = JSON.parse(await readFile(receipt, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new Error('import-unconfirmed'); }
  if (existing) {
    if (existing.requestHash !== requestHash || existing.state !== 'complete') throw new Error('import-unconfirmed');
    return { id: existing.id };
  }
  const id = randomBytes(12).toString('base64url');
  try { await writeFile(receipt, JSON.stringify({ id, state: 'pending', requestHash }), { flag: 'wx', mode: 0o600 }); }
  catch { throw new Error('import-unconfirmed'); }
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'customerlead-credential-'));
  try {
    const filename = path.join(temporary, 'credential.json');
    await writeFile(filename, JSON.stringify([{ id, ...credential }]), { mode: 0o600 });
    await execute(filename, projectId);
    const complete = receipt + '.tmp';
    await writeFile(complete, JSON.stringify({ id, state: 'complete', requestHash }), { mode: 0o600 });
    await rename(complete, receipt);
    return { id };
  } finally {
    const resolved = path.resolve(temporary);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('customerlead-credential-')) throw new Error('Invalid temporary directory.');
    await rm(resolved, { recursive: true, force: true });
  }
}
