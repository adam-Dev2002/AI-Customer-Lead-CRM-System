import { readFile } from 'node:fs/promises';
import path from 'node:path';

// A migration must restore the real workspace before the server can start.
// Missing storage must never silently create a fresh seeded workspace.
try {
  if (!process.env.CRM_DATA_DIR || !path.isAbsolute(process.env.CRM_DATA_DIR)) throw new Error('Set an absolute CRM_DATA_DIR for the persistent volume.');
  const data = JSON.parse(await readFile(path.join(process.env.CRM_DATA_DIR, 'crm.json'), 'utf8'));
  if (data.version !== 1 || !data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings) || !['leads', 'drafts', 'tasks', 'activities', 'mailJobs', 'syncChanges'].every(key => Array.isArray(data[key]))) throw new Error('The restored CRM workspace file is incomplete or unsupported.');
  if (!process.env.N8N_WEBHOOK_SECRET?.trim()) throw new Error('Restore the existing CRM integration secret before startup.');
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()) throw new Error('Configure the existing Supabase public URL and publishable key.');
} catch (error) {
  // Do not include file contents, tokens or customer details in startup errors.
  console.error('CRM not started. Restore the complete CRM data directory and required environment configuration.');
  if (error?.code === 'ENOENT') console.error('The persistent volume does not contain crm.json.');
  else if (error instanceof SyntaxError) console.error('The restored workspace file is not valid JSON.');
  else console.error(error.message);
  process.exit(1);
}
await import('./server.js');
