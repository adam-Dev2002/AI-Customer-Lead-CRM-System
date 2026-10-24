import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { sameOrigin } from '@/lib/auth/server';
import { cloudRPC } from '@/lib/crm/cloud-store';
import { withWorkspace } from '@/lib/crm/workspace-context';
import { getSnapshot } from '@/lib/crm/storage';
import { connectionAccess, connectionFailure, requireConnectionConfig } from '@/lib/connections/access';
import { ConnectionError, connectionMessage } from '@/lib/connections/config';
import { connectionRepository, nextConnectionStep } from '@/lib/connections/store';
import { connectionCookie, oauthStart } from '@/lib/connections/google';
import { advanceConnection, setProcessing, connectionPreflight } from '@/lib/connections/provision';
import type { PublicConnectionStatus } from '@/lib/connections/status';
import { workerReady } from '@/lib/connections/pull';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  const access = await connectionAccess();
  if (access.response) return access.response;
  const empty: PublicConnectionStatus = { available: false, owner: true, managed: false, phase: 'unavailable', step: 'google', email: '', spreadsheetUrl: '', message: connectionMessage('setup-unavailable'), pending: false, canRetry: false };
  try {
    if (access.user.workspaceId === 'clearflow') return NextResponse.json({ ...empty, managed: true, phase: 'active', message: 'Your existing business connection is managed by support.' }, { headers: { 'Cache-Control': 'private, no-store' } });
    const config = requireConnectionConfig(), record = await connectionRepository(access.user.workspaceId, config).read();
    if (!record.data) {
      const existing = await cloudRPC('crm_workspace_connection', { p_workspace_id: access.user.workspaceId });
      return NextResponse.json({ ...empty, available: !existing, managed: Boolean(existing), phase: existing ? 'active' : 'not-connected', message: existing ? 'Your existing business connection is managed by support.' : '' }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const data = record.data;
    const online = config.mode === 'pull' ? await workerReady(config) : undefined;
    const overdue = Boolean(data.pending && !data.pending.jobId && Date.now() - Date.parse(data.pending.startedAt) > 120000);
    const status: PublicConnectionStatus = { available: true, owner: true, managed: false, phase: overdue ? 'attention' : data.phase, step: nextConnectionStep(data), email: data.email || '', spreadsheetUrl: data.spreadsheetId ? `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}/edit` : '', message: data.error ? connectionMessage(data.error) : online === false && data.pending ? 'Waiting for the background service to reconnect. Your setup request is saved.' : overdue ? connectionMessage('uncertain-result') : '', pending: Boolean(data.pending), canRetry: !data.pending && Boolean(data.google) && data.phase === 'attention' && !['google-reconnect', 'existing-connection', 'uncertain-result'].includes(data.error || ''), workerOnline: online };
    return NextResponse.json(status, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return NextResponse.json(empty, { headers: { 'Cache-Control': 'private, no-store' } }); }
}
export async function POST(request: NextRequest) {
  const access = await connectionAccess();
  if (access.response) return access.response;
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Use the connection controls on this website.' }, { status: 403 });
  try {
    if (access.user.workspaceId === 'clearflow') throw new ConnectionError('existing-connection');
    const config = requireConnectionConfig();
    if (request.headers.get('origin') !== config.origin) throw new ConnectionError('setup-unavailable');
    const raw = await request.text();
    if (raw.length > 1000) return NextResponse.json({ error: 'Request is too large.' }, { status: 413 });
    let body;
    try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Choose a connection action.' }, { status: 400 }); }
    if (!body || typeof body !== 'object' || !['connect', 'advance', 'enable', 'pause'].includes(body.action)) return NextResponse.json({ error: 'Choose a connection action.' }, { status: 400 });
    const repo = connectionRepository(access.user.workspaceId, config);
    if (body.action === 'connect') {
      const record = await repo.read();
      if (record.data?.google || record.data?.pending || await cloudRPC('crm_workspace_connection', { p_workspace_id: access.user.workspaceId })) throw new ConnectionError('existing-connection');
      await connectionPreflight(config);
      const snapshot = await withWorkspace(access.user.workspaceId, getSnapshot), start = oauthStart(config);
      await repo.save(record, { version: 1, id: randomUUID(), userId: access.user.id, businessName: snapshot.settings.businessName, phase: 'authorizing', oauth: start.oauth });
      const response = NextResponse.json({ authorizationUrl: start.url }, { headers: { 'Cache-Control': 'private, no-store' } });
      response.cookies.set(connectionCookie, start.state, { httpOnly: true, secure: true, sameSite: 'lax', path: '/api/connections/google', maxAge: 600 });
      return response;
    }
    if (body.action === 'advance') await advanceConnection(repo, access.user.workspaceId, config);
    else if (body.action === 'enable' || body.action === 'pause') {
      if (body.action === 'enable' && body.confirmed !== true) return NextResponse.json({ error: 'Confirm the connected account before enabling processing.' }, { status: 400 });
      await setProcessing(repo, access.user.workspaceId, config, body.action === 'enable');
    } else return NextResponse.json({ error: 'Choose a connection action.' }, { status: 400 });
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return connectionFailure(error); }
}
