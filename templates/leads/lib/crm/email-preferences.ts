import { reportRecipientKinds, type Settings, type ReportRecipientKind } from "./types.ts";
import { isEmailAddress, normalizeEmail } from "./email-address.ts";

type EmailSettings = Pick<Settings, "ownerEmail" | "reportEmailRecipient" | "reportEmailAddress">;
export type ReportRecipientSelection = { kind: ReportRecipientKind; address: string };

export function isReportRecipientKind(value: unknown): value is ReportRecipientKind {
  return reportRecipientKinds.some((kind) => kind === value);
}

type PreferenceResult =
  | { ok: true; value: { reportEmailRecipient: ReportRecipientKind; reportEmailAddress: string } }
  | { ok: false; error: string };

export function readReportEmailPreferences(
  settings: EmailSettings,
  input: { reportEmailRecipient?: unknown; reportEmailAddress?: unknown },
): PreferenceResult {
  const kind = input.reportEmailRecipient ?? settings.reportEmailRecipient ?? "sender";
  const address = normalizeEmail(input.reportEmailAddress ?? settings.reportEmailAddress);
  if (!isReportRecipientKind(kind))
    return { ok: false, error: "Choose a default report recipient." };
  if (kind === "custom" && !isEmailAddress(address)) {
    return { ok: false, error: "Enter a valid custom report email." };
  }
  if (kind === "business" && !isEmailAddress(normalizeEmail(settings.ownerEmail))) {
    return { ok: false, error: "Add an owner email to use it for reports." };
  }
  return {
    ok: true,
    value: {
      reportEmailRecipient: kind,
      reportEmailAddress: isEmailAddress(address) ? address : "",
    },
  };
}

export function defaultReportRecipient(settings: EmailSettings): ReportRecipientSelection {
  return {
    kind: settings.reportEmailRecipient ?? "sender",
    address: settings.reportEmailAddress ?? "",
  };
}

export function reportRecipientOptions(settings: EmailSettings, senderEmail: string) {
  return [
    { kind: "sender", label: "Connected sending account", email: normalizeEmail(senderEmail) },
    { kind: "business", label: "Business email", email: normalizeEmail(settings.ownerEmail) },
    { kind: "custom", label: "Another email address", email: "" },
  ] as const;
}

export function resolveReportRecipient(
  settings: EmailSettings,
  senderEmail: string,
  selection: ReportRecipientSelection,
): string {
  const option = reportRecipientOptions(settings, senderEmail).find(
    (item) => item.kind === selection.kind,
  );
  return normalizeEmail(selection.kind === "custom" ? selection.address : option?.email);
}
