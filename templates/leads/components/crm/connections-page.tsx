"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, Circle, ExternalLink, FileSpreadsheet, Loader2, Mail, Pause, Plug, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PublicConnectionStatus } from '@/lib/connections/status';
import { oauthResultMessage } from '@/lib/connections/status';
import { PageHeading, Panel, StatusBadge } from './shared';
import { useCRM } from './provider';

const ordered = ['google', 'labels', 'spreadsheet', 'gmail-credential', 'sheets-credential', 'crm-credential', 'register', 'workflow', 'verify', 'complete'];
const milestones = [
  { title: 'Connect your Google account', detail: 'Choose the Gmail or Google Workspace inbox for this business.', index: 0, icon: Mail },
  { title: 'Prepare your inbox', detail: 'Add labels that keep processed inquiries organized.', index: 1, icon: Mail },
  { title: 'Create your spreadsheet', detail: 'Create a new spreadsheet in your Google account with the required columns.', index: 2, icon: FileSpreadsheet },
  { title: 'Connect your services', detail: 'Keep this business’s inbox, spreadsheet and records connected.', index: 3, icon: Plug },
  { title: 'Check the connection', detail: 'Verify the account and spreadsheet before processing starts.', index: 8, icon: ShieldCheck },
];
export function ConnectionsPage() {
  const { data } = useCRM();
  const [status, setStatus] = useState<PublicConnectionStatus | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [confirmed, setConfirmed] = useState(false);
  const advancing = useRef(false);
  const reload = useCallback(async () => {
    const response = await fetch('/api/connections/google', { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not check your connection.');
    setStatus(result as PublicConnectionStatus); return result as PublicConnectionStatus;
  }, []);
  useEffect(() => { setError(oauthResultMessage(new URL(window.location.href).searchParams.get('connectionError'))); reload().catch(e => setError(e.message)); }, [reload]);
  async function action(value: string) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/connections/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: value, confirmed }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not update your connection.');
      if (result.authorizationUrl) { window.location.assign(result.authorizationUrl); return; }
      if (value === 'pause') setConfirmed(false);
      await reload();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update your connection.'); await reload().catch(() => {}); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!status || status.managed || status.phase === 'attention' || advancing.current || (status.phase !== 'setting-up' && !status.pending) || (!status.pending && (status.step === 'google' || status.step === 'complete'))) return;
    const timer = setTimeout(async () => {
      advancing.current = true;
      try {
        if (status.pending) await reload();
        else await action('advance');
      } catch {
        setError('Could not check your connection. Checking again shortly.');
        setStatus(current => current ? { ...current } : current);
      } finally { advancing.current = false; }
    }, status.pending ? 2500 : 350);
    return () => clearTimeout(timer);
  // Each saved step schedules the next request. A remount resumes confirmed steps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, reload]);
  const current = status ? ordered.indexOf(status.step) : -1;
  const ready = status?.phase === 'ready' || status?.phase === 'paused';
  const lastPoll = [data.lastSyncPollAt, data.lastMailPollAt].filter(Boolean).sort().at(-1);
  return <div className="space-y-6">
    <PageHeading title="Connections" description="Connect the email account your business uses for customer inquiries." />
    <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
      <Panel title="Your business email" icon={Mail}>
        <div className="space-y-5 p-5 sm:p-6">
          {!status && !error && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" />Checking your connection…</p>}
          {status && <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-medium">{status.email || (status.managed ? data.mailSenderEmail || 'Existing business connection' : 'Gmail and Google Workspace')}</p><p className="mt-1 text-xs text-muted-foreground">Private to this business workspace</p></div><StatusBadge value={status.managed ? 'Managed connection' : status.phase === 'active' ? 'Processing enabled' : status.phase === 'ready' ? 'Ready to enable' : status.phase === 'setting-up' ? 'Setting up' : status.phase === 'attention' ? 'Needs attention' : status.phase === 'paused' ? 'Paused' : 'Not connected'} /></div>}
          {status?.message && <p role="status" className="rounded-lg border bg-muted/30 p-3 text-sm leading-6 text-muted-foreground">{status.message}</p>}
          {error && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
          {status?.available && !status.managed && <>
            {['not-connected', 'authorizing'].includes(status.phase) && <><p className="text-sm leading-6 text-muted-foreground">Google will ask you to approve access to read and organize inquiries, prepare and send replies, and create the spreadsheet used by this service. You choose the account; we never ask for your Google password.</p><Button disabled={busy} onClick={() => action('connect')}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}Connect Google</Button></>}
            {status.phase === 'setting-up' && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" />Preparing your connection. You can return to this page to continue.</p>}
            {status.canRetry && <Button disabled={busy} variant="outline" onClick={() => action('advance')}>Retry setup step</Button>}
            {ready && <div className="space-y-4 rounded-lg border bg-muted/20 p-4"><label className="flex cursor-pointer items-start gap-3 text-sm leading-6"><input type="checkbox" className="mt-1 size-4 accent-primary" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> <span>I confirm that {status.email} is the inbox this business should process. Existing email preferences will apply.</span></label><Button disabled={busy || !confirmed || status.pending} onClick={() => action('enable')}>{(busy || status.pending) && <Loader2 className="size-4 animate-spin" />}{status.pending ? 'Waiting for processing to start…' : 'Enable inquiry processing'}</Button></div>}
            {status.phase === 'active' && <><p className="text-sm leading-6 text-muted-foreground">Inquiry processing is enabled. New emails are normally checked every five minutes. Reply approval and the separate sending confirmation still apply.</p><Button disabled={busy || status.pending} variant="outline" onClick={() => action('pause')}><Pause className="size-4" />{status.pending ? 'Waiting for processing to pause…' : 'Pause processing'}</Button></>}
          </>}
          {status?.spreadsheetUrl && <Button asChild variant="outline"><a href={status.spreadsheetUrl} target="_blank" rel="noopener noreferrer"><FileSpreadsheet className="size-4" />Open your spreadsheet<ExternalLink className="size-3.5" /></a></Button>}
          {ready && <p className="text-sm leading-6 text-muted-foreground">Review your <Link className="text-primary underline underline-offset-4" href="/settings">business details and reply preferences</Link> before enabling processing. AI suggestions and automatic emails follow those preferences.</p>}
          {lastPoll && <p className="text-xs text-muted-foreground">Last background check received: {new Date(lastPoll).toLocaleString()}. Enabled processing still needs an available connection.</p>}
          {status?.phase === 'active' && !status.managed && !lastPoll && <p role="status" className="text-xs text-muted-foreground">Waiting for the first background check.</p>}
          <p className="border-t pt-4 text-xs leading-6 text-muted-foreground">Connecting your account and checking setup sends no customer email. You can keep automatic emails off in Settings while testing. Only your business owner can change this connection.</p>
        </div>
      </Panel>
      <Panel title="Connection setup" icon={ShieldCheck}><ol className="space-y-5 p-5 sm:p-6">{milestones.map((step, index) => {
        const done = Boolean(status?.managed || current > step.index + (step.index === 3 ? 4 : 0));
        const active = !done && current >= step.index && (index === milestones.length - 1 || current < milestones[index + 1].index);
        return <li key={step.title} className="flex items-start gap-3"><span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${done ? 'bg-emerald-500/10 text-emerald-600' : active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>{done ? <Check className="size-4" /> : active && status?.phase === 'setting-up' ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <Circle className="size-3" />}</span><div><p className="text-sm font-medium">{step.title}</p><p className="mt-1 text-xs leading-6 text-muted-foreground">{step.detail}</p></div></li>;
      })}</ol></Panel>
    </div>
  </div>;
}
