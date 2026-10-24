import { NextRequest, NextResponse } from 'next/server';
import { connectionAccess, requireConnectionConfig } from '@/lib/connections/access';
import { ConnectionError } from '@/lib/connections/config';
import { connectionRepository } from '@/lib/connections/store';
import { connectionCookie, exchangeGoogleCode, googleMailbox, validOAuth } from '@/lib/connections/google';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  const access = await connectionAccess();
  if (access.response) return access.response;
  let config;
  try { config = requireConnectionConfig(); } catch { return NextResponse.json({ error: 'Connection setup is unavailable. Contact support.' }, { status: 503 }); }
  const destination = new URL('/connections', config.origin);
  const repo = connectionRepository(access.user.workspaceId, config);
  try {
    let record = await repo.read();
    const state = request.nextUrl.searchParams.get('state') || '';
    if (access.user.workspaceId === 'clearflow' || !record.data || !validOAuth(record.data, access.user.id, state, request.cookies.get(connectionCookie)?.value || '')) throw new ConnectionError('oauth-invalid');
    const verifier = record.data.oauth!.verifier;
    // Consume state before token exchange. Replayed callbacks cannot repeat it.
    record = await repo.save(record, { ...record.data, oauth: undefined, phase: 'authorizing' });
    if (request.nextUrl.searchParams.has('error')) throw new ConnectionError('google-denied');
    const code = request.nextUrl.searchParams.get('code') || '';
    if (!code || code.length > 2048) throw new ConnectionError('oauth-invalid');
    const google = await exchangeGoogleCode(config, code, verifier), email = await googleMailbox(google);
    await repo.save(record, { ...record.data!, google, email, phase: 'setting-up', error: undefined });
    destination.searchParams.set('connected', 'google');
  } catch (error) {
    const code = error instanceof ConnectionError ? error.code : 'setup-unavailable';
    // Safe code only. Never put authorization codes or provider payloads in URLs.
    destination.searchParams.set('connectionError', code);
  }
  const response = NextResponse.redirect(destination);
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('Cache-Control', 'private, no-store');
  response.cookies.set(connectionCookie, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/api/connections/google', maxAge: 0 });
  return response;
}
