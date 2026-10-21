"use client";
import { ActionIcon } from "./action-icon";
import type { FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { Lead, Task } from "@/lib/crm/types";
import { leadStatuses, priorities } from "@/lib/crm/types";
import { useCRM } from "./provider";
import {
  Modal,
  Field,
  NativeSelect,
  textareaClass,
  toLocalDateTime,
} from "./shared";

export function LeadForm({
  open,
  onOpenChange,
  lead,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lead?: Lead;
}) {
  const { data, run, busy } = useCRM();
  const currentLead = lead
    ? data.leads.find((item) => item.id === lead.id) || lead
    : undefined;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget),
      fields = Object.fromEntries(form.entries());
    if (
      await run(
        lead ? "lead.update" : "lead.create",
        // Permission is managed in Follow-ups. Omit it so an ordinary edit
        // cannot revoke it or overwrite a newer permission change.
        { ...fields, id: lead?.id },
        lead ? "Lead updated." : "Lead created.",
      )
    )
      onOpenChange(false);
  }
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={lead ? "Edit lead" : "Create a lead"}
      description="Keep the customer's contact details and inquiry up to date."
      wide
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name">
            <Input
              name="name"
              defaultValue={lead?.name}
              required
              minLength={2}
              maxLength={100}
              autoFocus
            />
          </Field>
          <Field label="Email address">
            <Input
              name="email"
              type="email"
              defaultValue={lead?.email}
              required
              maxLength={150}
            />
          </Field>
          <Field label="Phone number">
            <Input name="phone" defaultValue={lead?.phone} maxLength={50} />
          </Field>
          <Field label="Service needed">
            <Input
              name="service"
              defaultValue={lead?.service}
              required
              minLength={2}
              maxLength={120}
            />
          </Field>
          <Field label="Status">
            <NativeSelect name="status" defaultValue={lead?.status || "New"}>
              {leadStatuses.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Priority">
            <NativeSelect
              name="priority"
              defaultValue={lead?.priority || "Normal"}
            >
              {priorities.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Assigned owner">
            <Input
              name="owner"
              defaultValue={lead?.owner || data.settings.ownerName}
              maxLength={100}
            />
          </Field>
          <Field label="Inquiry category">
            <NativeSelect
              name="category"
              defaultValue={lead?.category || "General"}
            >
              {["General", "Sales", "Quote", "Booking", "Support"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Inquiry message" className="sm:col-span-2">
            <textarea
              className={textareaClass}
              name="message"
              defaultValue={lead?.message}
              required
              minLength={3}
              maxLength={5000}
            />
          </Field>
          <Field label="Internal notes" className="sm:col-span-2">
            <textarea
              className={textareaClass}
              name="notes"
              defaultValue={lead?.notes}
              maxLength={10000}
            />
          </Field>
        </div>
        <div className="space-y-2 rounded-lg border bg-muted/20 px-4 py-3">
          <dl className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <dt className="text-muted-foreground">Follow-up permission</dt>
            <dd
              className={`font-medium ${currentLead?.consent ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}
            >
              {currentLead?.consent ? "Granted" : "Not recorded"}
            </dd>
          </dl>
          <p className="text-xs leading-6 text-muted-foreground">
            {lead
              ? "Manage permission, scheduling and email approval in Follow-ups."
              : "After saving this inquiry, record customer permission and manage the email in Follow-ups."}
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            <ActionIcon action="cancel" />
            Cancel
          </Button>
          <Button disabled={busy} type="submit">
            <ActionIcon action={busy ? "loading" : lead ? "save" : "create"} />
            {busy ? "Saving…" : lead ? "Save changes" : "Create lead"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
export function TaskForm({
  open,
  onOpenChange,
  leadId = "",
  date,
  task,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  leadId?: string;
  date?: string;
  task?: Task;
}) {
  const { data, run, busy } = useCRM();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (
      await run(
        task ? "task.update" : "task.create",
        {
          id: task?.id,
          title: f.get("title"),
          leadId: f.get("leadId"),
          dueAt: new Date(String(f.get("dueAt"))).toISOString(),
        },
        task ? "Task updated." : "Task added.",
      )
    )
      onOpenChange(false);
  }
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={task ? "Edit task" : "New task"}
      description="Add a reminder for yourself or link it to a customer inquiry."
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Task title">
          <Input
            name="title"
            defaultValue={task?.title}
            required
            maxLength={200}
            autoFocus
            placeholder="e.g. Call customer about their quote"
          />
        </Field>
        <Field label="Due date & time">
          <Input
            type="datetime-local"
            name="dueAt"
            required
            defaultValue={
              task
                ? toLocalDateTime(task.dueAt)
                : date
                  ? `${date}T09:00`
                  : toLocalDateTime(
                      new Date(Date.now() + 3600000).toISOString(),
                    )
            }
          />
        </Field>
        <Field label="Related lead">
          <NativeSelect name="leadId" defaultValue={task?.leadId || leadId}>
            <option value="">No linked lead</option>
            {data.leads.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} · {l.service}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            <ActionIcon action="cancel" />
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            <ActionIcon action={busy ? "loading" : task ? "save" : "create"} />
            {task ? "Save task" : "Create task"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
