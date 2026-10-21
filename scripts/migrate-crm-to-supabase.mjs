// Default: local read-only plan. --apply --source-stopped imports without overwriting.
// Run with Node --env-file=templates/leads/.env.local --experimental-strip-types.
import { readFile, writeFile, mkdir, readdir, cp, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { cloudConfiguration, cloudRequest, cloudRPC } from '../templates/leads/lib/crm/cloud-store.ts';
import { privateFileKey, readPrivateFile, writePrivateFile } from '../templates/leads/lib/crm/private-files.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2), apply = args.includes('--apply'), check = args.includes('--check');
const sourceArg = args.indexOf('--data-dir');
const source = path.resolve(sourceArg >= 0 ? args[sourceArg + 1] : path.join(root, 'templates/leads/.data'));
const canonical = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const stateHash = value => hash(JSON.stringify(canonical(value)));
const counts = data => Object.fromEntries(['leads','drafts','tasks','activities','syncChanges','mailJobs'].map(key => [key, data[key].length]));
async function remoteWorkspace() {
  const response = await cloudRequest('/rest/v1/rpc/crm_store_read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const result = await response.json();
  if (response.ok) return result;
  if (result.code === 'P0002') return null;
  throw new Error('Run supabase/migrations/202610210001_crm_cloud_storage.sql in the existing project, and verify SUPABASE_SECRET_KEY.');
}
try {
  const original = await readFile(path.join(source, 'crm.json'));
  const data = JSON.parse(original.toString('utf8'));
  if (data.version !== 1 || !data.settings || !['leads','drafts','tasks','activities','syncChanges','mailJobs','processedEventIds','archivedLeadIds'].every(key => Array.isArray(data[key]))) throw new Error('Source CRM is incomplete. Nothing was imported.');
  const files = [];
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name === 'crm.json') continue;
    if (entry.isSymbolicLink()) throw new Error('Do not migrate symbolic links.');
    if (entry.isFile() && ['assistant-gemini.json','google-contact-photos.json','customer-form.json'].includes(entry.name)) files.push({ source: path.join(source, entry.name), key: `config/${entry.name}` });
    else if (entry.isDirectory() && entry.name === 'reports') {
      for (const report of await readdir(path.join(source, 'reports'), { withFileTypes: true })) {
        if (!report.isDirectory() || report.isSymbolicLink() || !/^[a-f0-9-]{36}$/.test(report.name)) throw new Error('Unexpected report directory. Review source files before importing.');
        for (const item of await readdir(path.join(source, 'reports', report.name), { withFileTypes: true })) {
          if (!item.isFile() || item.isSymbolicLink()) throw new Error('Unexpected report content.');
          const key = privateFileKey(`reports/${report.name}/${item.name}`);
          files.push({ source: path.join(source, 'reports', report.name, item.name), key });
        }
      }
    } else throw new Error('Unexpected private data file or active temporary write. Review the source before importing.');
  }
  console.log(JSON.stringify({ mode: apply ? 'import' : check ? 'verify' : 'plan', source, counts: counts(data), privateFiles: files.length, cloudWrites: apply, localBackendChanged: false }));
  if (!apply && !check) { console.log('Plan only. Stop source writers, then use --apply --source-stopped. No customer data or secrets were printed.'); process.exit(0); }
  if (apply && !args.includes('--source-stopped')) throw new Error('Stop the local CRM and n8n writers before importing; then pass --source-stopped.');
  process.env.CRM_STORAGE_BACKEND = 'supabase';
  cloudConfiguration();
  const existing = await remoteWorkspace();
  if (existing && stateHash(existing.data) !== stateHash(data)) throw new Error('A different cloud workspace already exists. It was not overwritten. Compare cloud/local state before continuing.');
  if (check && !existing) throw new Error('The cloud workspace has not been imported yet.');
  let backup;
  if (apply) {
    backup = path.join(root, '.local-preview/data-backups', 'before-supabase-' + new Date().toISOString().replaceAll(':', '-'));
    await mkdir(backup, { recursive: true, mode: 0o700 });
    await cp(source, path.join(backup, 'crm-data'), { recursive: true, errorOnExist: true, force: false });
    if (source === path.resolve(root, 'templates/leads/.data')) {
      try { await copyFile(path.join(root, 'templates/leads/.env.local'), path.join(backup, 'environment.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  for (const file of files) {
    const bytes = await readFile(file.source);
    if (apply) await writePrivateFile(file.key, bytes);
    const remote = await readPrivateFile(file.key);
    if (hash(bytes) !== hash(remote)) throw new Error('Private file verification failed. No workspace activation was performed.');
  }
  if (hash(await readFile(path.join(source, 'crm.json'))) !== hash(original)) throw new Error('The local workspace changed during import. Stop all writers and retry.');
  if (apply && !existing) await cloudRPC('crm_store_import', { p_data: data });
  const verified = await remoteWorkspace();
  if (!verified || stateHash(verified.data) !== stateHash(data)) throw new Error('Cloud state verification failed. Leave the local backend unchanged.');
  if (apply) await writeFile(path.join(backup, 'verified-import.json'), JSON.stringify({ at: new Date().toISOString(), stateSHA256: stateHash(data), counts: counts(data), privateFiles: files.length }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ verified: true, exactWorkspaceMatch: true, counts: counts(verified.data), verifiedPrivateFiles: files.length, backup, localBackendChanged: false }));
  console.log('Verified. Set CRM_STORAGE_BACKEND=supabase in the private environment and restart the CRM before restarting n8n. Keep the source backup.');
} catch (error) {
  // Never print provider bodies, customer JSON, environment values or tokens.
  console.error(error?.message?.includes('key') || error?.message?.includes('Cloud') || error?.message?.includes('cloud') || error?.message?.includes('Source') || error?.message?.includes('source') || error?.message?.includes('import') || error?.message?.includes('Unexpected') || error?.message?.includes('Stop') || error?.message?.includes('Run supabase') || error?.message?.includes('Private') || error?.message?.includes('migrate') ? error.message : 'Migration could not finish. Source data was preserved; check private configuration and file access.');
  process.exitCode = 1;
}
