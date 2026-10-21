// Private, read-only export. Pause CRM/n8n writers for a consistent cutover backup.
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudConfiguration, cloudRPC, cloudRequest } from '../templates/leads/lib/crm/cloud-store.ts';
import { readPrivateFile, privateFileKey } from '../templates/leads/lib/crm/private-files.ts';
const root = fileURLToPath(new URL('../', import.meta.url));
const environmentFlag = process.argv.indexOf('--environment-file');
const environmentFile = environmentFlag >= 0 ? path.resolve(process.argv[environmentFlag + 1]) : path.join(root, 'templates/leads/.env.local');
try {
  if (!cloudConfiguration()) throw new Error('Select Supabase storage for a cloud backup.');
  const snapshot = await cloudRPC('crm_store_read');
  const directory = path.join(root, '.local-preview/data-backups', 'supabase-export-' + new Date().toISOString().replaceAll(':', '-'));
  const dataDirectory = path.join(directory, 'crm-data');
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  await writeFile(path.join(dataDirectory, 'crm.json'), JSON.stringify(snapshot.data, null, 2), { mode: 0o600 });
  let files = 0;
  async function exportPrefix(prefix) {
    for (let offset = 0; ; offset += 100) {
      const response = await cloudRequest('/storage/v1/object/list/crm-private', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: 'name', order: 'asc' } }) });
      if (!response.ok) throw new Error('Cloud files could not be listed.');
      const entries = await response.json();
      if (!Array.isArray(entries)) throw new Error('Invalid cloud file list.');
      for (const entry of entries) {
        if (typeof entry.name !== 'string' || !entry.name || /[\\/]/.test(entry.name) || ['.', '..'].includes(entry.name)) throw new Error('Unexpected cloud file name.');
        const key = `${prefix}/${entry.name}`;
        if (!entry.id) {
          if (prefix !== 'reports' || !/^[a-f0-9-]{36}$/.test(entry.name)) throw new Error('Unexpected cloud file directory.');
          await exportPrefix(key); continue;
        }
        privateFileKey(key);
        const filename = path.join(dataDirectory, key.startsWith('config/') ? key.slice(7) : key);
        await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
        await writeFile(filename, await readPrivateFile(key), { mode: 0o600 }); files++;
      }
      if (entries.length < 100) break;
    }
  }
  await exportPrefix('config'); await exportPrefix('reports');
  const latest = await cloudRPC('crm_store_read');
  const consistent = latest.revision === snapshot.revision;
  await copyFile(environmentFile, path.join(directory, 'environment.env'));
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ at: new Date().toISOString(), revision: snapshot.revision, consistent, privateFiles: files, leads: snapshot.data.leads.length, drafts: snapshot.data.drafts.length }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ directory, consistent, privateFiles: files }));
  if (!consistent) throw new Error('Workspace changed during backup. Pause writers and repeat before using it for restoration.');
} catch { console.error('Cloud backup could not be verified. Pause writers, verify private configuration, and repeat. Existing source/cloud data was not changed.'); process.exitCode = 1; }
