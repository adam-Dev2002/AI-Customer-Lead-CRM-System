"use client";
import { ActionIcon } from "./action-icon";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCRM } from "./provider";
import { LeadForm, TaskForm } from "./forms";
import {
  Panel,
  StatusBadge,
  PersonAvatar,
  EmptyState,
  Confirm,
  useFormat,
  textareaClass,
} from "./shared";
import { SyncStatus } from "./sync-status";
import { activityAppearance } from "@/lib/crm/activity-appearance";
import { activityColors } from "./activity-mark";
import { inboxHref } from "@/lib/crm/inbox-navigation";

export function LeadDetailPage({ id }: { id: string }) {
  const { data, run, busy } = useCRM(),
    format = useFormat(),
    router = useRouter();
  const l = data.leads.find((l) => l.id === id);
  const [edit, setEdit] = useState(false),
    [task, setTask] = useState(false),
    [remove, setRemove] = useState(false);
  if (!l)
    return (
      <EmptyState
        title="Lead not found"
        description="This inquiry may have been removed from your workspace."
        action={
          <Button asChild>
            <Link href="/leads"><ActionIcon action="back" />Back to leads</Link>
          </Button>
        }
      />
    );
  const drafts = data.drafts.filter((d) => d.leadId === id),
    events = data.activities.filter((a) => a.leadId === id).map(a => ({ ...a, ...activityAppearance(a) })),
    tasks = data.tasks.filter((t) => t.leadId === id);
  async function createDraft() {
    if (await run("draft.create", { leadId: id }, "Reply draft created."))
      router.push(inboxHref("replies", id));
  }
  return (
    <div className="space-y-6">
      <Link
        href="/leads"
        className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Back to leads
      </Link>
      <SyncStatus leadId={id} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <PersonAvatar name={l.name} email={l.email} photoUrl={l.photoUrl} />
          <div>
            <h1 className="text-xl font-semibold">{l.name}</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {l.id} · {l.source}
              {l.isSample ? " · Sample inquiry" : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setTask(true)}>
            <ActionIcon action="create" />
            Add task
          </Button>
          <Button variant="outline" onClick={() => setEdit(true)}>
            <ActionIcon action="edit" />
            Edit lead
          </Button>
          <Button
            disabled={busy || drafts.some((d) => d.status === "Pending review")}
            onClick={() => void createDraft()}
          >
            <ActionIcon action="createReply" />
            Create reply draft
          </Button>
        </div>
      </div>
      <div className="grid items-start gap-5 xl:grid-cols-[1.65fr_1fr]">
        <div className="space-y-5">
          <Panel
            title="Customer inquiry"
            action={<StatusBadge value={l.priority} />}
          >
            <div className="space-y-5 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="break-words font-semibold [overflow-wrap:anywhere]">{l.service}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Received {format(l.createdAt, true)}
                  </p>
                </div>
                <StatusBadge value={l.category} />
              </div>
              <p className="whitespace-pre-wrap break-words text-sm leading-7 [overflow-wrap:anywhere]">
                {l.message}
              </p>
              {l.summary && l.summary !== l.message && (
                <div className="rounded-lg border border-violet-200 bg-violet-50 p-4 dark:border-violet-900 dark:bg-violet-950/30">
                  <p className="text-xs font-semibold text-violet-700 dark:text-violet-300">
                    AI summary
                  </p>
                  <p className="mt-2 break-words text-sm [overflow-wrap:anywhere]">{l.summary}</p>
                </div>
              )}
            </div>
          </Panel>
          <Panel
            title="Replies & review"
            action={
              <span className="text-xs text-muted-foreground">
                {drafts.length} drafts
              </span>
            }
          >
            {drafts.length ? (
              drafts.map((d) => (
                <Link
                  key={d.id}
                  href={inboxHref("replies", id, d.id)}
                  className="flex items-center justify-between gap-3 border-b p-5 last:border-0"
                >
                  <div>
                    <p className="text-sm font-medium">{d.subject}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {d.provider} · {format(d.updatedAt, true)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge value={d.status} />
                    <ActionIcon action="view" className="text-muted-foreground" />
                  </div>
                </Link>
              ))
            ) : (
              <EmptyState
                title="No reply drafted yet"
                description="Write a reply for this inquiry. AI suggestions appear when an email needs a response and a suitable reply is available."
                action={
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void createDraft()}
                  >
                    <ActionIcon action="createReply" />
                    Create a draft
                  </Button>
                }
              />
            )}
          </Panel>
          <Panel title="Internal notes">
            <form
              key={l.updatedAt}
              className="space-y-3 p-5"
              onSubmit={async (e: FormEvent<HTMLFormElement>) => {
                e.preventDefault();
                await run(
                  "lead.update",
                  { id, notes: new FormData(e.currentTarget).get("notes") },
                  "Notes saved.",
                );
              }}
            >
              <textarea
                name="notes"
                aria-label="Internal notes"
                className={textareaClass}
                defaultValue={l.notes}
                placeholder="Add context for yourself or your team…"
                maxLength={10000}
              />
              <Button type="submit" variant="outline" disabled={busy}>
                <ActionIcon action="save" />
                Save notes
              </Button>
            </form>
          </Panel>
          <Panel title="Activity timeline">
            {events.length ? (
              <div className="px-5 py-2">
                {events.map((a) => (
                  <div className="relative border-l py-4 pl-5" key={a.id} data-activity-tone={a.tone}>
                    <span aria-hidden="true" className={`absolute -left-1 top-6 size-2 rounded-full ${activityColors[a.tone].dot}`} />
                    <p className={`text-sm font-medium ${activityColors[a.tone].text}`}>{a.title}</p>
                    {a.detail && (
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {a.detail}
                      </p>
                    )}
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      {format(a.createdAt, true)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No activity yet"
                description="Updates to this inquiry will be recorded here."
              />
            )}
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel title="Lead details">
            <dl className="space-y-4 p-5 text-sm">
              {[
                ["Status", <StatusBadge key="s" value={l.status} />],
                ["Assigned to", l.owner],
                ["Source", l.source],
                [
                  "Email",
                  <a
                    key="e"
                    href={`mailto:${l.email}`}
                    className="break-all hover:underline"
                  >
                    {l.email}
                  </a>,
                ],
                [
                  "Phone",
                  l.phone ? (
                    <a
                      key="p"
                      href={`tel:${l.phone.replace(/[^\d+]/g, "")}`}
                      className="hover:underline"
                    >
                      {l.phone}
                    </a>
                  ) : (
                    "Not provided"
                  ),
                ],
                ["Created", format(l.createdAt, true)],
              ].map(([key, value], i) => (
                <div key={i}>
                  <dt className="mb-1.5 text-xs text-muted-foreground">
                    {key}
                  </dt>
                  <dd className="font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            {["New", "Pending"].includes(l.status) && (
              <div className="border-t p-5">
                <Button
                  className="w-full"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      "lead.update",
                      { id, status: "Contacted" },
                      "Lead marked contacted; pending local follow-up skipped.",
                    )
                  }
                >
                  <ActionIcon action="approve" />
                  Mark as contacted
                </Button>
              </div>
            )}
          </Panel>
          <Panel title="Follow-up">
            <div className="space-y-4 p-5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Permission</span>
                <span>
                  {l.consent ? "Granted" : "Not recorded"}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Status</span>
                <StatusBadge value={l.followUpState} />
              </div>
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <Clock3 className="size-3.5 shrink-0" />
                {l.followUpDue ? format(l.followUpDue, true) : "No due date"}
              </p>
              {l.followUpSentAt && (
                <p className="text-xs text-muted-foreground">
                  Sent {format(l.followUpSentAt, true)}
                  {l.isSample ? " (sample)" : ""}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/follow-ups?lead=${encodeURIComponent(id)}`}>
                    <ActionIcon action="reschedule" />
                    Manage follow-up
                  </Link>
                </Button>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Save and approve the email in Follow-ups before its scheduled
                check can send. Its confirmed delivery result appears here.
              </p>
            </div>
          </Panel>
          <Panel title="Delivery results">
            <div className="space-y-4 p-5 text-xs">
              <div>
                <p className="text-muted-foreground">
                  Customer acknowledgement
                </p>
                <p className="mt-1.5 font-medium">{l.acknowledgementStatus}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Owner notification</p>
                <p className="mt-1.5 font-medium">{l.ownerAlertStatus}</p>
              </div>
            </div>
          </Panel>
          <Panel
            title="Related tasks"
            action={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Add related task"
                onClick={() => setTask(true)}
              >
                <ActionIcon action="create" />
              </Button>
            }
          >
            {tasks.length ? (
              tasks.map((t) => (
                <label
                  key={t.id}
                  className="flex items-start gap-3 border-b p-4 text-xs last:border-0"
                >
                  <input
                    type="checkbox"
                    disabled={busy}
                    className="mt-0.5 accent-[#6e3ff3]"
                    checked={t.completed}
                    onChange={(e) =>
                      void run(
                        "task.update",
                        { id: t.id, completed: e.target.checked },
                        "Task updated.",
                      )
                    }
                  />
                  <span
                    className={
                      t.completed ? "text-muted-foreground line-through" : ""
                    }
                  >
                    {t.title}
                    <span className="mt-1 block text-[10px] text-muted-foreground">
                      {format(t.dueAt, true)}
                    </span>
                  </span>
                </label>
              ))
            ) : (
              <p className="p-5 text-xs text-muted-foreground">
                No tasks for this inquiry.
              </p>
            )}
          </Panel>
          <Button
            variant="ghost"
            className="text-destructive"
            onClick={() => setRemove(true)}
          >
            <ActionIcon action="delete" />
            Delete lead
          </Button>
        </div>
      </div>
      {edit && <LeadForm open onOpenChange={setEdit} lead={l} />}
      <TaskForm open={task} onOpenChange={setTask} leadId={id} />
      <Confirm
        open={remove}
        onOpenChange={setRemove}
        title="Delete this lead?"
        description="The inquiry and its associated local drafts and tasks will be removed."
        label="Delete lead"
        destructive
        onConfirm={async () => {
          const result = await run("lead.delete", { id }, "Lead deleted.");
          if (result) router.push("/leads");
          return result;
        }}
      />
    </div>
  );
}
