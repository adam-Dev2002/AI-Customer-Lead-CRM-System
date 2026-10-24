import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ConnectionError, type ConnectionConfig } from './config.ts';
import type { BusinessConnection, GoogleToken } from './store.ts';

export const googleScopes = ['https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/drive.file'];
export const connectionCookie = 'crm-google-connection';
export function oauthStart(config: ConnectionConfig) {
  const state = randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url');
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.origin + '/api/connections/google/callback', response_type: 'code', scope: googleScopes.join(' '), access_type: 'offline', prompt: 'consent select_account', include_granted_scopes: 'false', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
  return { state, url: url.toString(), oauth: { hash: createHash('sha256').update(state).digest('hex'), verifier, expires: Date.now() + 600_000 } };
}
export function validOAuth(data: BusinessConnection, userId: string, state: string, cookie: string, now = Date.now()) {
  if (!data.oauth || data.userId !== userId || data.oauth.expires < now || !/^[\w-]{43}$/.test(state) || cookie !== state) return false;
  const hash = createHash('sha256').update(state).digest();
  const expected = Buffer.from(data.oauth.hash, 'hex');
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

// An unknown mutation outcome is deliberately not retried: remote services may
// have created a resource even if the response was lost. No raw provider errors
// or token-bearing URLs are logged or returned to the browser.
export async function remoteJSON(url: string, init: RequestInit, mutation = false, request: typeof fetch = fetch, timeout = 12000) {
  try {
    const response = await request(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(timeout), cache: 'no-store' });
    if (!response.ok) {
      if (mutation && (response.status >= 500 || [408, 409].includes(response.status))) throw new ConnectionError('uncertain-result');
      throw new ConnectionError(response.status === 401 ? 'google-reconnect' : 'provider-unavailable');
    }
    const body = await response.json().catch(() => { throw new ConnectionError(mutation ? 'uncertain-result' : 'provider-unavailable'); });
    return body;
  } catch (error) {
    if (error instanceof ConnectionError) throw error;
    throw new ConnectionError(mutation ? 'uncertain-result' : 'provider-unavailable');
  }
}
function checkedToken(body: Record<string, unknown>, previous?: GoogleToken): GoogleToken {
  const scope = typeof body.scope === 'string' ? body.scope : previous?.scope || '';
  const granted = new Set(scope.split(' '));
  if (!googleScopes.every(s => granted.has(s))) throw new ConnectionError('google-permissions');
  if (typeof body.access_token !== 'string' || (!body.refresh_token && !previous?.refresh_token)) throw new ConnectionError('google-reconnect');
  const seconds = Number(body.expires_in);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 86400) throw new ConnectionError('google-reconnect');
  return { access_token: body.access_token, refresh_token: typeof body.refresh_token === 'string' ? body.refresh_token : previous!.refresh_token, expires_at: Date.now() + seconds * 1000, scope, token_type: 'Bearer' };
}
export async function exchangeGoogleCode(config: ConnectionConfig, code: string, verifier: string, request: typeof fetch = fetch) {
  const body = await remoteJSON('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code, code_verifier: verifier, redirect_uri: config.origin + '/api/connections/google/callback', grant_type: 'authorization_code' }) }, false, request);
  return checkedToken(body);
}
export async function refreshGoogleToken(config: ConnectionConfig, previous: GoogleToken, request: typeof fetch = fetch) {
  const body = await remoteJSON('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: previous.refresh_token, grant_type: 'refresh_token' }) }, false, request);
  return checkedToken(body, previous);
}
export async function googleJSON(token: GoogleToken, resource: string, body?: unknown, method?: string, request: typeof fetch = fetch) {
  // Call sites select fixed Google endpoints; clients never supply a resource URL.
  if (!/^https:\/\/(gmail|sheets)\.googleapis\.com\//.test(resource)) throw new ConnectionError('verification-failed');
  return remoteJSON(resource, { method: method || (body ? 'POST' : 'GET'), headers: { Authorization: 'Bearer ' + token.access_token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }, Boolean(body), request);
}
export async function googleMailbox(token: GoogleToken, request: typeof fetch = fetch) {
  const profile = await googleJSON(token, 'https://gmail.googleapis.com/gmail/v1/users/me/profile', undefined, undefined, request);
  if (typeof profile.emailAddress !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.emailAddress)) throw new ConnectionError('verification-failed');
  return profile.emailAddress.toLowerCase();
}
export const businessLabels = ['AI-SUPPORT-PROCESSING', 'AI-SUPPORT-DRAFTED', 'AI-SUPPORT-REVIEW', 'AI-SUPPORT-SKIPPED'];
