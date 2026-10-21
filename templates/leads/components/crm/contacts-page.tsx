"use client";
import { ActionIcon } from "./action-icon";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { escapeCell } from "@/lib/crm/csv";
import { dateSortValue, dateSortLabels, sortRecords, type SortOption } from "@/lib/crm/record-sort";
import type { Lead } from "@/lib/crm/types";
import { matchesSelection } from "@/lib/crm/record-filter";
import { RecordFilters, FilterSelect, SearchFilter, SortControls, SortableTableHead, useRecordSort, sortFilter } from "./record-controls";
import { useCRM } from "./provider";
import { InquiryPreview } from "./inquiry-preview";
import {
  PageHeading,
  Panel,
  PersonAvatar,
  EmptyState,
  Pager,
  useFormat,
  download,
} from "./shared";
const contactSortOptions: readonly SortOption<Lead & { count: number; open: number }>[] = [
  { key: "name", label: "Customer", value: c => c.name },
  { key: "email", label: "Email", value: c => c.email },
  { key: "phone", label: "Phone", value: c => c.phone },
  { key: "count", label: "Inquiries", value: c => c.count, ascLabel: "Fewest first", descLabel: "Most first", defaultDirection: "desc" },
  { key: "open", label: "Open inquiries", value: c => c.open, ascLabel: "Fewest first", descLabel: "Most first", defaultDirection: "desc" },
  { key: "service", label: "Last inquiry", value: c => c.service },
  { key: "createdAt", label: "Date", value: c => dateSortValue(c.createdAt), ...dateSortLabels },
];
export function ContactsPage() {
  const { data, notify } = useCRM(),
    format = useFormat();
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [page, setPage] = useState(1);
  const { sort, changeSort, resetSort } = useRecordSort("name", "asc", () => setPage(1));
  const grouped = new Map<string, typeof data.leads>();
  data.leads.forEach((l) =>
    grouped.set(l.email.trim().toLowerCase(), [...(grouped.get(l.email.trim().toLowerCase()) || []), l]),
  );
  const contacts = sortRecords(Array.from(grouped.entries())
    .map(([email, leads]) => {
      const latest = [...leads].sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
      )[0];
      return {
        ...latest,
        email,
        count: leads.length,
        open: leads.filter((l) => !["Won", "Lost", "Closed"].includes(l.status))
          .length,
      };
    })
    .filter((c) =>
      `${c.name} ${c.email} ${c.phone}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()) && matchesSelection(status, c.open > 0 ? "open" : "closed"),
    ), sort, contactSortOptions);
  const activePage = Math.min(
    page,
    Math.max(1, Math.ceil(contacts.length / 10)),
  );
  return (
    <div className="space-y-6">
      <PageHeading
        title="Your contacts"
        description="Customer details gathered from every inquiry, grouped by email."
      >
        <Button
          variant="outline"
          onClick={() => {
            download(
              "customer-contacts.csv",
              "\uFEFF" +
                [
                  ["Name", "Email", "Phone", "Inquiries", "Open inquiries"]
                    .map(escapeCell)
                    .join(","),
                  ...contacts.map((c) =>
                    [c.name, c.email, c.phone, c.count, c.open]
                      .map(escapeCell)
                      .join(","),
                  ),
                ].join("\r\n"),
              "text/csv;charset=utf-8",
            );
            notify(`Exported ${contacts.length} contacts.`);
          }}
        >
          <ActionIcon action="download" />
          Export contacts
        </Button>
      </PageHeading>
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <h2 className="text-sm font-semibold">
            Customer directory{" "}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {contacts.length} contacts
            </span>
          </h2>
        </div>
        <RecordFilters  onClear={() => { setQuery(""); setStatus("all"); resetSort(); setPage(1); }}
          search={<SearchFilter
              placeholder="Search contacts…"
              aria-label="Search contacts"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
          />}
          hasSearch={!!query.trim()}
          filters={[
            { label: "Inquiries", value: status, onRemove: () => { setStatus("all"); setPage(1); }, displayValue: status === "open" ? "Has open inquiries" : "No open inquiries" },
            sortFilter(sort, contactSortOptions, "name:asc", resetSort),
          ]}
        >
          <FilterSelect label="Inquiries" aria-label="Contact inquiries" value={status} onValueChange={value => { setStatus(value); setPage(1); }}>
            <option value="all">All contacts</option><option value="open">Has open inquiries</option><option value="closed">No open inquiries</option>
          </FilterSelect>
          
          <SortControls sort={sort} options={contactSortOptions} onChange={changeSort} />
        </RecordFilters>
        {contacts.length ? (
          <Table className="min-w-[760px] table-fixed">
            <TableHeader>
              <TableRow className="bg-muted/25">
                <SortableTableHead label="Customer" sortKey="name" sort={sort} onSort={changeSort} className="w-[26%] pl-5" />
                <SortableTableHead label="Inquiries" sortKey="count" sort={sort} onSort={changeSort} defaultDirection="desc" className="w-24" />
                <SortableTableHead label="Last inquiry" sortKey="service" sort={sort} onSort={changeSort} />
                <SortableTableHead label="Date" sortKey="createdAt" sort={sort} onSort={changeSort} defaultDirection="desc" className="w-28" />
                <TableHead scope="col" className="w-36">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts
                .slice((activePage - 1) * 10, activePage * 10)
                .map((c) => (
                  <TableRow key={c.email} data-record-id={c.email}>
                    <TableCell className="whitespace-normal py-4 pl-5 align-top">
                      <Link
                        href={`/leads?q=${encodeURIComponent(c.email)}`}
                        className="flex min-w-0 items-start gap-2.5 py-1"
                      >
                        <PersonAvatar name={c.name} email={c.email} photoUrl={c.photoUrl} />
                        <span className="min-w-0 break-words [overflow-wrap:anywhere]"><span className="block text-sm font-medium">{c.name}</span><span className="mt-1 block text-[11px] leading-5 text-muted-foreground">{c.email}</span></span>
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-normal"><span className="text-sm font-medium">{c.count}</span><span className="mt-1 block text-[11px] text-muted-foreground">{c.open} open</span></TableCell>
                    <TableCell className="whitespace-normal py-4 align-top"><InquiryPreview lead={c} compact href={`/leads/${c.id}`} /></TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {format(c.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/leads?q=${encodeURIComponent(c.email)}`}>
                          <ActionIcon action="view" />
                          View inquiries
                          
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            title="No contacts found"
            description="Create a lead to add a customer, or try another search."
          />
        )}
        <Pager
          page={activePage}
          count={contacts.length}
          size={10}
          onChange={setPage}
        />
      </Panel>
    </div>
  );
}
