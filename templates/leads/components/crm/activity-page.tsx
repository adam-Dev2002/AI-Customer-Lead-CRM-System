"use client";
import { ActionIcon } from "./action-icon";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useCRM } from "./provider";
import { activityStatusLabels } from "@/lib/crm/customer-copy";
import { activityAppearance } from "@/lib/crm/activity-appearance";
import { ActivityMark, activityColors, activityIcons } from "./activity-mark";
import { escapeCell } from "@/lib/crm/csv";
import { dateSortValue, dateSortLabels, sortRecords, type SortOption } from "@/lib/crm/record-sort";
import type { Activity } from "@/lib/crm/types";
import { matchesSelection } from "@/lib/crm/record-filter";
import { RecordFilters, FilterSelect, SearchFilter, SortControls, useRecordSort, sortFilter } from "./record-controls";
import {
  PageHeading,
  Panel,
  EmptyState,
  Pager,
  useFormat,
  download,
  StatusBadge,
} from "./shared";
const activitySortOptions: readonly SortOption<Activity>[] = [
  { key: "createdAt", label: "Time", value: a => dateSortValue(a.createdAt), ...dateSortLabels },
  { key: "title", label: "Activity", value: a => a.title },
];
export function ActivityPage() {
  const { data } = useCRM(),
    format = useFormat();
  const [query, setQuery] = useState(""),
    [type, setType] = useState("all"),
    [status, setStatus] = useState("all"),
    [page, setPage] = useState(1);
  const { sort, changeSort, resetSort } = useRecordSort("createdAt", "desc", () => setPage(1));
  const rows = sortRecords(data.activities.map(a => ({ ...a, ...activityAppearance(a) })).filter(
    (a) =>
      matchesSelection(type, a.type) &&
      matchesSelection(status, a.status || "none") &&
      `${a.title} ${a.detail}`.toLowerCase().includes(query.trim().toLowerCase()),
  ), sort, activitySortOptions);
  const activePage = Math.min(page, Math.max(1, Math.ceil(rows.length / 15)));
  return (
    <div className="space-y-6">
      <PageHeading
        title="Workspace activity"
        description="A clear record of inquiries, decisions, and follow-up outcomes."
      >
        <Button
          variant="outline"
          onClick={() =>
            download(
              "workspace-activity.csv",
              "\uFEFF" + [["Time", "Activity", "Description"], ...rows.map(a => [format(a.createdAt, true), a.title, a.detail])].map(row => row.map(escapeCell).join(",")).join("\r\n"),
              "text/csv;charset=utf-8",
            )
          }
        >
          <ActionIcon action="download" />
          Export activity
        </Button>
      </PageHeading>
      <Panel>
        <RecordFilters onClear={() => { setType("all"); setStatus("all"); setQuery(""); resetSort(); setPage(1); }}
          search={<SearchFilter
              placeholder="Search activity…"
              aria-label="Search activity"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
          />}
          hasSearch={!!query.trim()}
          filters={[
            { label: "Activity type", value: type, onRemove: () => { setType("all"); setPage(1); }, displayValue: type === "automation" ? "Automatic updates" : type === "followup" ? "Follow-ups" : type[0].toUpperCase() + type.slice(1) },
            { label: "Result", value: status, onRemove: () => { setStatus("all"); setPage(1); }, displayValue: status === "none" ? "No result recorded" : activityStatusLabels[status as keyof typeof activityStatusLabels] },
            sortFilter(sort, activitySortOptions, "createdAt:desc", resetSort),
          ]}
        >
          <FilterSelect label="Activity type"
            aria-label="Activity type"
            value={type}
            onValueChange={(value) => {
              setType(value);
              setPage(1);
            }}
          >
            <option value="all">All activity</option>
            {Object.keys(activityIcons).map((k) => (
              <option value={k} key={k}>
                {k === "followup"
                  ? "Follow-ups"
                  : k === "automation" ? "Automatic updates" : k[0].toUpperCase() + k.slice(1)}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Result" aria-label="Activity result" value={status} onValueChange={value => { setStatus(value); setPage(1); }}>
            <option value="all">All results</option>{Object.entries(activityStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}<option value="none">No result recorded</option>
          </FilterSelect>
          
          <SortControls sort={sort} options={activitySortOptions} onChange={changeSort} />
        </RecordFilters>
        {rows.length ? (
          <div className="px-5">
            {rows.slice((activePage - 1) * 15, activePage * 15).map((a) => {
              return (
                <div
                  key={a.id}
                  data-record-id={a.id}
                  data-activity-tone={a.tone}
                  className="flex items-start gap-3 border-b py-5 last:border-0"
                >
                  <ActivityMark type={a.type} tone={a.tone} />
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium ${activityColors[a.tone].text}`}>{a.title}</p>
                    {a.detail && (
                      <p className="mt-1.5 break-words text-xs leading-6 text-muted-foreground">
                        {a.detail}
                      </p>
                    )}
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      {format(a.createdAt, true)}
                    </p>
                  </div>
                  {a.status && <StatusBadge value={activityStatusLabels[a.status]} />}
                  {a.leadId && data.leads.some((l) => l.id === a.leadId) && (
                    <Button asChild variant="ghost" size="icon-sm">
                      <Link
                        href={`/leads/${a.leadId}`}
                        aria-label="View related lead"
                      >
                        <ActionIcon action="view" />
                      </Link>
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title="No matching activity"
            description="New actions in your workspace will appear here."
          />
        )}
        <Pager
          page={activePage}
          count={rows.length}
          size={15}
          onChange={setPage}
        />
      </Panel>
    </div>
  );
}
