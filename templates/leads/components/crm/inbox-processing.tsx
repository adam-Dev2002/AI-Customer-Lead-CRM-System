"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, Clock3, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { inboxScanView } from '@/lib/crm/inbox-scan';
import { useCRM } from './provider';
import { useFormat } from './shared';

export function InboxProcessing() {
  const { data, refresh } = useCRM(), format = useFormat();
  const [now, setNow] = useState(() => Date.now()), [refreshing, setRefreshing] = useState(false);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(timer); }, []);
  const view = inboxScanView(data.inboxScan, now);
  const attention = ['failed', 'delayed'].includes(view.state);
  const Icon = view.state === 'running' ? Loader2 : attention ? AlertCircle : view.state === 'complete' ? CheckCircle2 : Clock3;
  return <section aria-label="Inbox processing" className={`rounded-xl border bg-card p-4 sm:p-5 ${attention ? 'border-amber-300/70 dark:border-amber-800' : ''}`}>
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
      <div className="flex min-w-0 gap-3">
        <Icon aria-hidden className={`mt-0.5 size-5 shrink-0 ${view.state === 'running' ? 'animate-spin text-primary motion-reduce:animate-none' : attention ? 'text-amber-600 dark:text-amber-400' : view.state === 'complete' ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`} />
        <div className="min-w-0 space-y-1.5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Email processing</p>
          <p role="status" aria-live="polite" className="text-sm font-semibold">{view.title}</p>
          <p className="max-w-2xl text-xs leading-6 text-muted-foreground">{view.detail}</p>
          {data.inboxScan && <p className="text-[11px] text-muted-foreground">Last update {format(data.inboxScan.updatedAt, true)}</p>}
          {!data.settings.aiClassification && <p className="text-xs leading-6 text-muted-foreground">AI replies are off in Settings. Eligible inquiries can still be captured.</p>}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={refreshing} onClick={async () => { setRefreshing(true); try { await refresh(); setNow(Date.now()); } finally { setRefreshing(false); } }}><RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin motion-reduce:animate-none' : ''}`} />Refresh status</Button>
        {(attention || view.state === 'waiting') && <Button asChild variant="outline" size="sm"><Link href="/connections">Review connection</Link></Button>}
      </div>
    </div>
  </section>;
}
