import { NextResponse } from 'next/server';
import { connectionConfig, ConnectionError } from '@/lib/connections/config';
import { connectionFailure } from '@/lib/connections/access';
import { claimConnectionJob, finishConnectionJob, workerAuthorized } from '@/lib/connections/pull';
import { cloudRPC } from '@/lib/crm/cloud-store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    const config = connectionConfig();
    if (!config || !workerAuthorized(request.headers.get('authorization'), config)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    const raw = await request.text();
    if (raw.length > 8000) return NextResponse.json({ error: 'Request too large.' }, { status: 413 });
    let body;
    try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
    if (!body || body.workerId !== config.workerId) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    let result;
    if (body.action === 'heartbeat' && typeof body.ready === 'boolean') result = { accepted: await cloudRPC('crm_onboarding_heartbeat', { p_worker_id: config.workerId, p_ready: body.ready }) === true };
    else if (!/^[a-f0-9-]{36}$/.test(body.claimId || '')) throw new ConnectionError('verification-failed');
    else if (body.action === 'claim') result = { job: await claimConnectionJob(body.claimId, config) };
    else if (body.action === 'complete' && /^[a-f0-9-]{36}$/.test(body.jobId || '')) result = await finishConnectionJob(body.jobId, body.claimId, body.result, config);
    else return NextResponse.json({ error: 'Choose a worker action.' }, { status: 400 });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return connectionFailure(error); }
}
