// Read-only maintainer preflight. Prints presence/status, never secret values.
import { connectionConfig } from '../templates/leads/lib/connections/config.ts';
import { connectionPreflight } from '../templates/leads/lib/connections/provision.ts';
import { cloudRPC } from '../templates/leads/lib/crm/cloud-store.ts';
const mode = process.env.CRM_N8N_CONNECTION_MODE || 'direct';
const required = ['CRM_PUBLIC_ORIGIN', 'CRM_GOOGLE_CLIENT_ID', 'CRM_GOOGLE_CLIENT_SECRET', 'CRM_CONNECTION_ENCRYPTION_KEY', 'CRM_N8N_GEMINI_CREDENTIAL_ID', 'CRM_N8N_GEMINI_MODEL', ...(mode === 'pull' ? ['CRM_N8N_WORKER_KEY', 'CRM_N8N_WORKER_ID'] : ['CRM_N8N_API_URL', 'CRM_N8N_API_KEY', 'CRM_N8N_SETUP_KEY'])];
const presence = Object.fromEntries(required.map(name => [name, Boolean(process.env[name]?.trim())]));
let configured = false, databaseReady = false, hostReady = false;
try {
  const config = connectionConfig({ ...process.env, CRM_GOOGLE_CONNECTIONS_ENABLED: 'true' }); configured = Boolean(config);
  if (config) {
    // A nonexistent workspace reads no records and performs no creation.
    const row = await cloudRPC('crm_connection_read', { p_workspace_id: '00000000-0000-4000-a000-000000000000' });
    databaseReady = Number.isSafeInteger(row?.revision);
    await connectionPreflight(config); hostReady = true;
  }
} catch { /* Report safe booleans only; never raw provider/config diagnostics. */ }
console.log(JSON.stringify({ enabled: process.env.CRM_GOOGLE_CONNECTIONS_ENABLED === 'true', mode, configured, presence, databaseReady, hostReady, googleConsentVerified: false, liveSecondBusinessVerified: false }, null, 2));
if (!configured || !databaseReady || !hostReady) process.exitCode = 1;
