import type { CRMData, MailJob } from "./types.ts";
import type { ReportMeta } from "./report-model.ts";
import { ValidationError } from "./domain.ts";
import { isEmailAddress, normalizeEmail } from "./email-address.ts";
import {
  isReportRecipientKind,
  readReportEmailPreferences,
  resolveReportRecipient,
} from "./email-preferences.ts";

export const reportCapability = "lead-reports-v1";

export type ReportDeliveryInput = {
  id: string;
  confirmed: unknown;
  to: string;
  senderEmail: string;
  recipientKind?: unknown;
  saveAsDefault?: unknown;
};

export function reportRecipients(data: CRMData): string[] {
  return [
    ...new Set(
      [data.mailSenderEmail, data.settings.ownerEmail, data.settings.reportEmailAddress]
        .map(normalizeEmail)
        .filter(isEmailAddress),
    ),
  ];
}

function confirmedRecipient(data: CRMData, input: ReportDeliveryInput) {
  const to = normalizeEmail(input.to);
  if (!isEmailAddress(to)) throw new ValidationError("Enter one valid report email address.");
  const kind =
    input.recipientKind ??
    (to === normalizeEmail(data.mailSenderEmail)
      ? "sender"
      : to === normalizeEmail(data.settings.ownerEmail)
        ? "business"
        : to === normalizeEmail(data.settings.reportEmailAddress)
          ? "custom"
          : undefined);
  if (!isReportRecipientKind(kind)) {
    throw new ValidationError("Choose a report recipient and review its email address.", 409);
  }
  const expected = resolveReportRecipient(data.settings, data.mailSenderEmail, {
    kind,
    address: to,
  });
  if (expected !== to) {
    throw new ValidationError(
      "The sending or business email changed. Review the recipient again.",
      409,
    );
  }
  return { to, kind };
}

export function currentReportRecipient(data: CRMData, job: MailJob): boolean {
  if (!job.reportRecipientKind) return reportRecipients(data).includes(job.to);
  if (!isReportRecipientKind(job.reportRecipientKind) || !isEmailAddress(job.to)) return false;
  // Custom recipients stay exactly as confirmed when a future default changes.
  return (
    resolveReportRecipient(data.settings, data.mailSenderEmail, {
      kind: job.reportRecipientKind,
      address: job.to,
    }) === job.to
  );
}

function reportEmailBody(report: ReportMeta): string {
  return [
    `${report.businessName} — Leads report`,
    "",
    `${report.count} selected leads`,
    `${report.summary.open} open inquiries`,
    `${report.summary.high} high or urgent open inquiries`,
    `${report.summary.review} drafts awaiting review`,
    `${report.summary.due} follow-ups due`,
    `${report.summary.sent} confirmed customer replies sent`,
    "",
    `Scope: ${report.label}`,
    `Snapshot: ${report.createdAt}`,
    "",
    "Attached: dashboard report (PDF) and formatted Excel workbook.",
    "The email also includes charts and a condensed lead table.",
  ].join("\n");
}

