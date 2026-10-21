"use client";
import { ActionIcon } from "./action-icon";
import { leadSortOptions, sortRecords, type RecordSort } from "@/lib/crm/record-sort";
import { matchesSelection, readSingleSelection } from "@/lib/crm/record-filter";
import { RecordFilters, FilterSelect, SearchFilter, SortControls, SortableTableHead, useRecordSort, sortFilter } from "./record-controls";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import type { Lead } from "@/lib/crm/types";
import { leadStatuses, priorities } from "@/lib/crm/types";
import { exportCSV, parseCSV } from "@/lib/crm/csv";
import { useCRM } from "./provider";
import { LeadForm } from "./forms";
import { ReportExport } from "./report-export";
import { InquiryPreview } from "./inquiry-preview";
import {
  PageHeading,
  Panel,
  StatusBadge,
  PersonAvatar,
  EmptyState,
  Pager,
  NativeSelect,
  Modal,
  Confirm,
  useFormat,
  matchesPeriod,
  download,
} from "./shared";

export function ImportExport({ leads }: { leads: Lead[] }) {
  const { run, busy, notify } = useCRM();
  const [open, setOpen] = useState(false),
    [rows, setRows] = useState<Record<string, unknown>[]>([]),
    [filename, setFilename] = useState("");
  const file = useRef<HTMLInputElement>(null);
  function exportLeads() {
    download(
      "customer-leads.csv",
      exportCSV(
        leads.map((l) => ({ ...l, consent: l.consent ? "Yes" : "No" })),
      ),
      "text/csv;charset=utf-8",
    );
    notify(`Exported ${leads.length} leads.`);
  }
  return (
    <>
      <ReportExport leads={leads} />
      <input
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        ref={file}
        aria-label="Choose leads CSV"
        onChange={async (e) => {
          const chosen = e.target.files?.[0];
          if (!chosen) return;
          try {
            if (chosen.size > 2_000_000)
              throw new Error("Choose a CSV smaller than 2 MB.");
            const parsed = parseCSV(await chosen.text());
            setRows(parsed);
            setFilename(chosen.name);
            setOpen(true);
          } catch (error) {
            notify((error as Error).message, true);
          } finally {
            e.target.value = "";
          }
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            <ActionIcon action="importExport" />
            <span>Import / Export</span>
            <ActionIcon action="expand" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => file.current?.click()}>
            <ActionIcon action="import" />
            Import CSV
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={exportLeads}>
            <ActionIcon action="download" />
            Export {leads.length} leads to CSV
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Import leads"
        description={`${filename} · ${rows.length} inquiries ready to validate.`}
      >
        <p className="mb-4 text-sm text-muted-foreground">
          Imported leads are added to your local workspace. Consent is enabled
          only for a Yes/True value in the Consent column.
        </p>
        <div className="mb-5 max-h-48 overflow-auto rounded-lg border">
          {rows.slice(0, 10).map((r, i) => (
            <div key={i} className="border-b px-3 py-2 text-sm last:border-0">
              <span className="font-medium">
                {String(r.name || "Missing name")}
              </span>
              <span className="ml-2 text-xs text-muted-foreground">
                {String(r.email || "Missing email")}
              </span>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            <ActionIcon action="cancel" />
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              if (
                await run(
                  "leads.import",
                  { rows },
                  `Imported ${rows.length} leads.`,
                )
              )
                setOpen(false);
            }}
          >
            <ActionIcon action="import" />
            Import {rows.length} leads
          </Button>
        </div>
      </Modal>
    </>
  );
}
export function LeadTable({
  leads,
  compact = false,
  selected,
  onSelect,
  sort,
  onSort,
}: {
  leads: Lead[];
  compact?: boolean;
  selected?: Set<string>;
  onSelect?: (id: string, checked: boolean) => void;
  sort: RecordSort;
  onSort: (sort: RecordSort) => void;
}) {
  const { run } = useCRM(),
    format = useFormat(),
    router = useRouter();
  const [edit, setEdit] = useState<Lead | null>(null),
    [remove, setRemove] = useState<Lead | null>(null);
  if (!leads.length)
    return (
      <EmptyState
        title="No leads found"
        description="Try another filter or create your first inquiry."
      />
    );
  return (
    <>
      <Table className="min-w-[760px] table-fixed">
        <TableHeader>
          <TableRow className="bg-muted/25">
            {!compact && (
              <TableHead className="w-10">
                {onSelect && (
                  <input
                    type="checkbox"
                    aria-label="Select all leads on this page"
                    checked={
                      leads.length > 0 &&
                      leads.every((l) => selected?.has(l.id))
                    }
                    onChange={(e) =>
                      leads.forEach((l) => onSelect(l.id, e.target.checked))
                    }
                    className="accent-[#6e3ff3]"
                  />
                )}
              </TableHead>
            )}
            <SortableTableHead className="w-[24%] pl-5" label="Lead name" sortKey="name" sort={sort} onSort={onSort} />
            <SortableTableHead label="Inquiry" sortKey="service" sort={sort} onSort={onSort} />
            <SortableTableHead className="w-28" label="Status" sortKey="status" sort={sort} onSort={onSort} />
            <SortableTableHead className="w-24" label="Priority" sortKey="priority" sort={sort} onSort={onSort} defaultDirection="desc" />
            <SortableTableHead className="w-28" label="Date" sortKey="createdAt" sort={sort} onSort={onSort} defaultDirection="desc" />
            <TableHead scope="col" className="w-20">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {leads.map((l) => (
            <TableRow key={l.id} data-record-id={l.id}>
              {!compact && (
                <TableCell>
                  {onSelect && (
                    <input
                      type="checkbox"
                      aria-label={`Select ${l.name}`}
                      checked={selected?.has(l.id) || false}
                      onChange={(e) => onSelect(l.id, e.target.checked)}
                      className="accent-[#6e3ff3]"
                    />
                  )}
                </TableCell>
              )}
              <TableCell className="whitespace-normal py-4 pl-5 align-top">
                <Link
                  href={`/leads/${l.id}`}
                  className="flex min-w-0 items-start gap-2.5 py-1 hover:text-[#6e3ff3]"
                >
                  <PersonAvatar name={l.name} email={l.email} photoUrl={l.photoUrl} />
                  <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                    <span className="block text-sm font-medium">{l.name}</span>
                    <span className="mt-1 block text-[11px] leading-5 text-muted-foreground">{l.email}</span>
                    {l.isSample && <span className="text-[10px] text-muted-foreground">Sample</span>}
                  </span>
                </Link>
              </TableCell>
              <TableCell className="whitespace-normal py-4 align-top">
                <InquiryPreview lead={l} compact={compact} href={`/leads/${l.id}`} />
              </TableCell>
              <TableCell>
                <StatusBadge value={l.status} />
              </TableCell>
              <TableCell>
                <StatusBadge value={l.priority} />
              </TableCell>
              <TableCell className="whitespace-normal text-xs leading-5 text-muted-foreground">{format(l.createdAt)}</TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Actions for ${l.name}`}
                    >
                      <ActionIcon action="more" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => router.push(`/leads/${l.id}`)}
                    >
                      <ActionIcon action="view" />
                      View details
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setEdit(l)}>
                      <ActionIcon action="edit" />
                      Edit lead
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => setRemove(l)}
                    >
                      <ActionIcon action="delete" />
                      Delete lead
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {edit && (
        <LeadForm
          open
          onOpenChange={(v) => {
            if (!v) setEdit(null);
          }}
          lead={edit}
        />
      )}
      <Confirm
        open={!!remove}
        onOpenChange={(v) => {
          if (!v) setRemove(null);
        }}
        title="Delete this lead?"
        description={`This removes ${remove?.name}'s inquiry and its associated local drafts and tasks.`}
        destructive
        label="Delete lead"
        onConfirm={() =>
          run("lead.delete", { id: remove?.id }, "Lead deleted.")
        }
      />
    </>
  );
}
export function LeadsPage() {
  const { data } = useCRM(),
    params = useSearchParams(),
    router = useRouter();
  const requestedQuery = params.get("q") || "";
  const requestedStatus = useMemo(() => readSingleSelection(params.getAll("status"), leadStatuses), [params]);
  const requestedPriority = useMemo(() => readSingleSelection(params.getAll("priority"), priorities), [params]);
  const [query, setQuery] = useState(requestedQuery),
    [status, setStatus] = useState(requestedStatus),
    [priority, setPriority] = useState(requestedPriority);
  const [source, setSource] = useState("all"),
    [owner, setOwner] = useState("all"),
    [period, setPeriod] = useState("all"),
    [page, setPage] = useState(1),
    [size, setSize] = useState(10),
    [create, setCreate] = useState(false),
    [selected, setSelected] = useState<Set<string>>(new Set());
  const { sort, changeSort, resetSort } = useRecordSort("createdAt", "desc", () => setPage(1));
  function clearFilters() {
    setQuery(""); setStatus("all"); setPriority("all"); setSource("all"); setOwner("all"); setPeriod("all"); resetSort(); setPage(1);
    if (params.toString()) router.replace("/leads");
  }
  function removeLinkedFilter(key: "status" | "priority") {
    const next = new URLSearchParams(params.toString());
    if (query) next.set("q", query);
    else next.delete("q");
    for (const [name, value] of Object.entries({ status, priority })) {
      next.delete(name);
      if (name !== key && value !== "all") next.set(name, value);
    }
    if (key === "status") setStatus("all");
    else setPriority("all");
    setPage(1);
    const search = next.toString();
    if (search !== params.toString()) router.replace(`/leads${search ? `?${search}` : ""}`, { scroll: false });
  }
  useEffect(() => {
    setQuery(requestedQuery);
    setStatus(requestedStatus);
    setPriority(requestedPriority);
    setPage(1);
  }, [requestedQuery, requestedStatus, requestedPriority]);
  const filtered = sortRecords(data.leads.filter(
    (l) =>
      `${l.name} ${l.email} ${l.phone} ${l.service} ${l.message} ${l.summary} ${l.id}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()) &&
      matchesSelection(status, l.status) &&
      matchesSelection(priority, l.priority) &&
      matchesSelection(source, l.source) &&
      matchesSelection(owner, l.owner) &&
      matchesPeriod(l.createdAt, period, data.settings.timezone),
  ), sort, leadSortOptions);
  const currentPage = Math.min(
      page,
      Math.max(1, Math.ceil(filtered.length / size)),
    ),
    visible = filtered.slice((currentPage - 1) * size, currentPage * size);
  function filter<Value>(setter: (v: Value) => void, value: Value) {
    setter(value);
    setPage(1);
  }
  return (
    <div className="space-y-6">
      <PageHeading
        title="Your leads"
        description="Read customer inquiries, review their status and decide what to do next."
      >
        <ImportExport leads={filtered} />
        <Button onClick={() => setCreate(true)}>
          <ActionIcon action="create" />
          Create new
        </Button>
      </PageHeading>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { title: "All leads", value: data.leads.length },
          {
            title: "New inquiries",
            value: data.leads.filter((l) => l.status === "New").length,
          },
          {
            title: "High or urgent (open)",
            value: data.leads.filter(
              (l) =>
                ["High", "Urgent"].includes(l.priority) &&
                !["Closed", "Won", "Lost"].includes(l.status),
            ).length,
          },
          {
            title: "Qualified leads",
            value: data.leads.filter((l) => l.status === "Qualified").length,
          },
        ].map((s) => (
          <Panel key={s.title} className="p-4">
            <p className="text-xs text-muted-foreground">{s.title}</p>
            <p className="mt-2 text-2xl font-semibold">{s.value}</p>
          </Panel>
        ))}
      </div>
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <ClipboardList className="size-4 text-muted-foreground" />
            Leads list{" "}
            <span className="rounded bg-muted px-1.5 text-xs font-normal text-muted-foreground">
              {filtered.length}
            </span>
          </h2>
        </div>
        <RecordFilters  onClear={clearFilters}
          search={<SearchFilter value={query} onChange={e => filter(setQuery, e.target.value)} placeholder="Search customers or inquiries…" aria-label="Filter leads" />}
          hasSearch={!!query.trim()}
          filters={[
            { label: "Status", value: status, onRemove: () => removeLinkedFilter("status") },
            { label: "Priority", value: priority, onRemove: () => removeLinkedFilter("priority") },
            { label: "Source", value: source, onRemove: () => filter(setSource, "all") },
            { label: "Owner", value: owner, onRemove: () => filter(setOwner, "all") },
            { label: "Date", value: period, onRemove: () => filter(setPeriod, "all"), displayValue: ({ today: "Today", week: "Last 7 days", "30days": "Last 30 days", month: "This month" } as Record<string, string>)[period] },
            sortFilter(sort, leadSortOptions, "createdAt:desc", resetSort),
          ]}
        >
          <FilterSelect label="Status"
            aria-label="Filter status"
            value={status}
            onValueChange={(value) => filter(setStatus, value)}
          >
            <option value="all">All statuses</option>
            {leadStatuses.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </FilterSelect>
          <FilterSelect label="Priority"
            aria-label="Filter priority"
            value={priority}
            onValueChange={(value) => filter(setPriority, value)}
          >
            <option value="all">All priorities</option>
            {priorities.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </FilterSelect>
          <FilterSelect label="Source"
            aria-label="Filter source"
            value={source}
            onValueChange={(value) => filter(setSource, value)}
          >
            <option value="all">All sources</option>
            {Array.from(new Set(data.leads.map((l) => l.source))).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </FilterSelect>
          <FilterSelect label="Owner"
            aria-label="Filter owner"
            value={owner}
            onValueChange={(value) => filter(setOwner, value)}
          >
            <option value="all">All owners</option>
            {Array.from(new Set(data.leads.map((l) => l.owner))).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </FilterSelect>
          <FilterSelect label="Date"
            aria-label="Filter date"
            value={period}
            onValueChange={(value) => filter(setPeriod, value)}
          >
            <option value="all">All time</option>
            <option value="today">Today</option>
            <option value="week">Last 7 days</option>
            <option value="30days">Last 30 days</option>
            <option value="month">This month</option>
          </FilterSelect>
          
          <SortControls sort={sort} options={leadSortOptions} onChange={changeSort} />
        </RecordFilters>
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-b bg-violet-50 px-5 py-2 text-xs dark:bg-violet-950/30">
            <span>
              {data.leads.filter((l) => selected.has(l.id)).length} selected
            </span>
            <ReportExport leads={data.leads.filter(lead => selected.has(lead.id))} label="Selected leads">Report selected</ReportExport>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                download(
                  "selected-leads.csv",
                  exportCSV(
                    data.leads
                      .filter((l) => selected.has(l.id))
                      .map((l) => ({
                        ...l,
                        consent: l.consent ? "Yes" : "No",
                      })),
                  ),
                  "text/csv;charset=utf-8",
                )
              }
            >
              <ActionIcon action="download" />
              Export selected CSV
            </Button>
            <button
              className="ml-auto inline-flex items-center gap-1.5 underline"
              onClick={() => setSelected(new Set())}
            >
              <ActionIcon action="cancel" />
              Clear selection
            </button>
          </div>
        )}
        <LeadTable
          sort={sort}
          onSort={changeSort}
          leads={visible}
          selected={selected}
          onSelect={(id, checked) =>
            setSelected((prev) => {
              const next = new Set(prev);
              if (checked) next.add(id);
              else next.delete(id);
              return next;
            })
          }
        />
        <div className="flex flex-wrap items-center justify-between border-t">
          <div className="flex items-center gap-2 px-5 py-3 text-xs text-muted-foreground">
            <NativeSelect
              aria-label="Leads per page"
              value={size}
              onChange={(e) => {
                setSize(Number(e.target.value));
                setPage(1);
              }}
            >
              {[5, 10, 20, 50].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </NativeSelect>
            per page
          </div>
          <div className="min-w-64 flex-1 [&>div]:border-0">
            <Pager
              page={currentPage}
              count={filtered.length}
              size={size}
              onChange={setPage}
            />
          </div>
        </div>
      </Panel>
      <LeadForm open={create} onOpenChange={setCreate} />
    </div>
  );
}
