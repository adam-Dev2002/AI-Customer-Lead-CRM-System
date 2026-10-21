"use client";
import { ActionIcon } from "./action-icon";
import { useState } from "react";
import Link from "next/link";
import { Clock3, CheckSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCRM } from "./provider";
import { TaskForm } from "./forms";
import { dateFormatter } from "@/lib/crm/date-format";
import { dateSortValue, dueSortLabels, sortRecords, type SortOption } from "@/lib/crm/record-sort";
import { matchesSelection } from "@/lib/crm/record-filter";
import { RecordFilters, FilterSelect, SearchFilter, SortControls, useRecordSort, sortFilter } from "./record-controls";
import { PageHeading, Panel, EmptyState, PersonAvatar, useFormat } from "./shared";
type CalendarEvent = { id: string; title: string; date: string; kind: string; leadId: string };
const calendarSortOptions: readonly SortOption<CalendarEvent>[] = [
  { key: "date", label: "Scheduled time", value: e => dateSortValue(e.date), ...dueSortLabels },
  { key: "title", label: "Title", value: e => e.title },
];
export function CalendarPage() {
  const { data } = useCRM(),
    format = useFormat();
  const dateKey = (iso: string) =>
    dateFormatter("en-CA", {
      timeZone: data.settings.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  const today = dateKey(new Date().toISOString()),
    [year, month] = today.split("-").map(Number);
  const [cursor, setCursor] = useState({ year, month: month - 1 }),
    [selected, setSelected] = useState(today),
    [create, setCreate] = useState(false);
  const [kind, setKind] = useState("all"), [query, setQuery] = useState("");
  const { sort, changeSort, resetSort } = useRecordSort("date", "asc");
  const first = new Date(Date.UTC(cursor.year, cursor.month, 1)),
    offset = (first.getUTCDay() + 6) % 7,
    days = new Date(Date.UTC(cursor.year, cursor.month + 1, 0)).getUTCDate();
  const events = sortRecords([
    ...data.tasks
      .filter((t) => !t.completed)
      .map((t) => ({
        id: t.id,
        title: t.title,
        date: t.dueAt,
        kind: "task",
        leadId: t.leadId,
      })),
    ...data.leads
      .filter(
        (l) =>
          ["Pending", "Reserved"].includes(l.followUpState) && l.followUpDue,
      )
      .map((l) => ({
        id: `follow-${l.id}`,
        title: `Follow up · ${l.name}`,
        date: l.followUpDue,
        kind: "followup",
        leadId: l.id,
      })),
  ].filter(e => Number.isFinite(Date.parse(e.date)) && matchesSelection(kind, e.kind) &&
    `${e.title} ${data.leads.find(l => l.id === e.leadId)?.name || ""}`.toLowerCase().includes(query.trim().toLowerCase())), sort, calendarSortOptions);
  const daily = events.filter((e) => dateKey(e.date) === selected);
  function shift(delta: number) {
    const d = new Date(Date.UTC(cursor.year, cursor.month + delta, 1));
    setCursor({ year: d.getUTCFullYear(), month: d.getUTCMonth() });
  }
  return (
    <div className="space-y-6">
      <PageHeading
        title="Your calendar"
        description={`Tasks and follow-up schedules · ${data.settings.timezone}`}
      >
        <Button onClick={() => setCreate(true)}>
          <ActionIcon action="create" />
          Add task
        </Button>
      </PageHeading>
      <Panel className="[&>div]:border-b-0">
        <RecordFilters onClear={() => { setKind("all"); setQuery(""); resetSort(); }}
          search={<SearchFilter aria-label="Search calendar" placeholder="Search task or customer…" value={query} onChange={e => setQuery(e.target.value)} />}
          hasSearch={!!query.trim()}
          filters={[
            { label: "Event type", value: kind, onRemove: () => setKind("all"), displayValue: kind === "task" ? "Tasks" : "Follow-ups" },
            sortFilter(sort, calendarSortOptions, "date:asc", resetSort),
          ]}
        >
          <FilterSelect label="Event type" aria-label="Calendar event type" value={kind} onValueChange={setKind}><option value="all">All events</option><option value="task">Tasks</option><option value="followup">Follow-ups</option></FilterSelect>
          
          <SortControls sort={sort} options={calendarSortOptions} onChange={changeSort} />
        </RecordFilters>
      </Panel>
      <div className="grid items-start gap-5 2xl:grid-cols-[1fr_300px]">
        <Panel>
          <div className="flex items-center justify-between gap-3 border-b p-4">
            <h2 className="text-sm font-semibold">
              {new Intl.DateTimeFormat("en", {
                timeZone: "UTC",
                month: "long",
                year: "numeric",
              }).format(first)}
            </h2>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setCursor({ year, month: month - 1 });
                  setSelected(today);
                }}
              >
                <ActionIcon action="today" />
                Today
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Previous month"
                onClick={() => shift(-1)}
              >
                <ActionIcon action="previous" />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Next month"
                onClick={() => shift(1)}
              >
                <ActionIcon action="next" />
              </Button>
            </div>
          </div>
          <div className="overflow-auto">
            <div className="min-w-[650px]">
              <div className="grid grid-cols-7 border-b bg-muted/25">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                  <span
                    key={d}
                    className="p-3 text-center text-xs text-muted-foreground"
                  >
                    {d}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {Array.from(
                  { length: Math.ceil((offset + days) / 7) * 7 },
                  (_, i) => {
                    const day = i - offset + 1,
                      valid = day > 0 && day <= days,
                      key = `${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
                      dayEvents = events.filter((e) => dateKey(e.date) === key);
                    return (
                      <div
                        key={i}
                        className={`min-h-28 border-b border-r p-2 ${!valid ? "bg-muted/20" : selected === key ? "bg-violet-50/60 dark:bg-violet-950/20" : ""}`}
                      >
                        {valid && (
                          <>
                            <button
                              onClick={() => setSelected(key)}
                              aria-label={`Select ${key}`}
                              aria-pressed={selected === key}
                              className={`mb-2 flex size-6 items-center justify-center rounded-full text-xs ${today === key ? "bg-[#6e3ff3] text-white" : "hover:bg-muted"}`}
                            >
                              {day}
                            </button>
                            <div className="space-y-1">
                              {dayEvents.slice(0, 2).map((e) => (
                                <button
                                  onClick={() => setSelected(key)}
                                  key={e.id}
                                  className={`block w-full truncate rounded px-1.5 py-1 text-left text-[9px] ${e.kind === "task" ? "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300" : "bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300"}`}
                                >
                                  {e.title}
                                </button>
                              ))}
                              {dayEvents.length > 2 && (
                                <button
                                  className="text-[9px] text-muted-foreground"
                                  onClick={() => setSelected(key)}
                                >
                                  +{dayEvents.length - 2} more
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  },
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4 p-4 text-[10px] text-muted-foreground">
            <span>
              <span className="mr-1.5 inline-block size-1.5 rounded-full bg-blue-500" />
              Tasks
            </span>
            <span>
              <span className="mr-1.5 inline-block size-1.5 rounded-full bg-violet-500" />
              Follow-ups
            </span>
          </div>
        </Panel>
        <Panel
          title={new Intl.DateTimeFormat("en", {
            timeZone: "UTC",
            day: "numeric",
            month: "long",
            year: "numeric",
          }).format(new Date(`${selected}T12:00:00Z`))}
        >
          {daily.length ? (
            daily.map((e) => {
              const lead = data.leads.find(lead => lead.id === e.leadId);
              return (
              <Link
                key={e.id}
                data-record-id={e.id}
                href={e.kind === "followup" ? `/follow-ups?lead=${encodeURIComponent(e.leadId)}` : e.leadId ? `/leads/${e.leadId}` : "/tasks"}
                className="flex items-start gap-3 border-b p-4 last:border-0"
              >
                {lead ? (
                  <PersonAvatar name={lead.name} email={lead.email} photoUrl={lead.photoUrl} />
                ) : e.kind === "task" ? (
                  <CheckSquare className="mt-0.5 size-4 shrink-0 text-blue-500" />
                ) : (
                  <Clock3 className="mt-0.5 size-4 shrink-0 text-violet-500" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium">{e.title}</p>
                  {lead && <p className="mt-1 truncate text-xs text-muted-foreground">{lead.name}</p>}
                  <p className="mt-2 text-xs text-muted-foreground">
                    {format(e.date, true)}
                  </p>
                </div>
                <ActionIcon action="view" className="ml-auto text-muted-foreground" />
              </Link>
              );
            })
          ) : (
            <EmptyState
              title="A clear day"
              description="No open tasks or follow-ups scheduled."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCreate(true)}
                >
                  <ActionIcon action="create" />
                  Add a task
                </Button>
              }
            />
          )}
        </Panel>
      </div>
      <TaskForm open={create} onOpenChange={setCreate} date={selected} />
    </div>
  );
}
