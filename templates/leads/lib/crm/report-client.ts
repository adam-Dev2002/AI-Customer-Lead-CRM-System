import type { PreparedReport } from "./report-model";
import type { ReportRecipientKind } from "./types";

export type ReportEmailConfirmation = {
  to: string;
  senderEmail: string;
  recipientKind: ReportRecipientKind;
  saveAsDefault: boolean;
};

async function postReport<T>(url: string, body: unknown, fallback: string): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.error || fallback);
  return result;
}

export function prepareLeadReport(leadIds: string[], label: string) {
  return postReport<PreparedReport>(
    "/api/crm/reports",
    { leadIds, label },
    "Could not create your report.",
  );
}

export function sendLeadReport(id: string, confirmation: ReportEmailConfirmation) {
  return postReport<{ jobId: string }>(
    `/api/crm/reports/${id}/email`,
    { ...confirmation, confirmed: true },
    "Could not queue your report. Check Outgoing emails before trying again.",
  );
}
