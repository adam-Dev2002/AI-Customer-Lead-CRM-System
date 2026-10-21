"use client";

import { useEffect, useState } from "react";
import { canScheduleFollowUp } from "@/lib/crm/domain";
import { followUpApproved, followUpBlocker, followUpPreview } from "@/lib/crm/followup-email";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActionIcon } from "./action-icon";
import { useCRM } from "./provider";
import { PersonAvatar, StatusBadge, useFormat } from "./shared";

export function FollowUpEditor({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const { data, run, busy } = useCRM(), format = useFormat();
  const lead = data.leads.find(item => item.id === leadId)!;
  const saved = followUpPreview(lead, data.settings);
  const [subject, setSubject] = useState(saved.subject), [body, setBody] = useState(saved.body);
  const [revision, setRevision] = useState(saved.revision), [permission, setPermission] = useState(lead.consent);
  const [due, setDue] = useState(""), [confirm, setConfirm] = useState(false);
  const [notSent, setNotSent] = useState(false);
  const dirty = subject !== saved.subject || body !== saved.body;
  const locked = ["Reserved", "Sent", "Needs Review"].includes(lead.followUpState);
  const approved = followUpApproved(lead);
  // Preserve unsaved text across polls. A competing edit needs an explicit reload.
  const conflict = revision !== saved.revision;
  useEffect(() => { setConfirm(false); }, [subject, body, saved.revision, lead.email, lead.followUpDue, lead.consent]);
  useEffect(() => { setPermission(lead.consent); }, [lead.consent]);
  const reload = () => { setSubject(saved.subject); setBody(saved.body); setRevision(saved.revision); setConfirm(false); };
  async function save() {
    if (await run("followup.save", { id: lead.id, revision, subject, body }, "Follow-up email saved for review.")) {
      setSubject(subject.trim()); setBody(body.trim()); setRevision(revision + 1); setConfirm(false);
    }
  }
  return <div className="space-y-5">
    <div className="flex items-start gap-3">
      <PersonAvatar name={lead.name} email={lead.email} photoUrl={lead.photoUrl} />
      <div className="min-w-0 flex-1"><p className="font-medium">{lead.name}</p><p className="mt-1 break-all text-xs text-muted-foreground">{lead.email}</p><p className="mt-2 break-words text-sm">{lead.service}</p></div>
      <StatusBadge value={lead.followUpState} />
    </div>
    {(lead.message || lead.summary) && <details className="rounded-lg border p-4">
      <summary className="cursor-pointer text-xs font-medium text-primary focus-visible:outline-2 focus-visible:outline-ring">Read original inquiry</summary>
      <div className="mt-3 space-y-3 text-xs leading-6">
        {lead.message && <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{lead.message}</p>}
        {lead.summary && lead.summary !== lead.message && <div className="rounded-md bg-primary/5 p-3"><p className="font-medium">AI summary</p><p className="mt-1 break-words [overflow-wrap:anywhere]">{lead.summary}</p></div>}
      </div>
    </details>}
    <dl className="grid gap-4 rounded-lg border bg-muted/20 p-4 text-sm sm:grid-cols-2">
      <div><dt className="text-xs text-muted-foreground">Scheduled time</dt><dd className="mt-1.5">{lead.followUpDue ? format(lead.followUpDue, true) : "Not scheduled"}</dd><dd className="mt-1 text-[11px] text-muted-foreground">{data.settings.timezone}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Customer permission</dt><dd className="mt-1.5">{lead.consent ? "Customer consented" : "No permission recorded"}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Inquiry status</dt><dd className="mt-1.5"><StatusBadge value={lead.status} /></dd></div>
      <div><dt className="text-xs text-muted-foreground">Priority</dt><dd className="mt-1.5"><StatusBadge value={lead.priority} /></dd></div>
      <div><dt className="text-xs text-muted-foreground">Sent time</dt><dd className="mt-1.5">{lead.followUpSentAt ? format(lead.followUpSentAt, true) : "No confirmed send recorded"}</dd></div>
    </dl>
    <p role="status" className="rounded-lg border border-primary/15 bg-primary/5 p-4 text-xs leading-6 text-muted-foreground">{followUpBlocker(lead, data.settings)}</p>
    {lead.followUpState === "Needs Review" && <section className="space-y-3 rounded-lg border border-amber-500/30 p-4">
      <label className="flex items-start gap-2 text-xs leading-6"><input type="checkbox" className="mt-1.5 size-4 shrink-0 accent-primary" checked={notSent} onChange={event => setNotSent(event.target.checked)} />I checked the sending account and confirmed this follow-up was not sent.</label>
      <Button type="button" variant="outline" size="sm" disabled={busy || !notSent} onClick={() => void run("followup.resolve", { id: lead.id, confirmedNotSent: true }, "Delivery reviewed. Choose a new schedule and approve the email before sending.")}><ActionIcon action="review" />Confirm not sent</Button>
    </section>}
    {!locked && <section className="space-y-3 rounded-lg border p-4">
      <h3 className="text-sm font-medium">Permission & schedule</h3>
      <label className="flex items-start gap-2 text-xs leading-6"><input type="checkbox" className="mt-1.5 size-4 accent-primary" checked={permission} onChange={event => setPermission(event.target.checked)} />I have the customer's permission for one follow-up email.</label>
      <Button type="button" size="sm" variant="outline" disabled={busy || permission === lead.consent} onClick={() => void run("followup.permission", { id: lead.id, consent: permission, confirmed: permission }, "Customer permission saved.")}><ActionIcon action="save" />Save permission</Button>
      {canScheduleFollowUp(lead) && <form className="space-y-3 border-t pt-3" onSubmit={async event => {
        event.preventDefault();
        if (await run("followup.reschedule", { id: lead.id, dueAt: new Date(due).toISOString() }, "Follow-up schedule saved. Review the email before approving.")) { setDue(""); setConfirm(false); }
      }}>
        <label className="block text-xs font-medium" htmlFor="followup-time">Follow-up date & time</label>
        <Input id="followup-time" type="datetime-local" required value={due} onChange={event => setDue(event.target.value)} />
        <p className="text-[11px] leading-5 text-muted-foreground">Uses your device's timezone. Changing the time requires a new approval.</p>
        <Button type="submit" size="sm" variant="outline" disabled={busy || !due}><ActionIcon action="reschedule" />Save schedule</Button>
      </form>}
    </section>}
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">Follow-up email</h3><StatusBadge value={locked && !lead.followUpEmail ? "Not recorded" : approved ? "Approved" : lead.followUpEmail ? "Pending review" : "Suggested preview"} /></div>
      {locked && !lead.followUpEmail ? <p className="text-xs leading-6 text-muted-foreground">The email text for this earlier delivery was not recorded. Its delivery status is preserved; no replacement preview is shown as the sent email.</p> : <>
        <dl className="space-y-1 text-xs text-muted-foreground"><div className="flex gap-2"><dt>To</dt><dd className="break-all text-foreground">{locked && saved.approvedTo ? saved.approvedTo : lead.email}</dd></div><div className="flex gap-2"><dt>From</dt><dd className="break-all">{data.mailSenderEmail || "Your connected sending account"}</dd></div></dl>
        <label htmlFor="followup-subject" className="block text-xs font-medium">Follow-up subject</label>
        <Input id="followup-subject" value={locked ? saved.subject : subject} maxLength={200} onChange={event => setSubject(event.target.value)} disabled={locked || busy} />
        <label htmlFor="followup-body" className="block text-xs font-medium">Follow-up email body</label>
        <textarea id="followup-body" className="min-h-64 w-full rounded-md border bg-transparent px-3 py-2 text-sm leading-7 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60" value={locked ? saved.body : body} maxLength={10000} onChange={event => setBody(event.target.value)} disabled={locked || busy} />
        {conflict && <div role="alert" className="rounded-md bg-amber-500/10 p-3 text-xs leading-6">The saved email changed. Your text has been kept. <button type="button" className="underline" onClick={reload}>Reload saved email</button> before saving or approving.</div>}
        {!locked && <>
          <p className="text-[11px] leading-5 text-muted-foreground">{dirty ? "Unsaved email changes. Saving withdraws any previous approval." : !lead.followUpEmail ? "Suggested preview. Save this email before approving it." : approved ? "The saved email is approved for the recipient and schedule above." : "Saved email waiting for your approval."}</p>
          <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={busy || conflict || (!dirty && !!lead.followUpEmail)} onClick={() => void save()}><ActionIcon action="save" />Save email</Button>
            {approved && <Button type="button" size="sm" variant="outline" disabled={busy || conflict} onClick={async () => { if (await run("followup.unapprove", { id: lead.id, revision }, "Follow-up approval withdrawn.")) setRevision(revision + 1); }}><ActionIcon action="reject" />Withdraw approval</Button>}
          </div>
          {!approved && !!lead.followUpEmail && !dirty && !conflict && lead.followUpState === "Pending" && lead.consent && ["New", "Pending"].includes(lead.status) && <div className="space-y-3 border-t pt-3">
            <label className="flex items-start gap-2 text-xs leading-6"><input type="checkbox" className="mt-1.5 size-4 shrink-0 accent-primary" checked={confirm} onChange={event => setConfirm(event.target.checked)} />I reviewed this email and approve sending it to {lead.email} after {format(lead.followUpDue, true)} if the inquiry remains eligible.</label>
            <Button type="button" size="sm" disabled={busy || !confirm || lead.isSample} onClick={async () => {
              if (await run("followup.approve", { id: lead.id, revision, subject, body, email: lead.email, dueAt: lead.followUpDue, confirmed: true }, "Follow-up approved for its scheduled check. No delivery is recorded yet.")) { setRevision(revision + 1); setConfirm(false); }
            }}><ActionIcon action="approve" />Approve follow-up</Button>
          </div>}
        </>}
      </>}
    </section>
    <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
      {lead.followUpState === "Pending" && <Button type="button" variant="outline" disabled={busy} onClick={() => void run("followup.cancel", { id: lead.id }, "Follow-up cancelled.")}><ActionIcon action="cancel" />Cancel follow-up</Button>}
      <Button type="button" variant="outline" onClick={onClose}><ActionIcon action="cancel" />Close</Button>
    </div>
  </div>;
}
