import { NextResponse } from 'next/server';
import { requireWorkspaceAccess } from '../auth/server';
import { ConnectionError, connectionConfig, connectionMessage } from './config.ts';
import { randomUUID } from 'node:crypto';
export async function connectionAccess() {
  const access = await requireWorkspaceAccess();
  if (access.response) return access;
  if (access.user.role !== 'owner') return { user: null, response: NextResponse.json({ error: connectionMessage('owner-only') }, { status: 403 }) };
  return access;
}
export function requireConnectionConfig() {
  const config = connectionConfig();
  if (!config) throw new ConnectionError('setup-unavailable');
  return config;
}
export function connectionFailure(error: unknown) {
  const code = error instanceof ConnectionError ? error.code : 'setup-unavailable';
  const requestId = randomUUID();
  console.error('Business connection request failed', { requestId, code });
  return NextResponse.json({ error: connectionMessage(code), code, requestId }, { status: code === 'connection-busy' ? 409 : code === 'owner-only' ? 403 : 503, headers: { 'Cache-Control': 'private, no-store' } });
}
