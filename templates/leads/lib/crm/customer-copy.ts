import type { Activity, SyncChange } from "./types";

// Preserve diagnostics in storage; customer screens describe the outcome.
export function updateFailureCopy(detail: string): string {
  if (/could not read.*gmail draft|draft.*(?:not found|deleted)|(?:gmail|draft).*\b404\b|\b404\b.*(?:gmail|draft)/i.test(detail))
    return "The saved email draft could not be found. It may have been deleted or moved. Open the reply to review it.";
  if (/unauthori[sz]ed|authentication|credential|\b401\b|\b403\b/i.test(detail))
    return "A service connection needs attention. Contact support so we can restore it.";
  if (/\b429\b|rate limit|quota/i.test(detail))
    return "The service is busy or has reached its usage limit. Try again later.";
  return "This change could not be completed. Review the update or contact support if it keeps happening.";
}

export function syncChangeCopy(change: SyncChange) {
  return {
    title: change.kind === "draft.review" ? "Reply review" : change.kind === "lead.archive" ? "Lead removed" : "Customer details",
    detail: change.status === "Failed"
      ? updateFailureCopy(change.detail)
      : change.status === "Pending"
        ? "Your change is saved and waiting to finish updating."
        : change.kind === "draft.review"
          ? "Your reply review was saved. Approval alone does not send an email."
          : "Your changes were saved to the shared records.",
  };
}

export function activityCopy(activity: Activity): { title: string; detail: string } {
  const { title, detail } = activity;
  if (title === "Email screened out") {
    const reasons: string[] = [];
    try {
      const flags = JSON.parse(detail);
      if (flags && typeof flags === "object" && !Array.isArray(flags)) {
        if (flags.sender_found === false) reasons.push("The sender's email address could not be identified.");
        if (flags.body_found === false) reasons.push("No readable message text was found.");
        if (flags.blocked_sender === true) reasons.push("The sender is excluded from customer inquiries.");
        if (flags.automated_email === true) reasons.push("This appears to be an automatic notification.");
        if (flags.marked_as_sent === true) reasons.push("This is an outgoing message rather than an incoming inquiry.");
      }
    } catch { /* Older entries may not contain structured details. */ }
    return {
      title: "Email skipped",
      detail: (reasons.join(" ") || "This message did not qualify for automatic processing.") + " No reply draft was created.",
    };
  }
  if (/^n8n update /i.test(title)) {
    const failed = activity.status === "failed" || /failed$/i.test(title);
    return { title: failed ? "Changes need attention" : "Changes saved", detail: failed ? updateFailureCopy(detail) : "Customer details or reply changes were updated in the shared records." };
  }
  if (title === "Email support processed")
    return activity.status === "skipped"
      ? { title: "Email checked", detail: "No automatic reply was prepared. Open the inquiry to write a reply if needed." }
      : { title: "Customer inquiry received", detail: "The inquiry and its suggested reply are ready to review." };
  if (title === "Business settings saved")
    return { title, detail: "Your business preferences were saved." };
  if (title === "Automation execution failed")
    return { title: "An automatic task needs attention", detail: updateFailureCopy(detail) };
  if (title === "Form inquiry not captured")
    return { title: "Form inquiry not added", detail: /duplicat/i.test(detail) ? "A matching inquiry was received recently, so a second lead was not added." : "The form could not be added. Check that the required customer details are complete." };
  if (title === "Follow-up reserved")
    return { title: "Follow-up being prepared", detail: "This follow-up is being handled. Wait for its delivery result before trying again." };
  const safeTitle = /^n8n:/i.test(title) ? "Automatic task update" : title;
  if (detail === "Saved in the local workspace.") return { title: safeTitle, detail: "Your changes were saved." };
  if (detail === "Local review only; no email was sent.") return { title: safeTitle, detail: "Your review was saved. No email was sent." };
  if (/could not read.*gmail draft|\b(?:HTTP|OAuth|credential|endpoint|execution|Lead_ID|Draft_ID|ReplyReviews|n8n)\b|^[\s]*[\[{]/i.test(detail))
    return { title: safeTitle, detail: activity.status === "failed" ? updateFailureCopy(detail) : activity.status === "skipped" ? "This automatic task was skipped. No action is needed unless you expected a reply." : activity.status === "running" ? "This task is in progress." : activity.status === "success" ? "The automatic task was completed." : "The automation reported an update." };
  return { title: safeTitle, detail };
}

export const activityStatusLabels = {
  running: "In progress",
  success: "Completed",
  failed: "Needs attention",
  skipped: "Skipped",
} as const;