export function queueReportDelivery(
  data: CRMData,
  report: ReportMeta,
  input: ReportDeliveryInput & { digest: string },
  now: string,
): MailJob {
  if (input.confirmed !== true) {
    throw new ValidationError("Review the report and confirm its recipient before sending.");
  }
  if (!data.lastMailPollAt || !data.mailSenderCapabilities?.includes(reportCapability)) {
    throw new ValidationError(
      "Report emailing is not available yet. You can download both files.",
      409,
    );
  }
  if (report.hasSamples)
    throw new ValidationError("Sample records cannot be emailed. Select your own saved leads.");
  if (!report.count) throw new ValidationError("Choose at least one lead to email.");
  if (input.senderEmail !== data.mailSenderEmail) {
    throw new ValidationError("The sending account changed. Review the report again.", 409);
  }
  if (data.mailJobs.some((job) => job.reportId === report.id && job.status !== "Cancelled")) {
    throw new ValidationError(
      "This report already has a send request. Check its delivery in Inbox.",
      409,
    );
  }
  const { to, kind } = confirmedRecipient(data, input);
  const job: MailJob = {
    id: input.id,
    kind: "lead-report",
    reportId: report.id,
    reportDigest: input.digest,
    reportRecipientKind: kind,
    draftId: "",
    leadId: "",
    to,
    senderEmail: data.mailSenderEmail,
    subject:
      `${report.businessName.replace(/[\r\n]/g, " ")} — Leads report — ${report.createdAt.slice(0, 10)}`.slice(
        0,
        250,
      ),
    body: reportEmailBody(report),
    gmailDraftId: "",
    gmailThreadId: "",
    status: "Queued",
    detail: "Owner confirmed the report and recipient. Waiting for the sending service.",
    executionId: "",
    createdAt: now,
    updatedAt: now,
    sentAt: "",
    gmailMessageId: "",
  };
  if (input.saveAsDefault === true) {
    const preferences = readReportEmailPreferences(data.settings, {
      reportEmailRecipient: kind,
      reportEmailAddress: kind === "custom" ? to : data.settings.reportEmailAddress,
    });
    if (!preferences.ok) throw new ValidationError(preferences.error);
    Object.assign(data.settings, preferences.value);
  }
  data.mailJobs.unshift(job);
  data.activities.unshift({
    id: input.id + "-queued",
    type: "settings",
    title: "Leads report queued",
    detail: `${report.count} leads · ${to}`,
    createdAt: now,
  });
  data.activities = data.activities.slice(0, 3000);
  return job;
}

type ReportMimeInput = {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  html: string;
  pdf: Buffer;
  xlsx: Buffer;
  chart: Buffer;
  filename: string;
  createdAt: string;
};

const base64Lines = (data: Buffer | string) =>
  Buffer.from(data)
    .toString("base64")
    .match(/.{1,76}/g)
    ?.join("\r\n") || "";

function mimeSubject(subject: string): string {
  const words: string[] = [];
  for (const char of subject) {
    const last = words.length - 1;
    if (last < 0 || Buffer.byteLength(words[last] + char, "utf8") > 42) words.push(char);
    else words[last] += char;
  }
  return words.map((word) => `=?UTF-8?B?${Buffer.from(word).toString("base64")}?=`).join("\r\n ");
}

export function reportMime(input: ReportMimeInput): string {
  if (![input.from, input.to].every(isEmailAddress)) {
    throw new ValidationError("Choose a valid report email address.");
  }
  const mixed = "mixed_" + input.id;
  const related = "related_" + input.id;
  const alternative = "alternative_" + input.id;
  const lines = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${mimeSubject(input.subject)}`,
    `Date: ${new Date(input.createdAt).toUTCString()}`,
    `Message-ID: <customerlead.${input.id}@customerlead.local>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    "",
    `--${mixed}`,
    `Content-Type: multipart/related; boundary="${related}"`,
    "",
    `--${related}`,
    `Content-Type: multipart/alternative; boundary="${alternative}"`,
    "",
  ];
  for (const [type, content] of [
    ["plain", input.body],
    ["html", input.html],
  ]) {
    lines.push(
      `--${alternative}`,
      `Content-Type: text/${type}; charset=UTF-8`,
      "Content-Transfer-Encoding: base64",
      "",
      base64Lines(content),
    );
  }
  lines.push(
    `--${alternative}--`,
    `--${related}`,
    "Content-Type: image/png",
    "Content-ID: <report-chart>",
    'Content-Disposition: inline; filename="charts.png"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(input.chart),
    `--${related}--`,
  );
  const attachments = [
    ["pdf", "application/pdf", input.pdf],
    ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", input.xlsx],
  ] as const;
  for (const [extension, type, data] of attachments) {
    lines.push(
      `--${mixed}`,
      `Content-Type: ${type}`,
      `Content-Disposition: attachment; filename="${input.filename}.${extension}"`,
      "Content-Transfer-Encoding: base64",
      "",
      base64Lines(data),
    );
  }
  lines.push(`--${mixed}--`, "");
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}
