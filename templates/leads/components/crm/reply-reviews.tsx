"use client";
import { ActionIcon } from "./action-icon";
import { useState } from "react";
import Link from "next/link";
import { inboxHref } from "@/lib/crm/inbox-navigation";
import { Sparkles, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Draft } from "@/lib/crm/types";
import { dateSortLabels, dateSortValue, sortRecords, type SortOption } from "@/lib/crm/record-sort";
import { matchesSelection } from "@/lib/crm/record-filter";
import { RecordFilters, FilterSelect, SearchFilter, SortControls, useRecordSort, sortFilter } from "./record-controls";
import { useCRM } from "./provider";
import { SyncStatus } from "./sync-status";
import { SendReply } from "./mail-controls";
import {
  Panel,
  StatusBadge,
  PersonAvatar,
  EmptyState,
  Field,
  textareaClass,
  useFormat,
  Confirm,
} from "./shared";

function DraftEditor({ draft }: { draft: Draft }) {
  const { data, run, busy, notify } = useCRM(),
    format = useFormat();
  const lead = data.leads.find((l) => l.id === draft.leadId)!;
  const [body, setBody] = useState(draft.body),
    [subject, setSubject] = useState(draft.subject),
    [reject, setReject] = useState(false);
  const changed = body !== draft.body || subject !== draft.subject;
  const deliveryLocked = data.mailJobs.some(
    (j) => j.draftId === draft.id && j.status !== "Cancelled",
  );
  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
        <div className="flex items-center gap-3">
          <PersonAvatar name={lead.name} email={lead.email} photoUrl={lead.photoUrl} />
          <div>
            <Link href={`/leads/${lead.id}`} className="text-sm font-semibold hover:underline">
              {lead.name}
              <ActionIcon action="view" className="ml-1 inline" />
            </Link>
            <p className="mt-1 text-xs text-muted-foreground">{lead.email}</p>
          </div>
        </div>
        <StatusBadge value={draft.status} />
      </div>
      <div className="space-y-5 p-5">
        <SyncStatus leadId={lead.id} />
        <div className="rounded-lg border border-violet-200 bg-violet-50 p-4 dark:border-violet-900 dark:bg-violet-950/30">
          <p className="flex items-center gap-2 text-xs font-semibold text-violet-700 dark:text-violet-300">
            <Sparkles className="size-3.5" />
            {draft.provider.toLowerCase().includes("manual")
              ? "Manual reply"
              : "AI suggested reply"}
          </p>
          <p className="mt-2 text-xs leading-6 text-muted-foreground">
            {draft.reason || "Check the details before approving this reply."}
          </p>
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Original inquiry · {lead.service}
          </p>
          <p className="whitespace-pre-wrap rounded-lg bg-muted/50 p-4 text-sm leading-6">
            {lead.message}
          </p>
        </div>
        <Field label="Reply subject">
          <Input
            value={subject}
            disabled={deliveryLocked}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={250}
          />
        </Field>
        <Field label="Reply body">
          <textarea
            className={`${textareaClass} min-h-[260px] leading-7`}
            value={body}
            disabled={deliveryLocked}
            onChange={(e) => setBody(e.target.value)}
            maxLength={10000}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy || !changed || deliveryLocked}
            onClick={() =>
              void run("draft.save", { id: draft.id, body, subject }, "Draft saved for review.")
            }
          >
            <ActionIcon action="save" />
            Save draft
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(`${subject}\n\n${body}`);
                notify("Reply copied to clipboard.");
              } catch {
                notify("Clipboard is unavailable. Select and copy the reply text.", true);
              }
            }}
          >
            <ActionIcon action="copy" />
            Copy reply
          </Button>
          {draft.gmailDraftId && (
            <Button asChild variant="outline">
              <a href="https://mail.google.com/mail/u/0/#drafts" target="_blank" rel="noreferrer">
                <ActionIcon action="external" />
                Gmail drafts
              </a>
            </Button>
          )}
        </div>
      </div>
      <div className="border-t p-5">
        <div className="mb-4 flex items-start gap-2.5 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#6e3ff3]" />
          <p className="leading-6">
            Approve the reply after checking its details. Use Send via Gmail below when you are
            ready to send it.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[10px] text-muted-foreground">
            Updated {format(draft.updatedAt, true)}
            {changed ? " · Unsaved changes" : ""}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={busy || deliveryLocked || draft.status === "Rejected"}
              onClick={() => setReject(true)}
            >
              <ActionIcon action="reject" />
              Reject
            </Button>
            <Button
              disabled={busy || deliveryLocked || (draft.status === "Approved" && !changed)}
              onClick={() =>
                void run(
                  "draft.approve",
                  { id: draft.id, body, subject },
                  "Reply approved locally. No email sent.",
                )
              }
            >
              <ActionIcon action="approve" />
              Approve reply
            </Button>
          </div>
        </div>
      </div>
      <SendReply draft={draft} lead={lead} changed={changed} />
      <Confirm
        open={reject}
        onOpenChange={setReject}
        title="Reject this reply?"
        description="This draft will be marked rejected. You can still edit it and save a revised draft for review."
        label="Reject reply"
        icon="reject"
        onConfirm={() => run("draft.reject", { id: draft.id }, "Reply rejected.")}
      />
    </Panel>
  );
}
export function ReplyReviews({
  leadId,
  draftId,
  onSelectReply,
}: {
  leadId: string | null;
  draftId: string | null;
  onSelectReply: (draft: Draft) => void;
}) {
  const { data } = useCRM();
  const leadById = new Map(data.leads.map(lead => [lead.id, lead]));
  const [status, setStatus] = useState("all"),
    [query, setQuery] = useState("");
  const { sort, changeSort, resetSort } = useRecordSort("createdAt", "desc");
  const options: SortOption<Draft>[] = [
    { key: "createdAt", label: "Created", value: d => dateSortValue(d.createdAt), ...dateSortLabels },
    { key: "updatedAt", label: "Last updated", value: d => dateSortValue(d.updatedAt), ...dateSortLabels },
    { key: "customer", label: "Customer", value: d => leadById.get(d.leadId)?.name },
    { key: "subject", label: "Subject", value: d => d.subject },
    { key: "status", label: "Review status", value: d => d.status },
  ];
  const filtered = sortRecords(data.drafts.filter((d) => {
    const l = leadById.get(d.leadId);
    return (
      l &&
      matchesSelection(status, d.status) &&
      `${l.name} ${d.subject} ${l.email}`.toLowerCase().includes(query.trim().toLowerCase())
    );
  }), sort, options);
  const missingReply = leadId && !data.drafts.some((draft) => draft.leadId === leadId);
  const selected = missingReply
    ? undefined
    : filtered.find((draft) => draft.id === draftId && (!leadId || draft.leadId === leadId)) ||
      filtered.find((draft) => draft.leadId === leadId && draft.status !== "Rejected") ||
      filtered.find((draft) => draft.leadId === leadId) ||
      filtered[0];
  return (
    <div className="space-y-6">
      <p className="text-sm leading-6 text-muted-foreground">
        Review suggested or manually written replies. Approve the reply, then confirm sending when
        you are ready.
      </p>
      <div className="grid items-start gap-5 xl:grid-cols-[320px_1fr]">
        <Panel>
          <RecordFilters compact onClear={() => { setStatus("all"); setQuery(""); resetSort(); }}
          search={<SearchFilter
                placeholder="Search drafts…"
                aria-label="Search drafts"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />}
          hasSearch={!!query.trim()}
          filters={[
            { label: "Review status", value: status, onRemove: () => setStatus("all") },
            sortFilter(sort, options, "createdAt:desc", resetSort),
          ]}
        >
              
            <FilterSelect label="Review status"
              className="w-full"
              aria-label="Filter draft status"
              value={status}
              onValueChange={(value) => setStatus(value)}
            >
              <option value="all">All replies</option>
              {["Pending review", "Approved", "Rejected"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </FilterSelect>
            <SortControls sort={sort} options={options} onChange={changeSort} />
          </RecordFilters>
          <p role="status" className="border-b px-4 py-2 text-xs text-muted-foreground">{filtered.length} matching replies</p>
          <div className="max-h-[640px] overflow-auto">
            {filtered.map((d) => {
              const l = leadById.get(d.leadId)!;
              return (
                <button
                  key={d.id}
                  data-record-id={d.id}
                  aria-pressed={selected?.id === d.id}
                  onClick={() => onSelectReply(d)}
                  className="crm-inquiry-row block w-full border-b border-l-2 border-l-transparent p-4 text-left last:border-b-0"
                >
                  <div className="mb-3 flex items-center gap-2.5">
                    <PersonAvatar name={l.name} email={l.email} photoUrl={l.photoUrl} />
                    <span className="min-w-0 truncate text-sm font-medium">{l.name}</span>
                  </div>
                  <p className="whitespace-normal break-words text-xs leading-5">{d.subject}</p>
                  <p className="my-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {d.body}
                  </p>
                  <StatusBadge value={d.status} />
                </button>
              );
            })}
            {!filtered.length && (
              <EmptyState
                title="No matching drafts"
                description="Create a reply from an inquiry, or change your filters."
              />
            )}
          </div>
        </Panel>
        {selected ? (
          <DraftEditor key={`${selected.id}:${selected.updatedAt}`} draft={selected} />
        ) : (
          <Panel>
            <EmptyState
              title={missingReply ? "No reply for this inquiry yet" : "No replies to review"}
              description="Open an inquiry to write a reply. AI suggestions appear when a customer email needs a response and a suitable reply is available."
              action={
                <Button asChild>
                  <Link href={inboxHref("inquiries", leadId)} scroll={false}>
                    <ActionIcon action="inbox" />
                    Open inquiry
                  </Link>
                </Button>
              }
            />
          </Panel>
        )}
      </div>
    </div>
  );
}
