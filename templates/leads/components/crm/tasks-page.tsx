"use client";
import { ActionIcon } from "./action-icon";
import { useState } from "react";
import Link from "next/link";
import { ListTodo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCRM } from "./provider";
import { TaskForm } from "./forms";
import {
  PageHeading,
  Panel,
  EmptyState,
  Confirm,
  useFormat,
  PersonAvatar,
} from "./shared";
import type { Task } from "@/lib/crm/types";
import { dateSortValue, dueSortLabels, sortRecords, type SortOption } from "@/lib/crm/record-sort";
import { RecordFilters, FilterSelect, SearchFilter, SortControls, useRecordSort, sortFilter } from "./record-controls";
const taskSortOptions: readonly SortOption<Task>[] = [
  { key: "due", label: "Due date", value: t => dateSortValue(t.dueAt), ...dueSortLabels },
  { key: "title", label: "Task title", value: t => t.title },
  { key: "completed", label: "Completion", value: t => t.completed, ascLabel: "Open first", descLabel: "Completed first" },
];
export function TasksPage() {
  const { data, run, busy } = useCRM(),
    format = useFormat();
  const [create, setCreate] = useState(false),
    [filter, setFilter] = useState("open"),
    [query, setQuery] = useState(""),
    [remove, setRemove] = useState<Task | null>(null),
    [edit, setEdit] = useState<Task | null>(null);
  const { sort, changeSort, resetSort } = useRecordSort("due", "asc");
  const tasks = sortRecords(data.tasks
    .filter(
      (t) =>
        t.title.toLowerCase().includes(query.trim().toLowerCase()) &&
        (filter === "all" ||
          (filter === "open" && !t.completed) ||
          (filter === "done" && t.completed) ||
          (filter === "overdue" &&
            !t.completed &&
            Date.parse(t.dueAt) < Date.now())),
    ), sort, taskSortOptions);
  return (
    <div className="space-y-6">
      <PageHeading
        title="Tasks & reminders"
        description="Keep customer calls, quotes, and reviews moving."
      >
        <Button onClick={() => setCreate(true)}>
          <ActionIcon action="create" />
          New task
        </Button>
      </PageHeading>
      <div className="grid grid-cols-3 gap-3">
        {[
          {
            title: "Open tasks",
            count: data.tasks.filter((t) => !t.completed).length,
          },
          {
            title: "Overdue",
            count: data.tasks.filter(
              (t) => !t.completed && Date.parse(t.dueAt) < Date.now(),
            ).length,
          },
          {
            title: "Completed",
            count: data.tasks.filter((t) => t.completed).length,
          },
        ].map((c) => (
          <Panel className="crm-stat-card p-5" key={c.title} tone={c.title === "Overdue" ? "amber" : c.title === "Completed" ? "emerald" : "violet"}>
            <p className="text-xs text-muted-foreground">{c.title}</p>
            <p className="crm-stat-value mt-3 text-2xl font-semibold">{c.count}</p>
          </Panel>
        ))}
      </div>
      <Panel
        title="Task list"
        action={<ListTodo className="size-4 text-muted-foreground" />}
      >
        <RecordFilters onClear={() => { setFilter("all"); setQuery(""); resetSort(); }}
          search={<SearchFilter
              placeholder="Search tasks…"
              aria-label="Search tasks"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
          />}
          hasSearch={!!query.trim()}
          filters={[
            { label: "Status", value: filter, onRemove: () => setFilter("all"), displayValue: ({ open: "Open tasks", done: "Completed", overdue: "Overdue" } as Record<string, string>)[filter] },
            sortFilter(sort, taskSortOptions, "due:asc", resetSort),
          ]}
        >
          <FilterSelect label="Status"
            value={filter}
            onValueChange={setFilter}
            aria-label="Task filter"
          >
            <option value="open">Open tasks</option>
            <option value="all">All tasks</option>
            <option value="overdue">Overdue</option>
            <option value="done">Completed</option>
          </FilterSelect>
          
          <SortControls sort={sort} options={taskSortOptions} onChange={changeSort} />
        </RecordFilters>
        <p role="status" className="border-b px-5 py-2 text-xs text-muted-foreground">{tasks.length} matching tasks</p>
        {tasks.length ? (
          tasks.map((t) => {
            const lead = data.leads.find((l) => l.id === t.leadId),
              overdue = !t.completed && Date.parse(t.dueAt) < Date.now();
            return (
              <div
                key={t.id}
                data-record-id={t.id}
                className="flex flex-wrap items-center gap-3 border-b px-5 py-5 last:border-0"
              >
                <input
                  type="checkbox"
                  aria-label={`Complete ${t.title}`}
                  checked={t.completed}
                  disabled={busy}
                  onChange={(e) =>
                    void run(
                      "task.update",
                      { id: t.id, completed: e.target.checked },
                      "Task updated.",
                    )
                  }
                  className="size-4 accent-[#6e3ff3]"
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm font-medium ${t.completed ? "text-muted-foreground line-through" : ""}`}
                  >
                    {t.title}
                  </p>
                  <p
                    className={`mt-1.5 text-xs ${overdue ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground"}`}
                  >
                    {overdue ? "Overdue · " : ""}
                    {format(t.dueAt, true)}
                  </p>
                  {lead && (
                    <Link
                      href={`/leads/${lead.id}`}
                      className="mt-2 inline-flex max-w-full items-center gap-2.5 text-xs text-muted-foreground hover:text-[#6e3ff3]"
                    >
                      <PersonAvatar name={lead.name} email={lead.email} photoUrl={lead.photoUrl} />
                      <span className="min-w-0 truncate">{lead.name} · {lead.service}</span>
                      <ActionIcon action="view" />
                    </Link>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Edit task ${t.title}`}
                  onClick={() => setEdit(t)}
                >
                  <ActionIcon action="edit" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Delete task ${t.title}`}
                  onClick={() => setRemove(t)}
                >
                  <ActionIcon action="delete" />
                </Button>
              </div>
            );
          })
        ) : (
          <EmptyState
            title="No tasks here"
            description="Create a reminder or choose a different task filter."
            action={
              <Button variant="outline" onClick={() => setCreate(true)}>
                <ActionIcon action="create" />
                Create task
              </Button>
            }
          />
        )}
      </Panel>
      <TaskForm open={create} onOpenChange={setCreate} />
      {edit && (
        <TaskForm
          open
          onOpenChange={(v) => {
            if (!v) setEdit(null);
          }}
          task={edit}
        />
      )}
      <Confirm
        open={!!remove}
        onOpenChange={(v) => {
          if (!v) setRemove(null);
        }}
        title="Delete this task?"
        description={remove?.title || ""}
        destructive
        label="Delete task"
        onConfirm={() =>
          run("task.delete", { id: remove?.id }, "Task deleted.")
        }
      />
    </div>
  );
}
