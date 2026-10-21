import type { CRMData, Draft, Lead, Mutation, SyncChange } from "./types";

export function sheetRow(lead: Lead): Record<string, unknown> {
  return {
    Lead_ID: lead.id, Created_At_UTC: lead.createdAt, Name: lead.name,
    Email: lead.email, Phone: lead.phone, Service: lead.service,
    Message: lead.message, Source: lead.source, Consent: lead.consent ? "Yes" : "No",
    Status: lead.status, Priority: lead.priority, Owner: lead.owner,
    Notes: lead.notes, Category: lead.category, AI_Summary: lead.summary,
    Follow_Up_Due_UTC: lead.followUpDue, Follow_Up_State: lead.followUpState,
    Follow_Up_Sent_UTC: lead.followUpSentAt,
    Acknowledgement_Status: lead.acknowledgementStatus,
    Owner_Alert_Status: lead.ownerAlertStatus, Gmail_Thread_ID: lead.gmailThreadId || "",
  };
}

export function queueLeadChange(data: CRMData, lead: Lead, now: string, makeId: () => string, archive = false, fields?: string[], intent = "lead.create") {
  if (lead.isSample) return;
  const row = sheetRow(lead);
  if (archive) Object.assign(row, { Status: "Closed", Consent: "No", Follow_Up_State: lead.followUpState === "Sent" ? "Sent" : "Skipped" });
  data.syncChanges.push({
    id: makeId(), kind: archive ? "lead.archive" : "lead.upsert",
    entityId: `lead:${lead.id}`, leadId: lead.id,
    label: `${archive ? "Archive" : "Update"} ${lead.name}`,
    payload: row, fields: archive ? ["Status", "Consent", "Follow_Up_State"] : fields || Object.keys(row), intent: archive ? "lead.delete" : intent,
    status: "Pending", detail: "", createdAt: now, updatedAt: now,
  });
}

export function queueDraftReview(data: CRMData, draft: Draft, lead: Lead, now: string, makeId: () => string, intent: string) {
  if (lead.isSample) return;
  data.syncChanges.push({
    id: makeId(), kind: "draft.review", entityId: `draft:${draft.id}`,
    leadId: lead.id, label: `${draft.status}: reply to ${lead.name}`,
    payload: { Draft_ID: draft.id, Lead_ID: lead.id, Gmail_Draft_ID: draft.gmailDraftId || "", Gmail_Thread_ID: lead.gmailThreadId || "", Email: lead.email, Subject: draft.subject, Body: draft.body, Review_Status: draft.status },
    fields: [], intent, status: "Pending", detail: "", createdAt: now, updatedAt: now,
  });
}

// Initial email indexing writes Sheets without modifying the existing Gmail draft.
export function queueEmailMirrors(data: CRMData, lead: Lead, draft: Draft | undefined, now: string, makeId: () => string) {
  if (lead.isSample) return;
  if (!data.syncChanges.some(change => change.entityId === `lead:${lead.id}`))
    queueLeadChange(data, lead, now, makeId, false, undefined, "mirror.capture");
  if (draft && !data.syncChanges.some(change => change.entityId === `draft:${draft.id}`))
    queueDraftReview(data, draft, lead, now, makeId, "mirror.capture");
}

export function queueOwnerChanges(data: CRMData, mutation: Mutation, now: string, makeId: () => string) {
  const p = mutation.payload || {};
  if (mutation.action === "lead.create") queueLeadChange(data, data.leads[0], now, makeId);
  if (["lead.update", "followup.cancel", "followup.reschedule", "followup.permission", "followup.resolve"].includes(mutation.action)) {
    const lead = data.leads.find(l => l.id === p.id);
    if (lead) {
      const mapping: Record<string, string> = { name: "Name", email: "Email", phone: "Phone", service: "Service", message: "Message", status: "Status", priority: "Priority", owner: "Owner", notes: "Notes", consent: "Consent", category: "Category" };
      const fields = mutation.action === "followup.reschedule" ? ["Follow_Up_Due_UTC", "Follow_Up_State"] : ["followup.cancel", "followup.resolve"].includes(mutation.action) ? ["Follow_Up_State"] : mutation.action === "followup.permission" ? ["Consent", "Follow_Up_State"] : Object.keys(p).flatMap(key => mapping[key] ? [mapping[key]] : []);
      if (p.status !== undefined || p.consent !== undefined) fields.push("Follow_Up_State");
      queueLeadChange(data, lead, now, makeId, false, [...new Set(fields)], mutation.action);
    }
  }
  if (mutation.action === "leads.import" && Array.isArray(p.rows)) {
    for (const lead of data.leads.slice(0, p.rows.length)) queueLeadChange(data, lead, now, makeId);
  }
  if (["draft.create", "draft.save", "draft.approve", "draft.reject"].includes(mutation.action)) {
    const draft = mutation.action === "draft.create" ? data.drafts[0] : data.drafts.find(d => d.id === p.id);
    const lead = draft && data.leads.find(l => l.id === draft.leadId);
    if (!draft || !lead || lead.isSample) return;
    queueDraftReview(data, draft, lead, now, makeId, mutation.action);
  }
  // Retain every outstanding write. Only completed history can be pruned.
  const completed = data.syncChanges.filter(c => c.status === "Applied").slice(-500);
  data.syncChanges = [...completed, ...data.syncChanges.filter(c => c.status !== "Applied")];
}

export function pendingSyncChanges(data: CRMData): SyncChange[] {
  // One write per entity at a time. A failed write blocks newer writes until retried.
  const seen = new Set<string>();
  return data.syncChanges.filter(change => {
    if (change.status === "Applied" || seen.has(change.entityId)) return false;
    seen.add(change.entityId);
    return change.status === "Pending";
  }).slice(0, 100);
}

export function workflowConfiguration(data: CRMData) {
  const s = data.settings;
  return {
    business_name: s.businessName, default_owner: s.ownerName, owner_email: s.ownerEmail,
    business_facts: s.businessFacts, reply_tone: s.replyTone,
    signature: s.replySignature || s.businessName,
    primary_ai: s.primaryAI, gemini_model: s.geminiModel, openai_model: s.openaiModel,
    gmail_query: s.gmailQuery, max_emails_per_scan: s.maxEmailsPerScan,
    contact_phone: s.phone, website_url: s.website, timezone: s.timezone,
    send_emails_enabled: s.automaticEmailsEnabled,
    send_customer_ack: s.customerAcknowledgements,
    send_customer_follow_up: s.customerFollowUps,
    send_owner_alert: s.ownerNotifications,
    follow_up_hours: s.followUpHours, max_followups_per_scan: s.maxFollowUpsPerScan,
    lead_ai_enabled: s.aiClassification, lead_ai_model: s.geminiModel,
    response_promise: s.responsePromise,
  };
}
