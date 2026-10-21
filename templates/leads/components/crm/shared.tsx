"use client";
import { ActionIcon, type ActionName } from "./action-icon";
import type { ReactNode, ComponentProps } from "react";
import { useId, isValidElement, cloneElement } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Inbox, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCRM } from "./provider";
import { dateFormatter } from "@/lib/crm/date-format";
import type { CRMTone } from "./metric-card";
export { PersonAvatar } from "./person-avatar";

export const selectClass =
  "crm-input h-9 rounded-md border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";
export const textareaClass =
  "crm-input min-h-28 w-full rounded-md border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const colorMap: Record<string, string> = {
  Saved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  Completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  Waiting: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  "Needs attention": "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
  "In progress": "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  Queued: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  Sending: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  New: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  Pending:
    "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  "Pending review":
    "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
  Contacted:
    "bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300",
  Qualified:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  Won: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  Approved:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  Sent: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  Applied: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  success: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  Failed: "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
  failed: "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
  High: "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300",
  Urgent: "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
  "Needs Review":
    "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
  Reserved:
    "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  Lost: "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
  Rejected: "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
};
export function StatusBadge({ value }: { value: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "whitespace-nowrap border-transparent text-[11px] font-medium",
        colorMap[value] || "bg-muted text-muted-foreground",
      )}
    >
      {value}
    </Badge>
  );
}
export function Panel({
  children,
  className,
  title,
  action,
  icon: Icon,
  tone = "violet",
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  action?: ReactNode;
  icon?: LucideIcon;
  tone?: CRMTone;
}) {
  return (
    <section data-tone={tone} className={cn("crm-panel min-w-0 rounded-xl border bg-card", className)}>
      {title && (
        <div className="crm-panel-heading flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <div className="flex min-w-0 items-center gap-2.5">
            {Icon ? <span className="crm-panel-mark flex size-8 shrink-0 items-center justify-center rounded-lg"><Icon className="size-4" aria-hidden="true" /></span>
              : <span className="crm-panel-stripe h-4 w-1 shrink-0 rounded-full" aria-hidden="true" />}
            <h2 className="text-sm font-semibold">{title}</h2>
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export function PageHeading({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
      <div className="crm-page-heading">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {children && (
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      )}
    </div>
  );
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="crm-empty-state flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <span className="crm-empty-icon rounded-2xl border p-4">
        <Inbox className="size-6" />
      </span>
      <h3 className="font-medium">{title}</h3>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      {action}
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
  className,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  className?: string;
}) {
  const generatedId = useId();
  const child = isValidElement<{ id?: string; "aria-describedby"?: string }>(
    children,
  )
    ? children
    : null;
  const id = child?.props.id || generatedId;
  return (
    <div className={cn("flex flex-col gap-2 text-sm", className)}>
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      {child
        ? cloneElement(child, {
            id,
            "aria-describedby": hint
              ? `${id}-hint`
              : child.props["aria-describedby"],
          })
        : children}
      {hint && (
        <span
          id={`${id}-hint`}
          className="text-xs leading-relaxed text-muted-foreground"
        >
          {hint}
        </span>
      )}
    </div>
  );
}
export function NativeSelect(props: ComponentProps<"select">) {
  return <select {...props} className={cn(selectClass, props.className)} />;
}
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            "crm-dialog fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-card p-6 shadow-xl",
            wide ? "max-w-2xl" : "max-w-lg",
          )}
        >
          <Dialog.Title className="pr-8 text-lg font-semibold">
            {title}
          </Dialog.Title>
          <Dialog.Description
            className={cn(
              "mt-1 text-sm text-muted-foreground",
              !description && "sr-only",
            )}
          >
            {description || title}
          </Dialog.Description>
          <Dialog.Close
            className="absolute right-4 top-4 rounded p-1 hover:bg-muted"
            aria-label="Close dialog"
          >
            <ActionIcon action="cancel" />
          </Dialog.Close>
          <div className="mt-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Confirm({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  label = "Confirm",
  destructive = false,
  icon = "approve",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => Promise<boolean>;
  label?: string;
  destructive?: boolean;
  icon?: ActionName;
}) {
  const { busy } = useCRM();
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
    >
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          <ActionIcon action="cancel" />
          Cancel
        </Button>
        <Button
          disabled={busy}
          variant={destructive ? "destructive" : "default"}
          onClick={async () => {
            if (await onConfirm()) onOpenChange(false);
          }}
        >
          <ActionIcon action={busy ? "loading" : destructive ? "delete" : icon} />
          {busy ? "Saving…" : label}
        </Button>
      </div>
    </Modal>
  );
}
export function Pager({
  page,
  count,
  size,
  onChange,
}: {
  page: number;
  count: number;
  size: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(count / size));
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3">
      <p className="text-xs text-muted-foreground">
        {count
          ? `${(page - 1) * size + 1}–${Math.min(page * size, count)} of ${count}`
          : "0 results"}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <ActionIcon action="previous" />
        </Button>
        <span className="text-xs">
          Page {page} of {pages}
        </span>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Next page"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
        >
          <ActionIcon action="next" />
        </Button>
      </div>
    </div>
  );
}
export function useFormat() {
  const { data } = useCRM();
  return (value: string, time = false) =>
    value
      ? dateFormatter("en-SG", {
          timeZone: data.settings.timezone,
          day: "numeric",
          month: "short",
          year: "numeric",
          ...(time ? { hour: "numeric", minute: "2-digit" } : {}),
        }).format(new Date(value))
      : "—";
}
export function toLocalDateTime(iso: string) {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export { matchesPeriod } from "@/lib/crm/date-filter";
