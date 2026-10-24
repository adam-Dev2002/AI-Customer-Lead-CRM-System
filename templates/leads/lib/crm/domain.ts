import type {
  CRMData,
  Lead,
  Draft,
  Mutation,
  LeadStatus,
  Priority,
  FollowUpState,
} from "./types";
import { leadStatuses, priorities } from "./types.ts";
import { isEmailAddress, normalizeEmail } from "./email-address.ts";
import { readReportEmailPreferences } from "./email-preferences.ts";
import { queueDraftReview, queueEmailMirrors, queueLeadChange, queueOwnerChanges } from "./integration.ts";
import { safePhotoUrl } from "./contact-photos.ts";
import { followUpApproved } from "./followup-email.ts";
import { inboxFailureCopy, parseInboxScan, recordInboxScan } from './inbox-scan.ts';

export class ValidationError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export const text = (value: unknown, max = 2000) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
export const isEmail = isEmailAddress;
export function validDate(value: unknown, fallback = "") {
  const raw = text(value, 50);
  return raw && Number.isFinite(Date.parse(raw))
    ? new Date(raw).toISOString()
    : fallback;
}
export function eligibleForFollowUp(lead: Lead, now = Date.now()) {
  return (
    lead.consent &&
    ["New", "Pending"].includes(lead.status) &&
    lead.followUpState === "Pending" &&
    !!lead.followUpDue &&
    Date.parse(lead.followUpDue) <= now
  );
}
export function canScheduleFollowUp(lead: Lead) {
  return (
    lead.consent &&
    ["New", "Pending"].includes(lead.status) &&
    !["Sent", "Reserved", "Needs Review"].includes(lead.followUpState)
  );
}
export function buildLead(
  p: Record<string, unknown>,
  settings: CRMData["settings"],
  now: string,
  id: string,
): Lead {
  const name = text(p.name, 100),
    email = text(p.email, 150).toLowerCase();
  const service = text(p.service, 120),
    message = text(p.message, 5000);
  if (
    name.length < 2 ||
    !isEmail(email) ||
    service.length < 2 ||
    message.length < 3
  )
    throw new ValidationError(
      "Enter a name, valid email, service, and inquiry message.",
    );
  const status = leadStatuses.includes(p.status as LeadStatus)
    ? (p.status as LeadStatus)
    : "New";
  const consent = p.consent === true;
  return {
    id,
    name,
    email,
    photoUrl: safePhotoUrl(p.photoUrl) || undefined,
    service,
    message,
    phone: text(p.phone, 50),
    source: text(p.source, 50) || "Manual",
    status,
    priority: priorities.includes(p.priority as Priority)
      ? (p.priority as Priority)
      : "Normal",
    category: text(p.category, 60) || "General",
    summary: text(p.summary, 500),
    owner: text(p.owner, 100) || settings.ownerName,
    notes: text(p.notes, 10000),
    consent,
    createdAt: now,
    updatedAt: now,
    followUpDue: new Date(
      Date.parse(now) + settings.followUpHours * 3600000,
    ).toISOString(),
    followUpState:
      consent && ["New", "Pending"].includes(status) ? "Pending" : "Skipped",
    followUpSentAt: "",
    acknowledgementStatus: "Not sent",
    ownerAlertStatus: "Not sent",
    isSample: false,
  };
}
export function applyMutation(
  data: CRMData,
  mutation: Mutation,
  now: string,
  makeId: () => string,
): void {
  const p = mutation.payload || {};
  const leadById = (id: unknown) => {
    const l = data.leads.find((l) => l.id === id);
    if (!l) throw new ValidationError("Lead not found.", 404);
    return l;
  };
  const draftById = () => {
    const d = data.drafts.find((d) => d.id === p.id);
    if (!d) throw new ValidationError("Draft not found.", 404);
    return d;
  };
  const log = (
    type: CRMData["activities"][number]["type"],
    title: string,
    detail = "",
    leadId?: string,
  ) => {
    data.activities.unshift({
      id: makeId(),
      type,
      title,
      detail,
      leadId,
      createdAt: now,
    });
    data.activities = data.activities.slice(0, 3000);
  };
  switch (mutation.action) {
    case "lead.create": {
      const l = buildLead(
        p,
        data.settings,
        now,
        `LEAD-${makeId().slice(0, 8).toUpperCase()}`,
      );
      const duplicate = data.leads.some(
        (x) =>
          x.email === l.email &&
          x.service.toLowerCase() === l.service.toLowerCase() &&
          x.message.toLowerCase() === l.message.toLowerCase() &&
          Date.parse(now) - Date.parse(x.createdAt) < 900000,
      );
      if (duplicate)
        throw new ValidationError(
          "This inquiry was already added within the last 15 minutes.",
          409,
        );
      data.leads.unshift(l);
      log("lead", `New inquiry from ${l.name}`, l.service, l.id);
      break;
    }
    case "lead.update": {
      const l = leadById(p.id);
      if (
        p.status !== undefined &&
        !leadStatuses.includes(p.status as LeadStatus)
      )
        throw new ValidationError("Choose a valid lead status.");
      if (
        p.priority !== undefined &&
        !priorities.includes(p.priority as Priority)
      )
        throw new ValidationError("Choose a valid priority.");
      const updated = buildLead(
        { ...l, ...p },
        data.settings,
        l.createdAt,
        l.id,
      );
      const previousStatus = l.status;
      Object.assign(l, {
        name: updated.name,
        email: updated.email,
        photoUrl: updated.email === l.email ? updated.photoUrl : safePhotoUrl(p.photoUrl) || undefined,
        phone: updated.phone,
        service: updated.service,
        message: updated.message,
        status: updated.status,
        priority: updated.priority,
        owner: updated.owner,
        notes: updated.notes,
        consent: updated.consent,
        category: updated.category,
        updatedAt: now,
      });
      if (
        (!l.consent || !["New", "Pending"].includes(l.status)) &&
        l.followUpState === "Pending"
      )
        l.followUpState = "Skipped";
      log(
        "lead",
        previousStatus !== l.status
          ? `${l.name} moved to ${l.status}`
          : `${l.name}'s details updated`,
        "Saved in the local workspace.",
        l.id,
      );
      break;
    }
    case "lead.delete": {
      const l = leadById(p.id);
      if (data.mailJobs.some(j => j.leadId === l.id && ["Queued", "Sending"].includes(j.status)))
        throw new ValidationError("Cancel the queued reply or check its Gmail delivery before deleting this lead.", 409);
      queueLeadChange(data, l, now, makeId, true);
      if (!l.isSample) data.archivedLeadIds.push(l.id);
      data.syncChanges = data.syncChanges.filter(c => c.leadId !== l.id || c.kind !== "draft.review" || c.status === "Applied");
      data.leads = data.leads.filter((x) => x.id !== l.id);
      data.drafts = data.drafts.filter((x) => x.leadId !== l.id);
      data.tasks = data.tasks.filter((x) => x.leadId !== l.id);
      log(
        "lead",
        `Deleted ${l.name}'s lead`,
        "Associated local drafts and tasks were removed.",
      );
      break;
    }
    case "leads.import": {
      if (!Array.isArray(p.rows) || !p.rows.length || p.rows.length > 1000)
        throw new ValidationError(
          "Import between 1 and 1,000 leads at a time.",
        );
      const imported = p.rows.map((r, i) => {
        if (!r || typeof r !== "object" || Array.isArray(r))
          throw new ValidationError(`Invalid row ${i + 2}.`);
        try {
          return buildLead(
            { ...(r as Record<string, unknown>), source: "CSV import" },
            data.settings,
            now,
            `LEAD-${makeId().slice(0, 8).toUpperCase()}`,
          );
        } catch (e) {
          throw new ValidationError(`Row ${i + 2}: ${(e as Error).message}`);
        }
      });
      data.leads.unshift(...imported);
      log("lead", `Imported ${imported.length} leads`, "CSV import completed.");
      break;
    }
    case "draft.unlink": {
      const draft = data.drafts.find(d => d.id === p.id);
      if (!draft || p.confirmedUnavailable !== true)
        throw new ValidationError("Confirm that the linked Gmail draft or thread was deleted.");
      const lead = leadById(draft.leadId);
      const job = data.mailJobs.find(j => j.draftId === draft.id && j.status !== "Cancelled");
      if (job && ["Sending", "Sent", "Needs Review"].includes(job.status))
        throw new ValidationError("Review this reply's Gmail delivery before resetting its links.", 409);
      if (job) {
        job.status = "Cancelled";
        job.updatedAt = now;
        job.detail = "Cancelled because the owner confirmed the linked Gmail test draft or thread was deleted. Nothing was sent by this request.";
      }
      draft.gmailDraftId = "";
      draft.status = "Pending review";
      draft.reason = "Deleted Gmail links reset. Review and approve this saved reply before confirming a new send.";
      draft.updatedAt = now;
      if (p.clearThread === true) {
        lead.gmailThreadId = "";
        lead.updatedAt = now;
        queueLeadChange(data, lead, now, makeId, false, ["Gmail_Thread_ID"], "draft.unlink");
      }
      for (const change of data.syncChanges.filter(c => c.entityId === `draft:${draft.id}` && c.status !== "Applied")) {
        change.payload.Gmail_Draft_ID = "";
        if (p.clearThread === true) change.payload.Gmail_Thread_ID = "";
        change.status = "Pending";
        change.detail = "Deleted Gmail links reset by the owner; save the review in Sheets only.";
        change.updatedAt = now;
      }
      queueDraftReview(data, draft, lead, now, makeId, "draft.unlink");
      log("draft", "Deleted Gmail links reset", "Inquiry and reply text kept. A new send requires review and confirmation.", lead.id);
      break;
    }
    case "draft.create": {
      const l = leadById(p.leadId);
      if (
        data.drafts.some(
          (d) => d.leadId === l.id && d.status === "Pending review",
        )
      )
        throw new ValidationError(
          "This inquiry already has a draft awaiting review.",
          409,
        );
      const d: Draft = {
        id: makeId(),
        leadId: l.id,
        subject: `Re: ${l.service}`,
        body: `Hi ${l.name.split(" ")[0]},\n\nThank you for your inquiry about ${l.service.toLowerCase()}.\n\n[Add your response here.]\n\nKind regards,\n${data.settings.businessName}`,
        status: "Pending review",
        provider: "Manual",
        reason: "Written by the business owner.",
        createdAt: now,
        updatedAt: now,
      };
      data.drafts.unshift(d);
      log(
        "draft",
        `Reply draft created for ${l.name}`,
        "Manual draft; no email sent.",
        l.id,
      );
      break;
    }
    case "draft.save":
    case "draft.approve":
    case "draft.reject": {
      const d = draftById(),
        l = leadById(d.leadId);
      if (data.mailJobs.some(j => j.draftId === d.id && ["Queued", "Sending", "Sent", "Needs Review"].includes(j.status)))
        throw new ValidationError("This reply has a delivery request. Cancel it while queued, or review its delivery before editing. Create a new draft for another reply.", 409);
      if (mutation.action !== "draft.reject") {
        const body = text(p.body === undefined ? d.body : p.body, 10000),
          subject = text(p.subject === undefined ? d.subject : p.subject, 250);
        if (!subject || body.length < 15)
          throw new ValidationError(
            "Add a subject and a reply of at least 15 characters.",
          );
        if (
          mutation.action === "draft.approve" &&
          body.includes("[Add your response here.]")
        )
          throw new ValidationError(
            "Replace the response placeholder before approving.",
          );
        d.body = body;
        d.subject = subject;
      }
      d.status =
        mutation.action === "draft.approve"
          ? "Approved"
          : mutation.action === "draft.reject"
            ? "Rejected"
            : "Pending review";
      d.updatedAt = now;
      log(
        "draft",
        `${d.status === "Approved" ? "Approved" : d.status === "Rejected" ? "Rejected" : "Saved"} reply for ${l.name}`,
        "Local review only; no email was sent.",
        l.id,
      );
      break;
    }
    case "draft.send": {
      const d = draftById(), l = leadById(d.leadId);
      if (p.confirmed !== true) throw new ValidationError("Confirm the recipient and reply before sending.");
      if (l.isSample) throw new ValidationError("Sample inquiries cannot send email.");
      if (!data.lastMailPollAt) throw new ValidationError("Connect the manual Gmail sender workflow first.", 409);
      if (d.status !== "Approved" || d.body.includes("[Add your response here.]") || d.body.length < 15 || !d.subject || /[\r\n]/.test(d.subject) || /[\r\n]/.test(l.email))
        throw new ValidationError("Save and approve the finished reply before sending.");
      if (p.subject !== d.subject || p.body !== d.body || p.email !== l.email || p.senderEmail !== data.mailSenderEmail)
        throw new ValidationError("The reply or recipient changed. Review the latest version before sending.", 409);
      if (data.mailJobs.some(j => j.draftId === d.id && j.status !== "Cancelled"))
        throw new ValidationError("This reply already has a delivery request. Check its delivery result.", 409);
      if (data.mailJobs.some(j => j.leadId === l.id && ["Queued", "Sending", "Needs Review"].includes(j.status)))
        throw new ValidationError("Check the previous reply delivery for this inquiry before sending another.", 409);
      if (l.followUpState === "Reserved") throw new ValidationError("A follow-up is already being processed. Check its result before sending a reply.", 409);
      if (l.followUpState === "Pending") {
        l.followUpState = "Skipped";
        l.updatedAt = now;
        queueLeadChange(data, l, now, makeId, false, ["Follow_Up_State"], "followup.cancel");
      }
      data.mailJobs.unshift({ id: makeId(), draftId: d.id, leadId: l.id, to: l.email, subject: d.subject, body: d.body,
        gmailDraftId: d.gmailDraftId || "", gmailThreadId: l.gmailThreadId || "", senderEmail: data.mailSenderEmail, status: "Queued",
        detail: "Waiting for n8n. Lead and review changes must reach Sheets before sending.", executionId: "", createdAt: now, updatedAt: now, sentAt: "", gmailMessageId: "" });
      log("draft", `Reply queued for ${l.name}`, "The owner confirmed this reply. Waiting for Gmail delivery.", l.id);
      break;
    }
    case "mail.cancel": {
      const job = data.mailJobs.find(j => j.id === p.id);
      if (!job) throw new ValidationError("Reply delivery not found.", 404);
      if (job.status !== "Queued") throw new ValidationError("Only a reply still in the queue can be cancelled.", 409);
      job.status = "Cancelled";
      job.detail = job.kind === "lead-report" ? "Cancelled before the sending service picked up this report." : "Cancelled before n8n claimed the reply.";
      job.updatedAt = now;
      log(job.kind === "lead-report" ? "settings" : "draft", job.kind === "lead-report" ? "Queued report cancelled" : "Queued reply cancelled", job.to, job.leadId || undefined);
      break;
    }
    case "mail.resolve": {
      const job = data.mailJobs.find(j => j.id === p.id);
      if (!job || job.status !== "Needs Review" || p.confirmedNotSent !== true)
        throw new ValidationError("Check Gmail and confirm this reply was not sent before releasing the delivery request.", 409);
      job.status = "Cancelled";
      job.detail = "Owner checked Gmail and confirmed this reply was not sent. A new send request is allowed.";
      job.updatedAt = now;
      log("draft", "Delivery reviewed by owner", job.detail, job.leadId);
      break;
    }
    case "followup.cancel": {
      const l = leadById(p.id);
      if (l.followUpState !== "Pending")
        throw new ValidationError(
          "Only pending follow-ups can be cancelled. Check an uncertain delivery before releasing it.",
        );
      l.followUpState = "Skipped";
      if (l.followUpEmail) l.followUpEmail.approvedAt = "";
      l.updatedAt = now;
      log(
        "followup",
        `Follow-up cancelled for ${l.name}`,
        "The local follow-up is no longer pending.",
        l.id,
      );
      break;
    }
    case "followup.resolve": {
      const l = leadById(p.id);
      if (l.followUpState !== "Needs Review" || p.confirmedNotSent !== true)
        throw new ValidationError("Check the sending account and confirm this follow-up was not sent before releasing it.", 409);
      l.followUpState = "Skipped";
      if (l.followUpEmail) l.followUpEmail.approvedAt = "";
      l.updatedAt = now;
      log("followup", "Follow-up delivery reviewed", "Owner confirmed the follow-up was not sent. A new schedule and approval are required.", l.id);
      break;
    }
    case "followup.permission": {
      const l = leadById(p.id);
      if (["Reserved", "Sent", "Needs Review"].includes(l.followUpState))
        throw new ValidationError("A follow-up already being handled cannot have its permission changed here.", 409);
      if (typeof p.consent !== "boolean" || (p.consent && p.confirmed !== true))
        throw new ValidationError("Confirm the customer has agreed to receive one follow-up.");
      l.consent = p.consent;
      if (!l.consent && l.followUpState === "Pending") l.followUpState = "Skipped";
      if (l.followUpEmail) l.followUpEmail.approvedAt = "";
      l.updatedAt = now;
      log("followup", "Follow-up permission updated", l.consent ? "Owner recorded the customer's permission." : "Permission removed; pending follow-up cancelled.", l.id);
      break;
    }
    case "followup.save":
    case "followup.approve":
    case "followup.unapprove": {
      const l = leadById(p.id);
      if (["Reserved", "Sent", "Needs Review"].includes(l.followUpState))
        throw new ValidationError("This follow-up is already being handled. Its saved email cannot be changed.", 409);
      if (p.revision !== (l.followUpEmail?.revision || 0))
        throw new ValidationError("The follow-up email changed. Reload the saved email before reviewing it.", 409);
      if (mutation.action === "followup.save") {
        const subject = text(p.subject, 201), body = text(p.body, 10001);
        if (!subject || subject.length > 200 || /[\r\n]/.test(subject) || body.length < 15 || body.length > 10000)
          throw new ValidationError("Enter a one-line subject (up to 200 characters) and email text between 15 and 10,000 characters.");
        l.followUpEmail = { subject, body, revision: (l.followUpEmail?.revision || 0) + 1, updatedAt: now, approvedAt: "", approvedTo: "", approvedDue: "" };
      } else {
        const email = l.followUpEmail;
        if (!email) throw new ValidationError("Save the follow-up email before reviewing it.");
        if (mutation.action === "followup.approve") {
          if (!l.consent || !["New", "Pending"].includes(l.status) || l.followUpState !== "Pending" || !l.followUpDue || l.isSample)
            throw new ValidationError("Approval requires customer permission, an open inquiry and a scheduled follow-up. Samples cannot send.");
          if (p.confirmed !== true || p.email !== l.email || p.dueAt !== l.followUpDue || p.subject !== email.subject || p.body !== email.body)
            throw new ValidationError("The recipient, schedule or email changed. Review the saved email and confirm again.", 409);
          email.approvedAt = now; email.approvedTo = l.email; email.approvedDue = l.followUpDue;
        } else email.approvedAt = "";
        email.updatedAt = now;
        email.revision++;
      }
      l.updatedAt = now;
      log("followup", mutation.action === "followup.save" ? "Follow-up email saved" : followUpApproved(l) ? "Follow-up email approved" : "Follow-up approval withdrawn", "Approval records review; only a confirmed delivery result records Sent.", l.id);
      break;
    }
    case "followup.reschedule": {
      const l = leadById(p.id),
        due = validDate(p.dueAt);
      if (!canScheduleFollowUp(l))
        throw new ValidationError(
          "Follow-ups require consent and an open New/Pending lead. Sent or reserved follow-ups cannot be rescheduled.",
        );
      if (!due || Date.parse(due) <= Date.parse(now))
        throw new ValidationError("Choose a future follow-up time.");
      l.followUpDue = due;
      l.followUpState = "Pending";
      if (l.followUpEmail) l.followUpEmail.approvedAt = "";
      l.updatedAt = now;
      log("followup", `Follow-up scheduled for ${l.name}`, due, l.id);
      break;
    }
    case "task.create": {
      const title = text(p.title, 200),
        dueAt = validDate(p.dueAt);
      if (!title || !dueAt)
        throw new ValidationError("Add a task title and valid due date.");
      const leadId = text(p.leadId, 100);
      if (leadId) leadById(leadId);
      data.tasks.unshift({
        id: makeId(),
        title,
        leadId,
        dueAt,
        completed: false,
        createdAt: now,
      });
      log("task", `Task added: ${title}`, "", leadId || undefined);
      break;
    }
    case "task.update":
    case "task.delete": {
      const task = data.tasks.find((t) => t.id === p.id);
      if (!task) throw new ValidationError("Task not found.", 404);
      if (mutation.action === "task.delete")
        data.tasks = data.tasks.filter((t) => t.id !== task.id);
      else {
        if (p.completed !== undefined) {
          if (typeof p.completed !== "boolean")
            throw new ValidationError("Choose the task completion state.");
          task.completed = p.completed;
        }
        if (p.title !== undefined) {
          const title = text(p.title, 200);
          if (!title) throw new ValidationError("A task title is required.");
          task.title = title;
        }
        if (p.dueAt !== undefined) {
          const dueAt = validDate(p.dueAt);
          if (!dueAt) throw new ValidationError("Choose a valid due date.");
          task.dueAt = dueAt;
        }
        if (p.leadId !== undefined) {
          const leadId = text(p.leadId, 100);
          if (leadId) leadById(leadId);
          task.leadId = leadId;
        }
      }
      log(
        "task",
        `${mutation.action === "task.delete" ? "Deleted" : p.completed === true ? "Completed" : p.completed === false ? "Reopened" : "Updated"}: ${task.title}`,
        "",
        task.leadId || undefined,
      );
      break;
    }
    case "settings.update": {
      const s = data.settings;
      if (
        text(p.businessName, 100).length < 2 ||
        text(p.ownerName, 100).length < 2
      )
        throw new ValidationError("Add a business name and owner name.");
      const ownerEmail = normalizeEmail(text(p.ownerEmail, 150));
      if (ownerEmail && !isEmail(ownerEmail))
        throw new ValidationError("Enter a valid owner email.");
      const reportEmail = readReportEmailPreferences({ ...s, ownerEmail }, p);
      if (!reportEmail.ok) throw new ValidationError(reportEmail.error);
      const hours = Number(p.followUpHours);
      if (!Number.isFinite(hours) || hours < 1 || hours > 720)
        throw new ValidationError(
          "Follow-up delay must be between 1 and 720 hours.",
        );
      const timezone = text(p.timezone, 100);
      try {
        new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
      } catch {
        throw new ValidationError("Choose a valid timezone.");
      }
      const maxEmails = Number(p.maxEmailsPerScan ?? s.maxEmailsPerScan);
      const maxFollowUps = Number(p.maxFollowUpsPerScan ?? s.maxFollowUpsPerScan);
      if (![maxEmails, maxFollowUps].every(n => Number.isInteger(n) && n >= 1 && n <= 100))
        throw new ValidationError("Scan limits must be whole numbers between 1 and 100.");
      if (p.primaryAI !== undefined && !["gemini", "openai"].includes(String(p.primaryAI)))
        throw new ValidationError("Choose Gemini or OpenAI as the primary provider.");
      Object.assign(s, {
        businessName: text(p.businessName, 100),
        ownerName: text(p.ownerName, 100),
        ownerEmail,
        ...reportEmail.value,
        phone: text(p.phone, 50),
        website: text(p.website, 250),
        timezone,
        businessFacts: text(p.businessFacts, 10000),
        replyTone: text(p.replyTone, 1000),
        followUpHours: hours,
        customerAcknowledgements: p.customerAcknowledgements === true,
        customerFollowUps: p.customerFollowUps === true,
        aiClassification: p.aiClassification === true,
        ownerNotifications: p.ownerNotifications === true,
        automaticEmailsEnabled: p.automaticEmailsEnabled === undefined ? s.automaticEmailsEnabled : p.automaticEmailsEnabled === true,
        primaryAI: p.primaryAI ?? s.primaryAI,
        geminiModel: text(p.geminiModel ?? s.geminiModel, 100),
        openaiModel: text(p.openaiModel ?? s.openaiModel, 100),
        gmailQuery: text(p.gmailQuery ?? s.gmailQuery, 1000),
        maxEmailsPerScan: maxEmails,
        maxFollowUpsPerScan: maxFollowUps,
        responsePromise: text(p.responsePromise ?? s.responsePromise, 250),
        replySignature: text(p.replySignature ?? s.replySignature, 1000),
      });
      log(
        "settings",
        "Business settings saved",
        "Local preferences. Connect n8n before applying them to the automation.",
      );
      break;
    }
    case "sync.retry": {
      const change = data.syncChanges.find(c => c.id === p.id);
      if (!change || change.status !== "Failed")
        throw new ValidationError("Choose a failed update to retry.");
      change.status = "Pending";
      change.detail = "";
      change.updatedAt = now;
      log("automation", "External update queued for retry", change.label, change.leadId);
      break;
    }
    case "activity.read":
      data.notificationsReadAt = now;
      break;
    case "samples.clear": {
      const ids = new Set(
        data.leads.filter((l) => l.isSample).map((l) => l.id),
      );
      data.leads = data.leads.filter((l) => !ids.has(l.id));
      data.drafts = data.drafts.filter((d) => !ids.has(d.leadId));
      data.tasks = data.tasks.filter(
        (t) => !ids.has(t.leadId) && !t.id.startsWith("sample-"),
      );
      data.activities = data.activities.filter(
        (a) => !a.id.startsWith("sample-") && (!a.leadId || !ids.has(a.leadId)),
      );
      log(
        "settings",
        "Sample data removed",
        "Your own leads and settings were kept.",
      );
      break;
    }
    default:
      throw new ValidationError("Unknown action.");
  }
  queueOwnerChanges(data, mutation, now, makeId);
}

