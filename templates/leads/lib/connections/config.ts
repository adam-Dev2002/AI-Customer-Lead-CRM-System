import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export class ConnectionError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}
export function connectionConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.CRM_GOOGLE_CONNECTIONS_ENABLED !== 'true') return null;
  const mode = env.CRM_N8N_CONNECTION_MODE || 'direct';
  if (!['direct', 'pull'].includes(mode)) throw new ConnectionError('setup-unavailable');
  const required = ['CRM_PUBLIC_ORIGIN', 'CRM_GOOGLE_CLIENT_ID', 'CRM_GOOGLE_CLIENT_SECRET', 'CRM_CONNECTION_ENCRYPTION_KEY', 'CRM_N8N_GEMINI_CREDENTIAL_ID', 'CRM_N8N_GEMINI_MODEL', ...(mode === 'pull' ? ['CRM_N8N_WORKER_KEY', 'CRM_N8N_WORKER_ID'] : ['CRM_N8N_API_URL', 'CRM_N8N_API_KEY', 'CRM_N8N_SETUP_KEY'])];
  if (required.some(key => !env[key]?.trim())) throw new ConnectionError('setup-unavailable');
  function origin(raw: string) {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new ConnectionError('setup-unavailable');
    return url.origin;
  }
  try {
    const key = Buffer.from(env.CRM_CONNECTION_ENCRYPTION_KEY!, 'base64');
    if (key.length !== 32) throw new Error();
    if (mode === 'pull' && ((env.CRM_N8N_WORKER_KEY?.length || 0) < 32 || !/^[\w-]{8,64}$/.test(env.CRM_N8N_WORKER_ID || ''))) throw new Error();
    return { mode: mode as 'direct' | 'pull', origin: origin(env.CRM_PUBLIC_ORIGIN!), n8nOrigin: mode === 'direct' ? origin(env.CRM_N8N_API_URL!) : '', clientId: env.CRM_GOOGLE_CLIENT_ID!.trim(), clientSecret: env.CRM_GOOGLE_CLIENT_SECRET!.trim(), encryptionKey: key, apiKey: env.CRM_N8N_API_KEY?.trim() || '', setupKey: env.CRM_N8N_SETUP_KEY?.trim() || '', workerKey: env.CRM_N8N_WORKER_KEY?.trim() || '', workerId: env.CRM_N8N_WORKER_ID?.trim() || '', geminiCredentialId: env.CRM_N8N_GEMINI_CREDENTIAL_ID!.trim(), geminiModel: env.CRM_N8N_GEMINI_MODEL!.trim() };
  } catch { throw new ConnectionError('setup-unavailable'); }
}
export type ConnectionConfig = NonNullable<ReturnType<typeof connectionConfig>>;
export function sealConnection(value: unknown, workspace: string, key: Buffer) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('crm-google-connection:v1:' + workspace));
  const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}
export function openConnection<T>(sealed: string, workspace: string, key: Buffer): T {
  try {
    const [version, iv, tag, data, extra] = sealed.split('.');
    if (version !== 'v1' || extra || Buffer.from(iv, 'base64url').length !== 12) throw new Error();
    const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    cipher.setAAD(Buffer.from('crm-google-connection:v1:' + workspace));
    cipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return JSON.parse(Buffer.concat([cipher.update(Buffer.from(data, 'base64url')), cipher.final()]).toString());
  } catch { throw new ConnectionError('setup-unavailable'); }
}
export function connectionMessage(code: string) {
  const messages: Record<string, string> = {
    'setup-unavailable': 'Email connection setup is not available yet. Please contact support.',
    'existing-connection': 'This business already has an email connection. Contact support to change it safely.',
    'owner-only': 'Only the business owner can manage this connection.',
    'google-denied': 'Google access was not approved. You can connect again when ready.',
    'google-permissions': 'Approve the requested Gmail and spreadsheet permissions to finish connecting.',
    'google-reconnect': 'Google access needs to be renewed. Please contact support to reconnect safely.',
    'oauth-invalid': 'This connection link expired or was already used. Start Connect Google again.',
    'connection-busy': 'Connection setup is already in progress. Please wait.',
    'uncertain-result': 'A setup result could not be confirmed. Contact support before trying again.',
    'provider-unavailable': 'The connected service is unavailable. Please try again shortly.',
    'verification-failed': 'The final connection check did not finish. Your completed setup is saved. Recheck the connection to try again.',
    'connection-changed': 'The saved background connection differs from this business’s setup. Your account and spreadsheet are kept. Contact support to review the connection safely.',
    'connection-active': 'This business’s background connection is already enabled. Contact support to check it before continuing setup.',
    'connection-missing': 'The background connection could not be found. Your Google account and spreadsheet are kept. Contact support to restore the connection safely.',
    'google-account-changed': 'Google returned a different account from the one connected to this business. Contact support to check the connection safely.',
    'spreadsheet-changed': 'The connected spreadsheet is missing required setup tabs. Restore the Leads and ReplyReviews tabs or contact support, then recheck the connection.',
    'not-ready': 'Finish connecting and checking your account before enabling processing.',
    'worker-offline': 'Your email connection is temporarily offline. Please try again shortly or contact support.',
  };
  return messages[code] || 'The connection could not be updated. Please contact support.';
}
