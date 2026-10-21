"use client";

import { useEffect, useState } from "react";
import {
  Check,
  CheckCircle2,
  CircleAlert,
  CircleSlash,
  Clock3,
  Loader2,
} from "lucide-react";
import type { MailJob } from "@/lib/crm/types";
import { StatusBadge } from "./shared";


export function MailProgress({
  job,
  syncing,
  paused,
}: {
  job: MailJob;
  syncing: boolean;
  paused: boolean;
}) {
  const isReport = job.kind === "lead-report";
  const stages = ["Queued", isReport ? "Ready" : "Synced", "Sending", "Sent"];
  const sent = job.status === "Sent";
  const cancelled = job.status === "Cancelled";
  const needsAttention = paused || job.status === "Needs Review";
  const active = (job.status === "Queued" && !paused) || job.status === "Sending";
  // These are confirmed milestones, not a time-based percentage or countdown.
  const completed = sent
    ? 4
    : job.status === "Queued" && (syncing || paused)
      ? 1
      : 2;
  const title = sent
    ? "Email sent"
    : cancelled
      ? "Send request cancelled"
      : paused
        ? "Sending paused"
        : job.status === "Needs Review"
          ? "Check delivery in Gmail"
          : job.status === "Sending"
            ? "Sending through Gmail"
            : syncing
              ? "Syncing your reply"
              : "Waiting to send";
  const description = sent
    ? "Gmail confirmed that your email was sent."
    : cancelled
      ? "This request is no longer waiting to send."
      : paused
        ? "A saved change needs attention before this reply can be sent."
        : job.status === "Needs Review"
          ? "Gmail's delivery result is uncertain. Check Sent before sending again."
          : job.status === "Sending"
            ? isReport ? "Preparing and sending your report. Waiting for Gmail to confirm." : "Preparing and sending your reply. Waiting for Gmail to confirm."
            : syncing
              ? "Your approved reply is saved. Its changes are syncing before sending."
              : isReport ? "Your report and attachments are ready. The sender checks about once a minute." : "Your reply is ready. The sender checks for queued replies about once a minute.";
  const Icon = sent
    ? CheckCircle2
    : cancelled
      ? CircleSlash
      : needsAttention
        ? CircleAlert
        : job.status === "Queued" && !syncing
          ? Clock3
          : Loader2;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active, job.id]);
  const elapsed = Math.max(0, Math.floor((now - Date.parse(job.createdAt)) / 1000)) || 0;
  const elapsedLabel = elapsed < 60
    ? `${elapsed}s`
    : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;

  return (
    <div className="space-y-4" aria-label="Email delivery progress details">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full ${sent ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300" : needsAttention ? "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300" : cancelled ? "bg-muted text-muted-foreground" : "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300"}`}>
            <Icon aria-hidden="true" className={`size-4 ${active && Icon === Loader2 ? "animate-spin motion-reduce:animate-none" : ""}`} />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">Email delivery</p>
            <p className="mt-1 text-sm font-semibold" role="status" aria-live="polite" aria-atomic="true">{title}</p>
          </div>
        </div>
        <StatusBadge value={job.status} />
      </div>

      {!cancelled && (
        <>
          <div
            role="progressbar"
            aria-label="Email delivery progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={sent ? 100 : undefined}
            aria-valuetext={title}
            className="grid grid-cols-4 gap-1.5"
          >
            {stages.map((stage, index) => (
              <div key={stage} className={`h-2 rounded-full ${index < completed ? sent ? "bg-emerald-500" : "bg-violet-500" : index === completed ? needsAttention ? "bg-amber-400" : "animate-pulse bg-violet-300 motion-reduce:animate-none dark:bg-violet-600" : "bg-muted-foreground/15"}`} />
            ))}
          </div>
          <ol className="grid grid-cols-4 gap-1.5 text-[10px] sm:text-xs" aria-label="Delivery stages">
            {stages.map((stage, index) => (
              <li key={stage} aria-current={!sent && index === completed ? "step" : undefined} className={`flex items-center gap-1 ${index < completed ? sent ? "font-medium text-emerald-700 dark:text-emerald-300" : "font-medium text-violet-700 dark:text-violet-300" : index === completed ? needsAttention ? "font-medium text-amber-700 dark:text-amber-300" : "font-medium text-foreground" : "text-muted-foreground"}`}>
                {index < completed && <Check className="size-3 shrink-0" aria-hidden="true" />}
                {stage}
                {index < completed && <span className="sr-only"> complete</span>}
              </li>
            ))}
          </ol>
        </>
      )}

      <p className="text-xs leading-6 text-muted-foreground">{description}</p>
      {active && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
          <span>Updates automatically</span>
          <span className="tabular-nums">Time elapsed: {elapsedLabel}</span>
        </div>
      )}
    </div>
  );
}
