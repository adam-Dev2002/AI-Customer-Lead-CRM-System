import type { CRMData } from "./types";
import { ValidationError, isEmail, text } from "./domain.ts";
import { queueLeadChange } from "./integration.ts";
import { reportCapability, currentReportRecipient } from "./report-mail.ts";

// Claim is persisted by storage's serialized transaction before n8n receives it.
// Claimed/uncertain sends never become eligible for an automatic retry.
export function claimMail(data: CRMData, input: Record<string, unknown>, now: string) {
  const executionId = text(input.executionId, 100), senderEmail = text(input.senderEmail, 150).toLowerCase();
  if (!executionId || !isEmail(senderEmail)) throw new ValidationError("A Gmail account and execution ID are required.");
  data.lastMailPollAt = now;
  data.mailSenderEmail = senderEmail;
  data.mailSenderCapabilities = Array.isArray(input.capabilities) && input.capabilities.includes(reportCapability) ? [reportCapability] : [];
  if (data.mailJobs.some(j => j.executionId === executionId)) return { job: null };
  const job = [...data.mailJobs].reverse().find(j => j.status === "Queued" && (j.kind !== "lead-report" || data.mailSenderCapabilities!.includes(reportCapability)) && !data.syncChanges.some(c =>
    c.status !== "Applied" && (c.entityId === `draft:${j.draftId}` || c.entityId === `lead:${j.leadId}`)));
  if (!job) return { job: null };
  if (job.kind === "lead-report") {
    if (job.senderEmail !== senderEmail || !currentReportRecipient(data, job) || !job.reportId || !job.reportDigest) {
      job.status = "Needs Review"; job.detail = "The sending account or business recipient changed. Nothing was sent."; job.updatedAt = now; return { job: null };
    }
    job.status = "Sending"; job.executionId = executionId; job.updatedAt = now; job.detail = "Preparing the confirmed report for Gmail.";
    return { job: { ...job } };
  }
  const draft = data.drafts.find(d => d.id === job.draftId), lead = data.leads.find(l => l.id === job.leadId);
  if (!draft || !lead || lead.isSample || lead.followUpState === "Reserved" || job.senderEmail !== senderEmail || draft.status !== "Approved" || lead.email !== job.to || draft.subject !== job.subject || draft.body !== job.body) {
    job.status = "Needs Review";
    job.detail = "The approved reply, recipient, or sending account changed. Nothing was sent by this execution.";
    job.updatedAt = now;
    return { job: null };
  }
  job.gmailDraftId = draft.gmailDraftId || "";
  job.gmailThreadId = lead.gmailThreadId || "";
  job.status = "Sending";
  job.senderEmail = senderEmail;
  job.executionId = executionId;
  job.detail = "Claimed by n8n. Awaiting Gmail's delivery result.";
  job.updatedAt = now;
  return { job: { ...job } };
}

function ownedJob(data: CRMData, input: Record<string, unknown>) {
  const job = data.mailJobs.find(j => j.id === input.jobId);
  if (!job) throw new ValidationError("Reply delivery not found.", 404);
  if (!job.executionId || job.executionId !== input.executionId) throw new ValidationError("This execution does not own the reply delivery.", 409);
  return job;
}

export function prepareMail(data: CRMData, input: Record<string, unknown>, now: string) {
  const job = ownedJob(data, input), gmailDraftId = text(input.gmailDraftId, 200);
  if (job.status !== "Sending" || !gmailDraftId) throw new ValidationError("A sending reply and prepared Gmail draft ID are required.", 409);
  if (job.gmailDraftId && job.gmailDraftId !== gmailDraftId) throw new ValidationError("The prepared draft differs from the claimed reply.", 409);
  job.gmailDraftId = gmailDraftId;
  job.updatedAt = now;
  return { accepted: true, gmailDraftId };
}

export function finishMail(data: CRMData, input: Record<string, unknown>, now: string, makeId: () => string) {
  const job = ownedJob(data, input), messageId = text(input.gmailMessageId, 200);
  if (!["Sent", "Needs Review"].includes(String(input.status))) throw new ValidationError("Provide Sent or Needs Review.");
  if (input.status === "Sent" && (!messageId || !job.gmailDraftId)) throw new ValidationError("A prepared draft and Gmail message ID are required to confirm sending.");
  if (job.status === "Sent") {
    if (input.status !== "Sent" || job.gmailMessageId !== messageId) throw new ValidationError("This reply already has a confirmed Gmail send result.", 409);
    return { accepted: true, duplicate: true };
  }
  if (job.status === "Needs Review") {
    if (input.status !== "Needs Review") throw new ValidationError("Review the uncertain delivery in Gmail before changing its result.", 409);
    return { accepted: true, duplicate: true };
  }
  if (job.status !== "Sending") throw new ValidationError("Only a claimed reply can receive a delivery result.", 409);
  job.status = input.status as "Sent" | "Needs Review";
  job.updatedAt = now;
  job.detail = job.status === "Sent" ? (job.kind === "lead-report" ? "Gmail confirmed sending this report." : "Gmail confirmed sending this reply.") : text(input.detail, 1000) || "Gmail delivery could not be confirmed. Check Sent in Gmail before sending again.";
  if (job.status === "Sent") {
    job.gmailMessageId = messageId;
    job.gmailThreadId = text(input.gmailThreadId, 200) || job.gmailThreadId;
    job.sentAt = now;
    const lead = job.kind === "lead-report" ? undefined : data.leads.find(l => l.id === job.leadId);
    if (lead) {
      const fields = ["Gmail_Thread_ID"];
      lead.gmailThreadId = job.gmailThreadId || lead.gmailThreadId;
      if (["New", "Pending"].includes(lead.status)) { lead.status = "Contacted"; fields.push("Status"); }
      if (lead.followUpState === "Pending") { lead.followUpState = "Skipped"; fields.push("Follow_Up_State"); }
      lead.updatedAt = now;
      queueLeadChange(data, lead, now, makeId, false, fields, "mail.sent");
    }
  }
  data.activities.unshift({ id: makeId(), type: job.kind === "lead-report" ? "settings" : "draft", leadId: job.leadId || undefined, title: job.kind === "lead-report" ? (job.status === "Sent" ? "Leads report sent through Gmail" : "Report delivery needs review") : job.status === "Sent" ? "Reply sent through Gmail" : "Reply delivery needs review", detail: `${job.to}: ${job.detail}`, createdAt: now, status: job.status === "Sent" ? "success" : "failed", executionId: job.executionId });
  data.activities = data.activities.slice(0, 3000);
  return { accepted: true, duplicate: false };
}
