"use client";
import { ActionIcon } from "./action-icon";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Clock3, CheckCircle2, ShieldCheck, AlertCircle, Users, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { canScheduleFollowUp } from "@/lib/crm/domain";
import { leadStatuses, priorities } from "@/lib/crm/types";
import { followUpSortOptions, sortRecords } from "@/lib/crm/record-sort";
import { matchesSelection, readSingleSelection } from "@/lib/crm/record-filter";
import { RecordFilters, FilterSelect, SearchFilter, SortControls, SortableTableHead, useRecordSort, sortFilter } from "./record-controls";
import { followUpDue, followUpApproved, followUpBlocker, matchesFollowUp } from "@/lib/crm/followup-email";
import { useCRM } from "./provider";
import { FollowUpDetails } from "./followup-details";
import { InquiryPreview } from "./inquiry-preview";
import {
  PageHeading,
  Panel,
  StatusBadge,
  PersonAvatar,
  EmptyState,
  Pager,
  useFormat,
} from "./shared";

const followUpStates = ["Pending", "Reserved", "Sent", "Skipped", "Needs Review"];
const followUpFilters = ["due", "review", "attention", ...followUpStates];
const filterDescriptions: Record<string, string> = {
  all: "All records, including inquiries without a scheduled follow-up.",
  due: "Pending schedules whose time has arrived. Permission and email approval are still required to send.",
  review: "Scheduled follow-ups that still need approval of their saved email.",
  attention: "Emails being processed or awaiting a delivery check: Reserved and Needs Review.",
  Pending: "Scheduled follow-ups waiting for their time or sending requirements. Some may still need approval.",
  Reserved: "Emails being prepared or sent. Wait for the delivery result before taking another action.",
  Sent: "Follow-ups with a confirmed delivery result.",
  Skipped: "Follow-ups not currently pending, including cancelled and unscheduled inquiries.",
  "Needs Review": "Uncertain delivery results. Check the sending account before scheduling again.",
};

