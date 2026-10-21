import type { CRMData } from "./types";
import { ValidationError, eligibleForFollowUp, isEmail, text, validDate } from "./domain.ts";
import { followUpApproved, followUpCapability } from "./followup-email.ts";

// Call within storage's serialized transaction. A reservation is never leased or
// reclaimed automatically: an interrupted Gmail send may already have succeeded.
export function claimFollowUp(data: CRMData, input: Record<string, unknown>, now: string) {
  const leadId = text(input.leadId, 100), executionId = text(input.executionId, 100);
  const email = text(input.email, 150).toLowerCase(), followUpDue = validDate(input.followUpDue);
  if (input.action !== "claim") throw new ValidationError("Provide the claim action.");
  if (!leadId || !executionId || !isEmail(email) || !followUpDue)
    throw new ValidationError("A lead, email, follow-up due time and execution ID are required.");
  const response = (claimed: boolean, reason: string) => ({ claimed, reason, leadId, email, followUpDue, executionId });
  const lead = data.leads.find(l => l.id === leadId);
  if (!lead || data.archivedLeadIds.includes(leadId)) return response(false, "not_found");
  if (!data.settings.automaticEmailsEnabled || !data.settings.customerFollowUps)
    return response(false, "automation_disabled");
  if (lead.followUpState === "Reserved") return response(false, "already_reserved");
  if (lead.isSample || !eligibleForFollowUp(lead, Date.parse(now))) return response(false, "ineligible");
  if (lead.email.toLowerCase() !== email || validDate(lead.followUpDue) !== followUpDue)
    return response(false, "changed");
  if (!followUpApproved(lead)) return response(false, "approval_required");
  // Older workflows use their own hardcoded email. They must never claim an
  // approved edit until they consume this exact reserved content instead.
  if (!Array.isArray(input.capabilities) || !input.capabilities.includes(followUpCapability))
    return response(false, "sender_update_required");
  if (data.syncChanges.some(c => c.leadId === leadId && c.status !== "Applied"))
    return response(false, "sync_pending");
  if (data.mailJobs.some(j => j.leadId === leadId && ["Queued", "Sending", "Needs Review"].includes(j.status)))
    return response(false, "manual_reply_pending");
  lead.followUpState = "Reserved";
  lead.followUpExecutionId = executionId;
  lead.followUpClaimedAt = now;
  lead.updatedAt = now;
  return { ...response(true, "claimed"), subject: lead.followUpEmail!.subject, body: lead.followUpEmail!.body, revision: lead.followUpEmail!.revision };
}
