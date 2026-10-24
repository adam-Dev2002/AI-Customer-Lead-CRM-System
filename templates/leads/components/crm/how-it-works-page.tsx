"use client";
import { inboxHref } from "@/lib/crm/inbox-navigation";
import { ActionIcon } from "./action-icon";
import { useState } from "react";
import Link from "next/link";
import { BookOpen, Inbox, Sparkles, Users, Send, Clock3, ShieldCheck, Activity, Save, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { workflowCoverage } from "@/lib/crm/workflow-coverage";
import { activityStatusLabels, syncChangeCopy } from "@/lib/crm/customer-copy";
import { activityAppearance } from "@/lib/crm/activity-appearance";
import { ActivityMark, activityColors } from "./activity-mark";
import { useCRM } from "./provider";
import { UsageFaq } from "./usage-faq";
import { InboxProcessing } from './inbox-processing';
import { dateSortValue, dateSortLabels, sortRecords, type SortOption } from "@/lib/crm/record-sort";
import type { SyncChange } from "@/lib/crm/types";
import { matchesSelection } from "@/lib/crm/record-filter";
import { RecordFilters, FilterSelect, SearchFilter, SortControls, useRecordSort, sortFilter } from "./record-controls";
import { EmptyState, PageHeading, Pager, Panel, StatusBadge, useFormat } from "./shared";

export function HowItWorksPage() {
  const { data, run, busy, refresh } = useCRM();
  const format = useFormat();
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const { sort, changeSort, resetSort } = useRecordSort("updatedAt", "desc", () => setPage(1));
  const options: SortOption<SyncChange>[] = [
    { key: "updatedAt", label: "Last updated", value: c => dateSortValue(c.updatedAt), ...dateSortLabels },
    { key: "title", label: "Change", value: c => syncChangeCopy(c).title },
    { key: "customer", label: "Customer", value: c => data.leads.find(l => l.id === c.leadId)?.name },
  ];
  const changes = sortRecords(data.syncChanges.filter(c => {
    const copy = syncChangeCopy(c), lead = data.leads.find(l => l.id === c.leadId);
    return matchesSelection(filter, c.status) && `${copy.title} ${copy.detail} ${lead?.name || ""}`.toLowerCase().includes(query.trim().toLowerCase());
  }), sort, options);
  const activePage = Math.min(page, Math.max(1, Math.ceil(changes.length / 10)));
  const events = data.activities.filter(a => a.type === "automation").slice(0, 12);
  const steps = [
    { title: "Read the inquiry", detail: "See customer emails and form requests together in your inbox.", href: "/inbox", icon: Inbox, tone: "blue" },
    { title: "Review the suggestion", detail: "Read the AI summary and edit the suggested reply in Inbox's AI replies tab.", href: inboxHref("replies"), icon: Sparkles, tone: "violet" },
    { title: "Keep details up to date", detail: "Set the priority, assign an owner and keep useful notes on the lead.", href: "/leads", icon: Users, tone: "blue" },
    { title: "Approve, then send", detail: "Approve the finished reply, then confirm the recipient and send it.", href: inboxHref("replies"), icon: Send, tone: "emerald" },
    { title: "Follow up with care", detail: `One follow-up can run after ${data.settings.followUpHours} hours when the customer agrees and the inquiry is eligible.`, href: "/follow-ups", icon: Clock3, tone: "amber" },
  ];

  return (
    <div className="space-y-6">
      <PageHeading title="How it works" description="Your guide to customer inquiries, replies and everyday tasks.">
        <Button variant="outline" disabled={refreshing} onClick={async () => {
          setRefreshing(true);
          try { await refresh(); } finally { setRefreshing(false); }
        }}><ActionIcon action="retry" className={refreshing ? "animate-spin motion-reduce:animate-none" : undefined} />Refresh status</Button>
        <Button asChild><Link href="/settings"><ActionIcon action="settings" />Manage preferences</Link></Button>
      </PageHeading>
      <InboxProcessing />

      <div className="crm-guide-banner flex flex-col justify-between gap-5 rounded-xl border p-5 sm:p-6 lg:flex-row lg:items-center">
        <div className="flex items-start gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-card text-primary"><BookOpen className="size-5" /></span>
          <div className="max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">A little guidance, whenever you need it</p>
            <h2 className="mt-2 text-lg font-semibold tracking-tight">Make every customer inquiry easier to manage.</h2>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">Start with your inbox, review replies at your own pace, and keep the next step clear. You stay in control of every suggested reply.</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild variant="outline"><Link href="#faq"><ActionIcon action="help" />Common questions</Link></Button>
          <Button asChild><Link href="/inbox"><ActionIcon action="inbox" />Open inbox</Link></Button>
        </div>
      </div>

      <Panel title="From inquiry to follow-up" icon={BookOpen}>
        <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-5">
          {steps.map((step, i) => (
            <Link key={step.title} href={step.href} data-tone={step.tone} className="crm-interactive crm-step-card rounded-lg border p-4">
              <div className="flex items-center justify-between"><span className="crm-panel-mark flex size-9 items-center justify-center rounded-lg"><step.icon className="size-4" /></span><span className="text-[11px] font-semibold text-muted-foreground">0{i + 1}</span></div>
              <h3 className="mt-4 text-sm font-semibold">{step.title}</h3>
              <p className="mt-2 text-xs leading-6 text-muted-foreground">{step.detail}</p>
              <ActionIcon action="view" className="crm-tone-icon mt-3" />
            </Link>
          ))}
        </div>
      </Panel>

      <UsageFaq />

      <section id="manual-email" className="scroll-mt-5">
        <Panel title="Replying to customers" icon={Send} tone="emerald">
          <div className="space-y-4 p-5">
            <div className="flex items-start gap-3 rounded-lg border border-emerald-200/70 bg-emerald-50/60 p-4 dark:border-emerald-900 dark:bg-emerald-950/20">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-700 dark:text-emerald-300" />
              <p className="text-sm leading-7 text-muted-foreground">Open an inquiry, review or write its reply, and approve the finished message. Choose Send via Gmail and confirm the recipient to send it. <span className="font-medium text-foreground">Approval on its own does not send an email.</span></p>
            </div>
            <div className="rounded-lg border bg-muted/25 p-4">
              <p className="break-all text-sm font-medium">{data.connection.mailSenderEmail ? "Sending account: " + data.connection.mailSenderEmail : "Sending account not available"}</p>
              <p className="mt-2 text-xs leading-6 text-muted-foreground">{data.connection.lastMailPollAt ? "Last checked " + format(data.connection.lastMailPollAt, true) + ". Follow the progress from Queued to Sent in Outgoing replies." : "Email sending needs attention from support. You can still read inquiries and prepare replies."}</p>
            </div>
            <div className="flex flex-wrap gap-2"><Button asChild><Link href="/inbox"><ActionIcon action="inbox" />Open inbox</Link></Button><Button asChild variant="outline"><Link href={inboxHref("replies")}><ActionIcon action="review" />Review replies</Link></Button></div>
          </div>
        </Panel>
      </section>

      <section id="coverage" className="scroll-mt-5">
        <Panel title="Find your way around" icon={LayoutGrid} tone="blue">
          <p className="border-b p-5 text-xs leading-6 text-muted-foreground">Choose a tool to open it. You can adjust your business preferences in Settings at any time.</p>
          <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-3">
            {workflowCoverage.map(item => <Link key={item.name} href={item.href} aria-label={"Open " + item.name} className="crm-interactive rounded-lg border p-4">
              <div className="flex items-start justify-between gap-3"><h3 className="text-sm font-medium">{item.name}</h3><ActionIcon action="view" className="text-primary" /></div>
              <p className="mt-2 text-[11px] font-medium text-primary">{item.page}</p><p className="mt-2 text-xs leading-6 text-muted-foreground">{item.detail}</p>
            </Link>)}
          </div>
        </Panel>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Latest inquiry activity", value: data.connection.lastEventAt ? "Activity received" : "No activity yet", detail: data.connection.lastEventAt ? "Last update " + format(data.connection.lastEventAt, true) : "New inquiries and results will appear here", tone: "blue" },
          { label: "Updates waiting", value: data.connection.pendingChanges, detail: "Saved changes waiting to finish updating", tone: "violet" },
          { label: "Updates needing attention", value: data.connection.failedChanges, detail: "Review these updates before trying again", tone: "amber" },
          { label: "Business preferences", value: data.connection.lastConfigReadAt ? "Last checked" : "Not checked yet", detail: data.connection.lastConfigReadAt ? format(data.connection.lastConfigReadAt, true) : "Your saved preferences are waiting to be checked", tone: "emerald" },
        ].map(item => <div key={item.label} data-tone={item.tone} className="crm-stat-card rounded-xl border p-5"><p className="text-xs text-muted-foreground">{item.label}</p><p className="crm-stat-value mt-3 text-lg font-semibold">{item.value}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{item.detail}</p></div>)}
      </div>

      <section id="sync" className="scroll-mt-5">
        <Panel title="Saved changes" icon={Save} tone="emerald">
          <RecordFilters onClear={() => { setFilter("all"); setQuery(""); resetSort(); setPage(1); }}
          search={<SearchFilter aria-label="Search saved changes" placeholder="Search customer or change…" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} />}
          hasSearch={!!query.trim()}
          filters={[
            { label: "Status", value: filter, onRemove: () => { setFilter("all"); setPage(1); }, displayValue: ({ Pending: "Waiting", Applied: "Saved", Failed: "Needs attention" } as Record<string, string>)[filter] },
            sortFilter(sort, options, "updatedAt:desc", resetSort),
          ]}
        >
            <FilterSelect label="Status" aria-label="Filter saved changes" value={filter} onValueChange={value => { setFilter(value); setPage(1); }}><option value="all">All changes</option><option value="Pending">Waiting</option><option value="Applied">Saved</option><option value="Failed">Needs attention</option></FilterSelect>
            
            <SortControls sort={sort} options={options} onChange={changeSort} />
          </RecordFilters>
          <p className="border-b p-5 text-xs leading-6 text-muted-foreground">Changes save in your dashboard first, then update the shared records. Waiting means the update is still in progress. Retrying a saved change does not resend an email.</p>
          {changes.length ? <div className="divide-y">{changes.slice((activePage - 1) * 10, activePage * 10).map(change => {
            const copy = syncChangeCopy(change);
            const lead = data.leads.find(l => l.id === change.leadId);
            return <div key={change.id} data-record-id={change.id} className="flex flex-wrap items-start justify-between gap-3 p-5"><div className="min-w-0 flex-1"><p className="text-sm font-medium">{copy.title}{lead ? " - " + lead.name : ""}</p><p className="mt-1 text-xs text-muted-foreground">{format(change.updatedAt, true)}</p><p className="mt-2 break-words text-xs leading-6 text-muted-foreground">{copy.detail}</p></div><StatusBadge value={change.status === "Applied" ? "Saved" : change.status === "Pending" ? "Waiting" : "Needs attention"} />{change.status === "Failed" && <Button variant="outline" size="sm" disabled={busy} onClick={() => void run("sync.retry", { id: change.id }, "Your saved change will be tried again.")}><ActionIcon action="retry" />Retry update</Button>}</div>;
          })}</div> : <EmptyState title="No changes waiting" description="Your lead edits and reply reviews will appear here." />}
          <Pager page={activePage} count={changes.length} size={10} onChange={setPage} />
        </Panel>
      </section>

      <Panel title="Recent automatic activity" icon={Activity} tone="blue">
        {events.length ? <div className="divide-y">{events.map(event => {
          const copy = activityAppearance(event);
          return <div key={event.id} data-activity-tone={copy.tone} className="flex items-start gap-3 p-5"><ActivityMark type={event.type} tone={copy.tone} className="mt-0.5 size-8" /><div className="min-w-0 flex-1"><p className={`text-sm font-medium ${activityColors[copy.tone].text}`}>{copy.title}</p>{copy.detail && <p className="mt-1 break-words text-xs leading-6 text-muted-foreground">{copy.detail}</p>}<p className="mt-2 text-xs text-muted-foreground">{format(event.createdAt, true)}</p></div>{event.status && <StatusBadge value={activityStatusLabels[event.status]} />}</div>;
        })}</div> : <EmptyState title="No automatic activity yet" description="Inquiry checks, suggested replies and follow-up results will appear here." />}
      </Panel>
    </div>
  );
}