export function FollowUpsPage() {
  const { data, run, busy } = useCRM(),
    format = useFormat(),
    params = useSearchParams(),
    router = useRouter();
  const state = readSingleSelection(params.getAll("state"), followUpFilters);
  const requestedLead = params.get("lead");
  const [query, setQuery] = useState(""),
    [priority, setPriority] = useState("all"),
    [status, setStatus] = useState("all"),
    [consent, setConsent] = useState("all"),
    [page, setPage] = useState(1),
    [now, setNow] = useState(Date.now),
    [viewId, setViewId] = useState<string | null>(requestedLead);
  const { sort, changeSort, resetSort } = useRecordSort("due", "asc", () => setPage(1));
  function clearFilters() {
    setQuery(""); setPriority("all"); setStatus("all"); setConsent("all"); resetSort(); changeState("all");
  }
  useEffect(() => {
    setPage(1);
  }, [state]);
  useEffect(() => {
    setViewId(requestedLead);
  }, [requestedLead]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  function changeState(value: string) {
    const selected = readSingleSelection([value], followUpFilters);
    const next = new URLSearchParams(params.toString());
    next.delete("state");
    if (selected !== "all") next.set("state", selected);
    const search = next.toString();
    // These controls only change the client-side table. Keep the URL in sync
    // without waiting for another server render between selections.
    if (search !== params.toString()) window.history.replaceState(null, "", `/follow-ups${search ? `?${search}` : ""}`);
    setPage(1);
  }
  function closeDetails() {
    setViewId(null);
    if (params.has("lead")) {
      const next = new URLSearchParams(params.toString());
      next.delete("lead");
      const search = next.toString();
      router.replace(`/follow-ups${search ? `?${search}` : ""}`, { scroll: false });
    }
  }
  const searched = data.leads.filter(l => `${l.name} ${l.email} ${l.service} ${l.message} ${l.summary}`.toLowerCase().includes(query.trim().toLowerCase()));
  const filtered = sortRecords(searched.filter(l => matchesFollowUp(l, state, now) &&
    matchesSelection(priority, l.priority) && matchesSelection(status, l.status) &&
    matchesSelection(consent, l.consent ? "yes" : "no")), sort, followUpSortOptions);
  const dueCount = searched.filter(l => followUpDue(l, now)).length;
  const nextScheduled = sortRecords(searched.filter(l => l.followUpState === "Pending" && Date.parse(l.followUpDue) > now), { key: "due", direction: "asc" }, followUpSortOptions)[0];
  const activePage = Math.min(page, Math.max(1, Math.ceil(filtered.length / 10)));
  const cards = [
    { title: "All records", detail: "All inquiries, including unscheduled ones", count: searched.length, icon: Users, filter: "all" },
    {
      title: "Due for follow-up",
      detail: "Pending schedules whose time has arrived",
      count: dueCount,
      icon: Clock3,
      filter: "due",
    },
    {
      title: "Pending",
      detail: "Scheduled and waiting to send",
      count: searched.filter((l) => matchesFollowUp(l, "Pending", now)).length,
      icon: ShieldCheck,
      filter: "Pending",
    },
    { title: "Awaiting approval", detail: "Save and approve the follow-up email", count: searched.filter(l => matchesFollowUp(l, "review", now)).length, icon: FileText, filter: "review" },
    {
      title: "Sent",
      detail: "Sending confirmed by the email service",
      count: searched.filter((l) => matchesFollowUp(l, "Sent", now)).length,
      icon: CheckCircle2,
      filter: "Sent",
    },
    {
      title: "Needs attention",
      detail: "Being processed or awaiting a delivery check",
      count: searched.filter((l) => matchesFollowUp(l, "attention", now))
        .length,
      icon: AlertCircle,
      filter: "attention",
    },
  ];
  return (
    <div className="space-y-6">
      <PageHeading
        title="Follow-ups"
        description="The right reminder, with the customer's permission."
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {cards.map((c, index) => (
          <button
            key={c.title}
            aria-label={`${c.title} ${c.count}`}
            aria-describedby={`followup-stat-${c.filter}`}
            data-tone={["violet", "blue", "violet", "amber", "emerald", "amber"][index]}
            aria-pressed={state === c.filter}
            onClick={() => changeState(c.filter)}
            className="crm-stat-card crm-interactive rounded-xl border bg-card p-5 text-left aria-pressed:ring-2 aria-pressed:ring-primary/40"
          >
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <c.icon className="crm-tone-icon size-4" />
              {c.title}
            </p>
            <p className="crm-stat-value mt-3 text-2xl font-semibold">{c.count}</p>
            <p id={`followup-stat-${c.filter}`} className="mt-2 text-[11px] leading-5 text-muted-foreground">{c.detail}</p>
          </button>
        ))}
      </div>
      {dueCount === 0 && (
        <p data-testid="next-followup" className="flex items-start gap-2 text-xs leading-6 text-muted-foreground">
          <Clock3 className="mt-1 size-3.5 shrink-0" />
          <span>{nextScheduled ? <>
            Nothing due yet. Next scheduled follow-up: <time dateTime={nextScheduled.followUpDue} className="font-medium text-foreground">{format(nextScheduled.followUpDue, true)}</time> ({data.settings.timezone}).
          </> : query.trim() ? "No scheduled follow-ups match your search." : "Nothing due now. No upcoming follow-up is scheduled."}</span>
        </p>
      )}
      <div className="flex items-start gap-3 rounded-lg border bg-card px-4 py-3">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#6e3ff3]" />
        <p className="text-xs leading-6 text-muted-foreground">
          Preview, edit, schedule and approve emails here. Sending requires customer permission,
          an open inquiry and approval of the saved email. Due counts pending schedules whose time
          has arrived; unscheduled and sent records are counted separately.{" "}
          <Link
            href="/settings"
            className="font-medium text-foreground underline underline-offset-2"
          >
            Follow-up preferences
          </Link>
        </p>
      </div>
      <Panel>
        <RecordFilters  onClear={clearFilters}
          search={<SearchFilter
              aria-label="Search follow-ups"
              placeholder="Search customer or service…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
          />}
          hasSearch={!!query.trim()}
          filters={[
            { label: "Follow-up state", value: state, onRemove: () => changeState("all"), displayValue: ({ due: "Due now", review: "Awaiting approval", attention: "Needs attention" } as Record<string, string>)[state] || state },
            { label: "Priority", value: priority, onRemove: () => { setPriority("all"); setPage(1); } },
            { label: "Lead status", value: status, onRemove: () => { setStatus("all"); setPage(1); } },
            { label: "Consent", value: consent, onRemove: () => { setConsent("all"); setPage(1); }, displayValue: consent === "yes" ? "Permission recorded" : "No permission" },
            sortFilter(sort, followUpSortOptions, "due:asc", resetSort),
          ]}
        >
          <FilterSelect label="Follow-up state"
            aria-label="Follow-up state"
            value={state}
            onValueChange={changeState}
          >
            <option value="all">All follow-ups</option>
            <option value="due">Due now</option>
            <option value="review">Awaiting approval</option>
            <option value="attention">Needs attention</option>
            {followUpStates.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </FilterSelect>
          <FilterSelect label="Priority" aria-label="Follow-up priority" value={priority} onValueChange={value => { setPriority(value); setPage(1); }}>
            <option value="all">All priorities</option>{priorities.map(value => <option key={value}>{value}</option>)}
          </FilterSelect>
          <FilterSelect label="Lead status" aria-label="Follow-up lead status" value={status} onValueChange={value => { setStatus(value); setPage(1); }}>
            <option value="all">All statuses</option>{leadStatuses.map(value => <option key={value}>{value}</option>)}
          </FilterSelect>
          <FilterSelect label="Consent" aria-label="Follow-up consent" value={consent} onValueChange={value => { setConsent(value); setPage(1); }}>
            <option value="all">All permissions</option><option value="yes">Permission recorded</option><option value="no">No permission</option>
          </FilterSelect>
          
          <SortControls sort={sort} options={followUpSortOptions} onChange={changeSort} />
        </RecordFilters>
        <div className="space-y-1 border-b px-4 py-2 text-xs text-muted-foreground"><p role="status">{filtered.length} matching {filtered.length === 1 ? "record" : "records"} · {filtered.filter(l => !l.followUpDue && l.followUpState === "Skipped").length} not scheduled{query.trim() ? " · Counts match your search" : ""}</p><p>{filterDescriptions[state]}</p></div>
        {filtered.length ? (
          <Table className="min-w-[980px]">
            <TableHeader>
              <TableRow className="bg-muted/25">
                <SortableTableHead label="Customer" sortKey="name" sort={sort} onSort={changeSort} className="pl-5" />
                <SortableTableHead label="Inquiry" sortKey="service" sort={sort} onSort={changeSort} />
                <SortableTableHead label="Priority" sortKey="priority" sort={sort} onSort={changeSort} defaultDirection="desc" />
                <SortableTableHead label="Due time" sortKey="due" sort={sort} onSort={changeSort} />
                <SortableTableHead label="Follow-up state" sortKey="state" sort={sort} onSort={changeSort} />
                <TableHead scope="col">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice((activePage - 1) * 10, activePage * 10).map((l) => (
                <TableRow key={l.id} data-record-id={l.id}>
                  <TableCell className="max-w-52 whitespace-normal py-4 pl-5 align-top">
                    <button
                      type="button"
                      onClick={() => setViewId(l.id)}
                      className="flex items-start gap-2.5 rounded-md py-1 text-left hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <PersonAvatar name={l.name} email={l.email} photoUrl={l.photoUrl} />
                      <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                        <span className="block text-sm font-medium">{l.name}</span>
                        <span className="mt-1 block text-[11px] leading-5 text-muted-foreground">
                          {l.email}
                          {l.isSample ? " · Sample" : ""}
                        </span>
                      </span>
                    </button>
                  </TableCell>
                  <TableCell className="w-[30%] min-w-52 max-w-sm whitespace-normal py-4 align-top"><InquiryPreview lead={l} compact /></TableCell>
                  <TableCell><StatusBadge value={l.priority} /></TableCell>
                  <TableCell>
                    <span className="whitespace-nowrap text-xs text-muted-foreground">
                      {l.followUpDue ? format(l.followUpDue, true) : "Not scheduled"}
                    </span>
                    {followUpDue(l, now) && (
                      <span className="mt-1 block text-[10px] text-amber-600 dark:text-amber-400">
                        Due now
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="min-w-48 max-w-64 whitespace-normal break-words">
                    <StatusBadge value={l.followUpState} />
                    {l.followUpState === "Pending" && <p className="mt-1 text-[10px] text-muted-foreground">{followUpApproved(l) ? "Email approved" : "Approval required"}</p>}
                    {l.followUpState !== "Sent" && <p className="mt-1 max-w-48 text-[10px] leading-4 text-muted-foreground">{followUpBlocker(l, data.settings)}</p>}
                    {l.followUpState === "Reserved" && (
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        Check whether this email was sent
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {canScheduleFollowUp(l) && (
                        <Button variant="ghost" size="sm" onClick={() => setViewId(l.id)}>
                          <ActionIcon action="reschedule" />
                          Reschedule
                        </Button>
                      )}
                      {l.followUpState === "Pending" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void run("followup.cancel", { id: l.id }, "Local follow-up cancelled.")
                          }
                        >
                          <ActionIcon action="cancel" />
                          Cancel
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`View ${l.name}'s follow-up`}
                        onClick={() => setViewId(l.id)}
                      >
                        <ActionIcon action="view" />
                        View
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            title={
              state === "attention" && !query
                ? "No follow-ups need attention"
                : "No matching follow-ups"
            }
            description={
              state === "attention" && !query
                ? "No follow-ups are being processed or awaiting a delivery check. Follow-ups awaiting email approval have their own filter."
                : "Try another filter or search to see your follow-ups."
            }
            action={
              (state !== "all" || query || priority !== "all" || status !== "all" || consent !== "all") && (
                <Button
                  variant="outline"
                  onClick={clearFilters}
                >
                  <ActionIcon action="clearFilters" />
                  Show all follow-ups
                </Button>
              )
            }
          />
        )}
        <Pager page={activePage} count={filtered.length} size={10} onChange={setPage} />
      </Panel>
      <FollowUpDetails
        leadId={viewId}
        onClose={closeDetails}
      />
    </div>
  );
}
