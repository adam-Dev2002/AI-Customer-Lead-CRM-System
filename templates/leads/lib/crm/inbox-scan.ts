import type { CRMData, InboxScan } from './types.ts';

export const inboxFailureCopy: Record<string, string> = {
  'gmail-access': 'Google access needs attention. Open Connections to review the account and permissions.',
  'gmail-busy': 'Google is busy or its usage limit was reached. The next scheduled inbox check will try again.',
  'gmail-unavailable': 'The inbox could not be fetched. The next scheduled check will try again. Review Connections if this continues.',
  'setup-failed': 'The inbox connection check failed before emails could be fetched. Review Connections or contact support.',
  'processing-failed': 'An email could not finish processing. Completed inquiries are kept. Contact support before retrying that email.',
};
export function parseInboxScan(input: Record<string, unknown>, now: string): InboxScan | null {
  if (typeof input.runId !== 'string' || !/^[\w-]{1,100}$/.test(input.runId)) return null;
  if (!['checking', 'processing', 'complete', 'failed'].includes(String(input.phase))) return null;
  const started = typeof input.startedAt === 'string' ? Date.parse(input.startedAt) : NaN;
  if (!Number.isFinite(started) || started > Date.parse(now) + 60000 || started < Date.parse(now) - 7 * 86400000) return null;
  for (const key of ['matched', 'current']) if (input[key] !== undefined && (!Number.isSafeInteger(input[key]) || Number(input[key]) < 0 || Number(input[key]) > 1000)) return null;
  if (input.current !== undefined && (input.matched === undefined || Number(input.current) > Number(input.matched))) return null;
  return { runId: input.runId, phase: input.phase as InboxScan['phase'], startedAt: new Date(started).toISOString(), updatedAt: now, matched: input.matched as number | undefined, current: input.current as number | undefined, code: input.phase === 'failed' ? (typeof input.code === 'string' && Object.hasOwn(inboxFailureCopy, input.code) ? input.code : 'processing-failed') : undefined };
}
export function recordInboxScan(data: CRMData, next: InboxScan) {
  const old = data.inboxScan;
  if (old) {
    if (Date.parse(next.startedAt) < Date.parse(old.startedAt)) return false;
    if (next.runId === old.runId) {
      if (old.phase === 'failed' || (old.phase === 'complete' && next.phase !== 'failed')) return false;
      if (old.phase === 'processing' && next.phase === 'checking') return false;
      if (next.phase === 'processing' && (next.current || 0) < (old.current || 0)) return false;
    }
  }
  data.inboxScan = next;
  return true;
}
export function inboxScanView(scan?: InboxScan, now = Date.now()) {
  if (!scan) return { state: 'waiting', title: 'Waiting for the first inbox check', detail: 'Open Connections to check that inquiry processing is enabled. Inbox checks normally run every five minutes.' };
  const age = now - Date.parse(scan.updatedAt);
  if (scan.phase === 'failed') return { state: 'failed', title: 'Inbox processing needs attention', detail: inboxFailureCopy[scan.code || ''] || inboxFailureCopy['processing-failed'] };
  if (age > (scan.phase === 'processing' ? 15 : 8) * 60000) return { state: 'delayed', title: 'Inbox check is overdue', detail: 'No recent inbox result has arrived. Processing may be paused or the connection may be offline. Review Connections; refreshing this page only checks saved status.' };
  if (scan.phase === 'checking') return { state: 'running', title: 'Checking your Gmail inbox', detail: 'Checking the account and looking for incoming emails that have not been handled.' };
  if (scan.phase === 'processing') return { state: 'running', title: scan.current ? `Processing email ${scan.current} of ${scan.matched}` : `Found ${scan.matched} matching email${scan.matched === 1 ? '' : 's'}`, detail: 'Inquiries appear as each email finishes. Messages that do not qualify are skipped.' };
  return { state: 'complete', title: scan.matched === 0 ? 'Inbox checked — no new matching emails' : 'Inbox check completed', detail: scan.matched ? `${scan.matched} matching email${scan.matched === 1 ? ' was' : 's were'} checked. View incoming inquiries and skipped messages in Activity.` : 'No unhandled emails matched the inbox search. The next check normally runs within five minutes.' };
}
