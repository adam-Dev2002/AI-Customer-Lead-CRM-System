"use client";
import { ActionIcon } from "./action-icon";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useCRM } from "./provider";
import { OutgoingMail } from "./outgoing-mail";
import { ReplyReviews } from "./reply-reviews";
import { InquiryPreview } from "./inquiry-preview";
import { inboxHref, inboxViews, readInboxView, type InboxView } from "@/lib/crm/inbox-navigation";
import type { Draft } from "@/lib/crm/types";
import { leadStatuses, priorities } from "@/lib/crm/types";
import { leadSortOptions, sortRecords } from "@/lib/crm/record-sort";
import { matchesSelection } from "@/lib/crm/record-filter";
import { RecordFilters, FilterSelect, SearchFilter, SortControls, useRecordSort, sortFilter } from "./record-controls";
import {
  Panel,
  PageHeading,
  StatusBadge,
  PersonAvatar,
  EmptyState,
  useFormat,
} from "./shared";
export function InboxPage() {
  const { data } = useCRM(),
    params = useSearchParams(),
    router = useRouter();
  const view = readInboxView(params.get("view")),
    leadId = params.get("lead"),
    draftId = params.get("draft");
  const [visited, setVisited] = useState<Set<InboxView>>(() => new Set([view]));
  useEffect(() => {
    setVisited(current => current.has(view) ? current : new Set([...current, view]));
  }, [view]);
  const pendingReplies = data.drafts.filter((draft) => draft.status === "Pending review").length;
  const sending = data.mailJobs.filter(
    (job) => job.status === "Queued" || job.status === "Sending",
  ).length;
  const tabs = [
    { view: "inquiries", label: "Incoming inquiries", action: "inbox", count: 0 },
    { view: "replies", label: "AI replies", action: "assistant", count: pendingReplies },
    { view: "outgoing", label: "Outgoing emails", action: "send", count: sending },
  ] as const;
  function switchView(next: InboxView) {
    router.push(inboxHref(next, leadId, draftId), { scroll: false });
  }
  function selectLead(id: string) {
    router.replace(inboxHref(view, id), { scroll: false });
  }
  function selectReply(draft: Draft) {
    router.replace(inboxHref("replies", draft.leadId, draft.id), { scroll: false });
  }
  return (
    <div className="space-y-6">
      <PageHeading
        title="Customer inbox"
        description="Read inquiries, review AI replies and track outgoing emails in one place."
      />
      <div
        role="tablist"
        aria-label="Inbox views"
        className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap"
        onKeyDown={(event) => {
          const index = inboxViews.indexOf(view);
          const next =
            event.key === "ArrowRight"
              ? inboxViews[(index + 1) % inboxViews.length]
              : event.key === "ArrowLeft"
                ? inboxViews[(index + inboxViews.length - 1) % inboxViews.length]
                : event.key === "Home"
                  ? inboxViews[0]
                  : event.key === "End"
                    ? inboxViews[inboxViews.length - 1]
                    : null;
          if (!next) return;
          event.preventDefault();
          switchView(next);
          document.getElementById(`inbox-tab-${next}`)?.focus();
        }}
      >
        {tabs.map((tab) => (
          <Button
            key={tab.view}
            id={`inbox-tab-${tab.view}`}
            role="tab"
            aria-selected={view === tab.view}
            aria-controls={`inbox-panel-${tab.view}`}
            tabIndex={view === tab.view ? 0 : -1}
            variant={view === tab.view ? "default" : "outline"}
            className="h-auto min-h-10 min-w-0 gap-1.5 whitespace-normal px-2 py-2 text-xs sm:px-3 sm:text-sm"
            onClick={() => switchView(tab.view)}
          >
            <ActionIcon action={tab.action} />
            <span>{tab.label}</span>
            {tab.count > 0 && (
              <span className="rounded bg-current/10 px-1.5 text-[10px] tabular-nums">
                {tab.count}
              </span>
            )}
          </Button>
        ))}
      </div>
      {/* Mount a panel on first use, then keep it mounted to preserve unsaved edits. */}
      {tabs.map((tab) => (
        <div
          key={tab.view}
          id={`inbox-panel-${tab.view}`}
          role="tabpanel"
          aria-labelledby={`inbox-tab-${tab.view}`}
          hidden={view !== tab.view}
          tabIndex={0}
          className="min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {(view === tab.view || visited.has(tab.view)) && (tab.view === "inquiries" ? (
            <IncomingInquiries leadId={leadId} onSelectLead={selectLead} />
          ) : tab.view === "replies" ? (
            <ReplyReviews leadId={leadId} draftId={draftId} onSelectReply={selectReply} />
          ) : (
            <OutgoingMail />
          ))}
        </div>
      ))}
    </div>
  );
}