export function applyAutomationEvent(
  data: CRMData,
  input: Record<string, unknown>,
  now: string,
  makeId: () => string,
  internalEvent = false,
): { duplicate: boolean; ignored?: boolean } {
  const eventId = typeof input.eventId === "string" ? input.eventId.trim() : "",
    event = text(input.type, 60);
  if (!eventId || eventId.length > (internalEvent ? 200 : 180))
    throw new ValidationError("eventId is required and must be at most 180 characters.");
  if (data.processedEventIds.includes(eventId)) return { duplicate: true };
  const p = input.data as Record<string, unknown>;
  if (!p || typeof p !== "object" || Array.isArray(p))
    throw new ValidationError("An event data object is required.");
  const ignore = () => {
    data.processedEventIds = [...data.processedEventIds, eventId].slice(-2000);
    data.lastAutomationEventAt = now;
    return { duplicate: false, ignored: true };
  };
  if (event === 'inbox.scan') {
    const scan = parseInboxScan(p, now);
    if (!scan) throw new ValidationError('Provide a valid inbox scan status.');
    const previous = data.inboxScan;
    const changed = recordInboxScan(data, scan);
    data.processedEventIds = [...data.processedEventIds, eventId].slice(-2000);
    if (changed && ['complete', 'failed'].includes(scan.phase) && (previous?.runId !== scan.runId || previous.phase !== scan.phase)) {
      data.activities.unshift({ id: makeId(), type: 'automation', title: scan.phase === 'failed' ? 'Inbox check failed' : 'Inbox checked', detail: scan.phase === 'failed' ? inboxFailureCopy[scan.code!] : `${scan.matched || 0} matching emails checked.`, status: scan.phase === 'failed' ? 'failed' : 'success', stage: 'inbox', executionId: scan.runId, createdAt: now });
      data.activities = data.activities.slice(0, 3000);
    }
    return { duplicate: false, ...(!changed ? { ignored: true } : {}) };
  }
  if (event === "support.processed") {
    // Persist the email inquiry and its draft in the same local transaction.
    const result = applyAutomationEvent(data, { eventId: `${eventId}:lead`, type: "lead.upsert", data: p }, now, makeId, true);
    if (result.ignored) return ignore();
    if (p.Draft_ID) applyAutomationEvent(data, { eventId: `${eventId}:draft`, type: "draft.upsert", data: p }, now, makeId, true);
    const lead = data.leads.find(l => l.id === text(p.Lead_ID, 100))!;
    queueEmailMirrors(data, lead, data.drafts.find(d => d.id === p.Draft_ID), now, makeId);
  } else if (event === "lead.delivery") {
    const id = text(p.Lead_ID, 100);
    if (data.archivedLeadIds.includes(id)) return ignore();
    let lead = data.leads.find(l => l.id === id);
    if (!lead) {
      applyAutomationEvent(data, { eventId: `${eventId}:lead`, type: "lead.upsert", data: p }, now, makeId, true);
      lead = data.leads.find(l => l.id === id)!;
    }
    if (p.Acknowledgement_Status !== undefined) lead.acknowledgementStatus = text(p.Acknowledgement_Status, 150);
    if (p.Owner_Alert_Status !== undefined) lead.ownerAlertStatus = text(p.Owner_Alert_Status, 150);
    lead.updatedAt = now;
  } else
  if (event === "lead.upsert") {
    const id = text(p.Lead_ID, 100);
    if (!id) throw new ValidationError("Lead_ID is required.");
    if (data.archivedLeadIds.includes(id)) return ignore();
    const old = data.leads.find((l) => l.id === id);
    if (old && p.Create_Only === true) return ignore();
    if (data.syncChanges.some(c => c.leadId === id && c.entityId === `lead:${id}` && c.status !== "Applied"))
      throw new ValidationError("Apply outstanding CRM changes before refreshing this lead from Sheets.", 409);
    const mapped = {
      name: p.Name,
      email: p.Email,
      photoUrl: p.Photo_URL === undefined
        ? (old?.email === text(p.Email, 150).toLowerCase() ? old?.photoUrl : undefined)
        : p.Photo_URL,
      phone: p.Phone,
      service: p.Service,
      message: p.Message,
      source: p.Source,
      status: p.Status,
      priority:
        text(p.Priority).toLowerCase() === "urgent"
          ? "Urgent"
          : text(p.Priority).toLowerCase() === "high"
            ? "High"
            : text(p.Priority).toLowerCase() === "low"
              ? "Low"
              : "Normal",
      owner: p.Owner,
      notes: p.Notes,
      category: p.Category,
      summary: p.AI_Summary,
      consent: p.Consent === true || text(p.Consent).toLowerCase() === "yes",
    };
    const l = buildLead(
      mapped,
      data.settings,
      validDate(p.Created_At_UTC, old?.createdAt || now),
      id,
    );
    l.followUpDue = validDate(p.Follow_Up_Due_UTC, old?.followUpDue || "");
    const states: FollowUpState[] = [
      "Pending",
      "Reserved",
      "Sent",
      "Skipped",
      "Needs Review",
    ];
    l.followUpState = states.includes(p.Follow_Up_State as FollowUpState)
      ? (p.Follow_Up_State as FollowUpState)
      : l.followUpState;
    if (old?.followUpState === "Sent") l.followUpState = "Sent";
    if (old?.followUpExecutionId && old.followUpState === "Reserved")
      l.followUpState = "Reserved";
    l.followUpSentAt = validDate(p.Follow_Up_Sent_UTC, old?.followUpSentAt || "");
    l.acknowledgementStatus = text(p.Acknowledgement_Status, 150) || "Not sent";
    l.ownerAlertStatus = text(p.Owner_Alert_Status, 150) || "Not sent";
    l.gmailThreadId = text(p.Gmail_Thread_ID, 200);
    l.updatedAt = now;
    if (old) Object.assign(old, l);
    else data.leads.unshift(l);
  } else if (event === "draft.upsert") {
    const leadId = text(p.Lead_ID, 100),
      id = text(p.Draft_ID, 200);
    if (!id || !data.leads.some((l) => l.id === leadId))
      throw new ValidationError(
        "A Draft_ID and existing Lead_ID are required.",
      );
    const body = text(p.Body, 10000),
      subject = text(p.Subject, 250);
    if (body.length < 15 || !subject)
      throw new ValidationError("A subject and reply body are required.");
    const old = data.drafts.find((d) => d.id === id);
    if (data.syncChanges.some(c => c.entityId === `draft:${id}` && c.status !== "Applied"))
      throw new ValidationError("Apply the owner's draft changes before refreshing the automation draft.", 409);
    const draft: Draft = {
      id,
      leadId,
      body,
      subject,
      status: "Pending review",
      provider: text(p.Provider, 50) || "Gemini",
      reason: text(p.Review_Reason, 500),
      gmailDraftId: text(p.Gmail_Draft_ID, 200),
      createdAt: old?.createdAt || now,
      updatedAt: now,
    };
    if (old) {
      if (old.status !== "Pending review")
        throw new ValidationError(
          "A reviewed draft cannot be overwritten by an automation event.",
          409,
        );
      Object.assign(old, draft);
    } else data.drafts.unshift(draft);
  } else if (event === "followup.updated") {
    const l = data.leads.find((l) => l.id === p.Lead_ID);
    const states: FollowUpState[] = [
      "Pending",
      "Reserved",
      "Sent",
      "Skipped",
      "Needs Review",
    ];
    if (!l || !states.includes(p.Follow_Up_State as FollowUpState))
      throw new ValidationError(
        "An existing Lead_ID and valid Follow_Up_State are required.",
      );
    if (l.followUpExecutionId) {
      if (text(p.Execution_ID, 100) !== l.followUpExecutionId)
        throw new ValidationError("This execution does not own the follow-up reservation.", 409);
      if (!["Reserved", "Sent", "Needs Review"].includes(String(p.Follow_Up_State)))
        throw new ValidationError("A claimed follow-up requires a reservation or delivery result.", 409);
      if (l.followUpState !== "Reserved") {
        if (["Sent", "Needs Review"].includes(l.followUpState) && l.followUpState === p.Follow_Up_State)
          return ignore();
        throw new ValidationError("The follow-up reservation is no longer awaiting this result.", 409);
      }
      if (p.Follow_Up_State === "Sent" && !validDate(p.Follow_Up_Sent_UTC))
        throw new ValidationError("A confirmed follow-up requires its sent time.");
    }
    if (l.followUpState === "Sent" && p.Follow_Up_State !== "Sent") return ignore();
    l.followUpState = p.Follow_Up_State as FollowUpState;
    l.followUpSentAt = validDate(p.Follow_Up_Sent_UTC);
    l.updatedAt = now;
  } else if (event !== "automation.run")
    throw new ValidationError("Unsupported automation event type.");
  const status = text(p.Run_Status || p.Status, 20).toLowerCase();
  const runStatus = ["running", "success", "failed", "skipped"].includes(status)
    ? status as "running" | "success" | "failed" | "skipped"
    : undefined;
  data.activities.unshift({
    id: makeId(),
    type: "automation",
    title: text(p.Title, 200) || `n8n: ${event}`,
    detail: text(p.Detail, 1000),
    leadId: text(p.Lead_ID, 100) || undefined,
    createdAt: now,
    status: runStatus,
    executionId: text(p.Execution_ID, 100) || undefined,
    workflow: text(p.Workflow, 150) || undefined,
    stage: text(p.Stage, 100) || undefined,
  });
  data.activities = data.activities.slice(0, 3000);
  data.lastAutomationEventAt = now;
  data.processedEventIds = [...data.processedEventIds, eventId].slice(-2000);
  return { duplicate: false };
}
