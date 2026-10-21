"use client";
import { ActionIcon } from "./action-icon";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useCRM } from "./provider";
import { MailDelivery } from "./mail-controls";
import { inboxHref } from "@/lib/crm/inbox-navigation";
import type { MailJob } from "@/lib/crm/types";
import { dateSortLabels, dateSortValue, sortRecords, type SortOption } from "@/lib/crm/record-sort";
import { matchesSelection } from "@/lib/crm/record-filter";
import { RecordFilters, FilterSelect, SearchFilter, SortControls, useRecordSort, sortFilter } from "./record-controls";
import { EmptyState, Panel, PersonAvatar, StatusBadge, useFormat } from "./shared";

export function OutgoingMail() {
  const { data } = useCRM(), format = useFormat();
  const leadById = new Map(data.leads.map(lead => [lead.id, lead]));
  const [status, setStatus] = useState("all"), [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const { sort, changeSort, resetSort } = useRecordSort("createdAt", "desc");
  const options: SortOption<MailJob>[] = [
    { key: "createdAt", label: "Created", value: j => dateSortValue(j.createdAt), ...dateSortLabels },
    { key: "sentAt", label: "Sent time", value: j => dateSortValue(j.sentAt), ...dateSortLabels },
    { key: "customer", label: "Customer", value: j => leadById.get(j.leadId)?.name || j.to },
    { key: "subject", label: "Subject", value: j => j.subject },
    { key: "status", label: "Delivery status", value: j => j.status },
  ];
  const jobs = sortRecords(data.mailJobs.filter(j => matchesSelection(status, j.status) &&
    `${j.to} ${j.subject} ${leadById.get(j.leadId)?.name || ""}`.toLowerCase().includes(query.trim().toLowerCase())), sort, options);
  const selected = jobs.find(j => j.id === selectedId) || jobs[0];
  const selectedLead = selected && leadById.get(selected.leadId);
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[330px_1fr]">
      <Panel>
        <RecordFilters compact onClear={() => { setStatus("all"); setQuery(""); resetSort(); }}
          search={<SearchFilter aria-label="Search outgoing emails" placeholder="Search customer or subject…" value={query} onChange={e => setQuery(e.target.value)} />}
          hasSearch={!!query.trim()}
          filters={[
            { label: "Delivery status", value: status, onRemove: () => setStatus("all") },
            sortFilter(sort, options, "createdAt:desc", resetSort),
          ]}
        >
          
          <FilterSelect label="Delivery status" aria-label="Outgoing reply status" className="w-full" value={status} onValueChange={value => setStatus(value)}>
            <option value="all">All outgoing replies</option>
            {["Queued", "Sending", "Sent", "Needs Review", "Cancelled"].map(s => <option key={s}>{s}</option>)}
          </FilterSelect>
          <SortControls sort={sort} options={options} onChange={changeSort} />
        </RecordFilters>
        <p role="status" className="border-b px-4 py-2 text-xs text-muted-foreground">{jobs.length} matching emails</p>
        <div className="max-h-[670px] overflow-auto">
          {jobs.map(job => {
            const lead = leadById.get(job.leadId);
            return (
              <button key={job.id} data-record-id={job.id} onClick={() => setSelectedId(job.id)} aria-pressed={selected?.id === job.id}
                className="crm-inquiry-row block w-full space-y-2 border-b border-l-2 border-l-transparent p-4 text-left last:border-b-0">
                <div className="flex min-w-0 items-center gap-2.5">
                  <PersonAvatar name={lead?.name || job.to} email={job.to} photoUrl={lead?.email === job.to ? lead.photoUrl : undefined} />
                  <p className="min-w-0 truncate text-sm font-medium">{lead?.name || job.to}</p>
                </div>
                <p className="whitespace-normal break-words text-xs leading-5">{job.subject}</p>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <StatusBadge value={job.status} />
                  <span className="text-[10px] text-muted-foreground">{format(job.createdAt, true)}</span>
                </div>
              </button>
            );
          })}
        </div>
        {!jobs.length && <EmptyState title="No outgoing replies" description="Replies you confirm in the draft editor will appear here with their delivery result." />}
      </Panel>
      <Panel>
        {selected ? (
          <div className="space-y-5 p-5">
            <div className="flex items-center gap-3">
              <PersonAvatar name={selectedLead?.name || selected.to} email={selected.to} photoUrl={selectedLead?.email === selected.to ? selectedLead.photoUrl : undefined} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{selectedLead?.name || selected.to}</p>
                <p className="mt-1 break-all text-xs text-muted-foreground">To: {selected.to}</p>
              </div>
            </div>
            <h2 className="break-words text-lg font-semibold">{selected.subject}</h2>
            <MailDelivery job={selected} />
            <p className="whitespace-pre-wrap break-words text-sm leading-8">{selected.body}</p>
            {selected.kind === "lead-report" ? <div className="flex flex-wrap gap-2"><Button asChild variant="outline"><a href={`/api/crm/reports/${selected.reportId}?format=pdf`}><ActionIcon action="download" />Download report PDF</a></Button><Button asChild variant="outline"><a href={`/api/crm/reports/${selected.reportId}?format=xlsx`}><ActionIcon action="download" />Download Excel workbook</a></Button></div> : <Button asChild variant="outline"><Link href={inboxHref("replies", selected.leadId, selected.draftId)}><ActionIcon action="review" />Open reply</Link></Button>}
          </div>
        ) : <EmptyState title="Your sent replies, together" description="Review queued emails and confirmed Gmail sends here. Automatic acknowledgement and follow-up results appear on their lead records." />}
      </Panel>
    </div>
  );
}
