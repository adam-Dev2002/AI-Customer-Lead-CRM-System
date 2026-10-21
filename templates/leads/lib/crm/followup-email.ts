import type { Lead, Settings } from "./types";

export const followUpCapability = "approved-followups-v1";

// The preview is a suggestion until explicitly saved. Existing deliveries never
// acquire an invented historical email body through this fallback.
export function followUpPreview(lead: Lead, settings: Settings) {
  if (lead.followUpEmail) return lead.followUpEmail;
  return {
    subject: `Following up on your inquiry — ${settings.businessName}`,
    body: `Hi ${lead.name},\n\nWe are following up on your recent question about ${lead.service}. If you still need help, please reply to this email.\n\nIf your inquiry has already been handled, no action is needed. We will not send another automatic follow-up for this inquiry.\n\nReference: ${lead.id}\n\n${settings.replySignature || settings.businessName}`,
    revision: 0, updatedAt: "", approvedAt: "", approvedTo: "", approvedDue: "",
  };
}

export function followUpApproved(lead: Lead) {
  const email = lead.followUpEmail;
  return !!email?.approvedAt && email.approvedTo === lead.email &&
    email.approvedDue === lead.followUpDue && !!email.subject.trim() && email.body.trim().length >= 15;
}

// Due is a schedule fact, separate from permission, approval and delivery gates.
export function followUpDue(lead: Lead, now = Date.now()) {
  return lead.followUpState === "Pending" && !!lead.followUpDue && Date.parse(lead.followUpDue) <= now;
}

export function matchesFollowUp(lead: Lead, state: string, now = Date.now()) {
  if (state === "all") return true;
  if (state === "due") return followUpDue(lead, now);
  if (state === "review") return lead.followUpState === "Pending" && !followUpApproved(lead);
  if (state === "attention") return ["Reserved", "Needs Review"].includes(lead.followUpState);
  return lead.followUpState === state;
}

export function followUpBlocker(lead: Lead, settings: Settings) {
  if (lead.followUpState === "Sent") return "This follow-up was sent. Only one follow-up is allowed per inquiry.";
  if (lead.followUpState === "Reserved") return "This email is being prepared or sent. Wait for its delivery result.";
  if (lead.followUpState === "Needs Review") return "Delivery is uncertain. Check the sending account before taking another action.";
  if (!lead.consent) return "Customer permission has not been recorded. No follow-up can send.";
  if (!["New", "Pending"].includes(lead.status)) return "This inquiry is no longer New or Pending. No follow-up can send.";
  if (lead.followUpState !== "Pending" || !lead.followUpDue) return "No follow-up is scheduled. Choose a time here.";
  if (!followUpApproved(lead)) return "Save and approve the follow-up email before it can send.";
  if (lead.isSample) return "Sample inquiries cannot send email.";
  if (!settings.automaticEmailsEnabled || !settings.customerFollowUps) return "Follow-up sending is paused in your business preferences.";
  return "Approved for the scheduled check. Sending waits for the due time and saved changes; approval does not mean delivery.";
}