function IncomingInquiries({
  leadId,
  onSelectLead,
}: {
  leadId: string | null;
  onSelectLead: (id: string) => void;
}) {
  const { data, run, busy } = useCRM(),
    format = useFormat(),
    router = useRouter();
  const [query, setQuery] = useState(""),
    [source, setSource] = useState("all"),
    [status, setStatus] = useState("all"),
    [priority, setPriority] = useState("all"),
    [visibleCount, setVisibleCount] = useState(50);
  const { sort, changeSort, resetSort } = useRecordSort("createdAt", "desc", () => setVisibleCount(50));
  const leads = sortRecords(data.leads.filter(
    (l) =>
      matchesSelection(source, l.source) &&
      matchesSelection(status, l.status) && matchesSelection(priority, l.priority) &&
      `${l.name} ${l.email} ${l.service} ${l.message} ${l.summary}`.toLowerCase().includes(query.trim().toLowerCase()),
  ), sort, leadSortOptions);
  const selected = leads.find((l) => l.id === leadId) || leads[0],
    draft = data.drafts.find((d) => d.leadId === selected?.id && d.status !== "Rejected");
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[330px_1fr]">
      <Panel>
        <RecordFilters compact onClear={() => { setQuery(""); setSource("all"); setStatus("all"); setPriority("all"); resetSort(); setVisibleCount(50); }}
          search={<SearchFilter
              placeholder="Search inquiries…"
              aria-label="Search inquiries"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setVisibleCount(50); }}
          />}
          hasSearch={!!query.trim()}
          filters={[
            { label: "Source", value: source, onRemove: () => { setSource("all"); setVisibleCount(50); } },
            { label: "Status", value: status, onRemove: () => { setStatus("all"); setVisibleCount(50); } },
            { label: "Priority", value: priority, onRemove: () => { setPriority("all"); setVisibleCount(50); } },
            sortFilter(sort, leadSortOptions, "createdAt:desc", resetSort),
          ]}
        >
          
          <FilterSelect label="Source"
            className="w-full"
            aria-label="Inquiry source"
            value={source}
            onValueChange={(value) => { setSource(value); setVisibleCount(50); }}
          >
            <option value="all">All channels</option>
            {Array.from(new Set(data.leads.map((l) => l.source))).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </FilterSelect>
          <div className="grid grid-cols-2 gap-2">
            <FilterSelect label="Status" aria-label="Inquiry status" value={status} onValueChange={value => { setStatus(value); setVisibleCount(50); }}><option value="all">All statuses</option>{leadStatuses.map(s => <option key={s}>{s}</option>)}</FilterSelect>
            <FilterSelect label="Priority" aria-label="Inquiry priority" value={priority} onValueChange={value => { setPriority(value); setVisibleCount(50); }}><option value="all">All priorities</option>{priorities.map(s => <option key={s}>{s}</option>)}</FilterSelect>
          </div>
          <SortControls sort={sort} options={leadSortOptions.filter(option => ["createdAt", "name", "service", "priority"].includes(option.key))} onChange={changeSort} />
        </RecordFilters>
        <p role="status" className="border-b px-4 py-2 text-xs text-muted-foreground">{leads.length} matching inquiries</p>
        <div className="max-h-[670px] overflow-auto">
          {leads.slice(0, visibleCount).map((l) => (
            <button
              key={l.id}
              data-record-id={l.id}
              aria-pressed={selected?.id === l.id}
              className="crm-inquiry-row block w-full border-b border-l-2 border-l-transparent p-4 text-left last:border-b-0"
              onClick={() => onSelectLead(l.id)}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <PersonAvatar name={l.name} email={l.email} photoUrl={l.photoUrl} />
                  <span className="truncate text-sm font-medium">{l.name}</span>
                </div>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {format(l.createdAt)}
                </span>
              </div>
              <div className="mt-2"><InquiryPreview lead={l} compact /></div>
              <div className="mt-3 flex items-center gap-2">
                <StatusBadge value={l.status} />
                <span className="text-[10px] text-muted-foreground">
                  {l.source}
                  {l.isSample ? " · Sample" : ""}
                </span>
              </div>
            </button>
          ))}
          {leads.length > 50 && (
            <div className="space-y-3 border-t p-4 text-center">
              <p className="text-xs text-muted-foreground">Showing {Math.min(visibleCount, leads.length)} of {leads.length} inquiries</p>
              {visibleCount < leads.length && <Button variant="outline" size="sm" onClick={() => setVisibleCount(count => count + 50)}>Load more inquiries</Button>}
            </div>
          )}
          {!leads.length && (
            <EmptyState
              title="No inquiries found"
              description="Try another search or add a lead."
            />
          )}
        </div>
      </Panel>
      <Panel>
        {selected ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b p-5">
              <div className="flex items-center gap-3">
                <PersonAvatar
                  name={selected.name}
                  email={selected.email}
                  photoUrl={selected.photoUrl}
                />
                <div>
                  <p className="font-semibold">{selected.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{selected.email}</p>
                </div>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href={`/leads/${selected.id}`}>
                  <ActionIcon action="view" />
                  Lead details
                </Link>
              </Button>
            </div>
            <div className="space-y-5 p-5 sm:p-6">
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <StatusBadge value={selected.priority} />
                  <StatusBadge value={selected.category} />
                </div>
                <h2 className="break-words text-lg font-semibold [overflow-wrap:anywhere]">{selected.service}</h2>
                <p className="mt-2 text-xs text-muted-foreground">
                  {format(selected.createdAt, true)} · {selected.source}
                </p>
              </div>
              <p className="min-h-32 whitespace-pre-wrap break-words text-sm leading-8 [overflow-wrap:anywhere]">{selected.message}</p>
              {selected.summary && selected.summary !== selected.message && (
                <div className="rounded-lg border bg-muted/25 p-4">
                  <p className="text-xs font-medium">AI summary</p>
                  <p className="mt-2 text-sm leading-7">{selected.summary}</p>
                </div>
              )}
              <div className="rounded-lg border bg-muted/25 p-4">
                <p className="text-xs font-medium">Follow-up permission</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {selected.consent
                    ? "Customer permitted one follow-up while this inquiry is open."
                    : "Customer has not permitted an automatic follow-up."}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t p-5">
              {draft ? (
                <Button asChild>
                  <Link href={inboxHref("replies", selected.id, draft.id)} scroll={false}>
                    <ActionIcon action="review" />
                    {draft.status === "Approved" ? "View approved reply" : "Review reply draft"}
                  </Link>
                </Button>
              ) : (
                <Button
                  disabled={busy}
                  onClick={async () => {
                    if (
                      await run(
                        "draft.create",
                        { leadId: selected.id },
                        "Manual reply draft created.",
                      )
                    )
                      router.push(inboxHref("replies", selected.id), { scroll: false });
                  }}
                >
                  <ActionIcon action="createReply" />
                  Create reply draft
                </Button>
              )}
              {["New", "Pending"].includes(selected.status) && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      "lead.update",
                      { id: selected.id, status: "Contacted" },
                      "Inquiry marked as contacted.",
                    )
                  }
                >
                  <ActionIcon action="approve" />
                  Mark contacted
                </Button>
              )}
              {selected.gmailThreadId && (
                <Button variant="outline" asChild>
                  <a
                    href={`https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(selected.gmailThreadId)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ActionIcon action="external" />
                    Open Gmail
                  </a>
                </Button>
              )}
            </div>
          </>
        ) : (
          <EmptyState
            title="Your inbox is clear"
            description="Customer inquiries will appear here when you create or import leads."
          />
        )}
      </Panel>
    </div>
  );
}
