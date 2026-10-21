"use client";
import { ActionIcon } from "./action-icon";
import { useState } from "react";
import Link from "next/link";

import type { Draft, Lead, MailJob } from "@/lib/crm/types";
import { Button } from "@/components/ui/button";
import { useCRM } from "./provider";
import { Confirm, Modal, useFormat } from "./shared";
import { MailProgress } from "./mail-progress";
import { updateFailureCopy } from "@/lib/crm/customer-copy";

export function MailDelivery({ job }: { job: MailJob }) {
  const { data, run, busy } = useCRM(), format = useFormat();
  const updates = data.syncChanges.filter(c => c.entityId === `lead:${job.leadId}` || c.entityId === `draft:${job.draftId}`);
  const failedUpdates = updates.filter(c => c.status === "Failed");
  const syncing = job.status === "Queued" && updates.some(c => c.status === "Pending");
  const paused = job.status === "Queued" && failedUpdates.length > 0;
  const [resolve, setResolve] = useState(false);
  return <div className="space-y-4 rounded-xl border bg-card p-4 sm:p-5" aria-label="Email delivery">
    <MailProgress job={job} syncing={syncing} paused={paused} />
    {job.status === "Cancelled" && <p className="text-xs leading-6 text-muted-foreground">{job.detail}</p>}
    {job.status === "Queued" && failedUpdates.length > 0 && <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-6 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100" role="alert"><p>{updateFailureCopy(failedUpdates[0].detail)}</p><Link className="font-medium underline" href="/automation#sync">Review saved changes</Link></div>}
    <p className="break-words text-xs text-muted-foreground">{job.sentAt ? `Sent ${format(job.sentAt, true)}` : `Updated ${format(job.updatedAt, true)}`}{job.senderEmail ? ` · From ${job.senderEmail}` : ""}</p>
    <div className="flex flex-wrap gap-2">
      {job.status === "Queued" && <Button variant="outline" size="sm" disabled={busy} onClick={() => void run("mail.cancel", { id: job.id }, job.kind === "lead-report" ? "Queued report cancelled." : "Queued reply cancelled. Pending automatic follow-ups stay cancelled.")}><ActionIcon action="cancel" />{job.kind === "lead-report" ? "Cancel queued report" : "Cancel queued reply"}</Button>}
      {["Sent", "Sending", "Needs Review"].includes(job.status) && <Button variant="outline" size="sm" asChild><a href="https://mail.google.com/mail/u/0/#sent" target="_blank" rel="noreferrer"><ActionIcon action="external" />Check Gmail Sent</a></Button>}
      {job.status === "Needs Review" && <Button variant="outline" size="sm" disabled={busy} onClick={() => setResolve(true)}><ActionIcon action="approve" />I checked Gmail: not sent</Button>}
    </div>
    <Confirm open={resolve} onOpenChange={setResolve} title="Confirm this reply was not sent" description="Check the sending account's Sent folder first. Confirm only if this exact reply was not delivered. This lets you review the reply and send it again." label="Confirm not sent" onConfirm={() => run("mail.resolve", { id: job.id, confirmedNotSent: true }, "Delivery reviewed. You can review the draft and send again.")} />
  </div>;
}

export function SendReply({ draft, lead, changed }: { draft: Draft; lead: Lead; changed: boolean }) {
  const { data, run, busy } = useCRM();
  const [confirm, setConfirm] = useState(false), [resetLinks, setResetLinks] = useState(false);
  const job = data.mailJobs.find(j => j.draftId === draft.id);
  const blocked = !!job && job.status !== "Cancelled";
  const ready = !!data.connection.lastMailPollAt;
  const missingLink = !!draft.gmailDraftId && data.syncChanges.some(c => c.entityId === `draft:${draft.id}` && c.status === "Failed" && c.detail.includes("Could not read the Gmail draft"));
  return <div className="space-y-4 border-t p-5">
    {job && <MailDelivery job={job} />}
    {missingLink && (!job || ["Queued", "Cancelled"].includes(job.status)) && <Button variant="outline" disabled={busy} onClick={() => setResetLinks(true)}><ActionIcon action="reset" />Reset deleted Gmail links</Button>}
    {!blocked && <>
      <p className="text-xs leading-6 text-muted-foreground">{lead.isSample ? "Sample inquiries cannot send email. Use a real test inquiry with your own address." : !ready ? "Email sending is unavailable. Contact support; you can still save and review this reply." : draft.status !== "Approved" || changed ? "Save and approve the finished reply to enable sending." : `Send this approved reply from ${data.connection.mailSenderEmail}.`}</p>
      <div className="flex flex-wrap items-center gap-3"><Button disabled={busy || lead.isSample || !ready || changed || draft.status !== "Approved"} onClick={() => setConfirm(true)}><ActionIcon action="send" />Send via Gmail</Button>{!ready && <Link className="text-xs text-[#6e3ff3] hover:underline" href="/automation#manual-email">View sending status</Link>}</div>
    </>}
    <Modal open={confirm} onOpenChange={setConfirm} title="Send this reply through Gmail?" description="Review the recipient and final message. Your reply will send after its saved changes finish updating." wide>
      <div className="space-y-4">
        <dl className="space-y-2 text-sm"><div><dt className="inline text-muted-foreground">From: </dt><dd className="inline break-all">{data.connection.mailSenderEmail}</dd></div><div><dt className="inline text-muted-foreground">To: </dt><dd className="inline break-all">{lead.email}</dd></div><div><dt className="inline text-muted-foreground">Subject: </dt><dd className="inline break-words">{draft.subject}</dd></div></dl>
        <p className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-4 text-sm leading-7">{draft.body}</p>
        <p className="text-xs leading-6 text-muted-foreground">Any pending automatic follow-up for this inquiry will be cancelled before this reply is sent.</p>
        <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}><ActionIcon action="cancel" />Cancel</Button><Button disabled={busy} onClick={async () => { if (await run("draft.send", { id: draft.id, subject: draft.subject, body: draft.body, email: lead.email, senderEmail: data.connection.mailSenderEmail, confirmed: true }, "Reply queued. Follow its progress below.")) setConfirm(false); }}>{busy ? <ActionIcon action="loading" /> : <ActionIcon action="send" />}{busy ? "Queueing email…" : "Confirm and queue email"}</Button></div>
      </div>
    </Modal>
    <Confirm open={resetLinks} onOpenChange={setResetLinks} title="Reset deleted Gmail links?" description="First check Gmail Sent and confirm that you deleted the original draft or thread. This cancels a queued send, keeps the inquiry and reply text, and requires fresh approval before sending again." label="Confirm deleted Gmail links" icon="reset" onConfirm={() => run("draft.unlink", {id:draft.id,confirmedUnavailable:true,clearThread:true}, "Gmail links reset. Review and approve the reply before sending again.")} />
  </div>;
}
