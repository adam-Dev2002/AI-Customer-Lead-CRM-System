import type { CRMSnapshot, Lead } from "./types.ts";
import { leadStatuses, priorities } from "./types.ts";
import { ValidationError } from "./domain.ts";
import { followUpDue } from "./followup-email.ts";

export type LeadReport = ReturnType<typeof leadReport>;
export type ReportMeta = {
  id: string;
  createdAt: string;
  timezone: string;
  label: string;
  businessName: string;
  count: number;
  hasSamples: boolean;
  summary: { total: number; open: number; high: number; review: number; due: number; sent: number };
  filename: string;
};
export type PreparedReport = {
  report: ReportMeta & { chart: string };
  recipients: string[];
  senderEmail: string;
  canEmail: boolean;
  isOwner: boolean;
};

export function reportSummaryCards(summary: ReportMeta["summary"]) {
  return [
    { label: "Total leads", value: summary.total },
    { label: "Open inquiries", value: summary.open },
    { label: "High / urgent open", value: summary.high },
    { label: "Drafts to review", value: summary.review },
    { label: "Follow-ups due", value: summary.due },
    { label: "Confirmed replies sent", value: summary.sent },
  ];
}
export function leadReport(data: CRMSnapshot, ids: unknown, label: string, now = new Date()) {
  if (!Array.isArray(ids) || ids.length > 5000 || ids.some((id) => typeof id !== "string"))
    throw new ValidationError("Choose up to 5,000 leads for one report.");
  const selected = new Set<string>(ids);
  const leads = data.leads
    .filter((lead) => selected.has(lead.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (leads.length !== selected.size)
    throw new ValidationError(
      "Some selected leads changed or were removed. Refresh and try again.",
      409,
    );
  const timezone = data.settings.timezone;
  const date = (value: string, detailed = false) =>
    value && Number.isFinite(Date.parse(value))
      ? new Intl.DateTimeFormat("en-GB", {
          timeZone: timezone,
          dateStyle: "medium",
          ...(detailed ? { timeStyle: "short" as const } : {}),
        }).format(new Date(value))
      : "—";
  const dayFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dayKey = (value: Date) => dayFormatter.format(value);
  const dailyCounts = new Map<string, number>();
  for (const lead of leads) {
    if (!Number.isFinite(Date.parse(lead.createdAt))) continue;
    const key = dayKey(new Date(lead.createdAt));
    dailyCounts.set(key, (dailyCounts.get(key) || 0) + 1);
  }
  const statuses = leadStatuses.map((name, index) => ({
    name,
    count: leads.filter((lead) => lead.status === name).length,
    color: ["#375dfb", "#8b6bf4", "#aa8ef9", "#34b78f", "#16a36a", "#f26f83", "#a0a5b1"][index],
  }));
  const priority = priorities.map((name, index) => ({
    name,
    count: leads.filter((lead) => lead.priority === name).length,
    color: ["#16a36a", "#375dfb", "#f59e0b", "#e55770"][index],
  }));
  const trend = Array.from({ length: 30 }, (_, index) => {
    const day = new Date(now.getTime() - (29 - index) * 86400000);
    return {
      day: dayKey(day),
      label: new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        month: "short",
        day: "numeric",
      }).format(day),
      count: dailyCounts.get(dayKey(day)) || 0,
    };
  });
  const summary = {
    total: leads.length,
    open: leads.filter((lead) => ["New", "Pending", "Contacted", "Qualified"].includes(lead.status))
      .length,
    high: leads.filter(
      (lead) =>
        ["High", "Urgent"].includes(lead.priority) &&
        !["Won", "Lost", "Closed"].includes(lead.status),
    ).length,
    review: data.drafts.filter(
      (draft) => selected.has(draft.leadId) && draft.status === "Pending review",
    ).length,
    due: leads.filter((lead) => followUpDue(lead, now.getTime())).length,
    sent: data.mailJobs.filter((job) => selected.has(job.leadId) && job.status === "Sent").length,
  };
  const sourceNames = [...new Set(leads.map((lead) => lead.source))].sort();
  return {
    businessName: data.settings.businessName,
    logo: data.settings.businessLogo || "",
    timezone,
    createdAt: now.toISOString(),
    generated: date(now.toISOString(), true),
    label: label.replace(/[\r\n\u0000-\u001f]/g, " ").slice(0, 120) || "Selected leads",
    leads,
    summary,
    statuses,
    priority,
    trend,
    sources: sourceNames.map((name) => ({
      name,
      count: leads.filter((lead) => lead.source === name).length,
    })),
    date,
  };
}

export function excelLocalDate(value: string, timezone: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(value))
      .map((part) => [part.type, part.value]),
  );
  return new Date(
    Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    ),
  );
}
export const reportColumns: { name: string; key: keyof Lead; width: number; date?: boolean }[] = [
  { name: "Lead ID", key: "id", width: 30 },
  { name: "Customer", key: "name", width: 24 },
  { name: "Email", key: "email", width: 34 },
  { name: "Phone", key: "phone", width: 20 },
  { name: "Service / subject", key: "service", width: 40 },
  { name: "Status", key: "status", width: 18 },
  { name: "Priority", key: "priority", width: 14 },
  { name: "Category", key: "category", width: 22 },
  { name: "Source", key: "source", width: 20 },
  { name: "Owner", key: "owner", width: 22 },
  { name: "Created", key: "createdAt", width: 25, date: true },
  { name: "Updated", key: "updatedAt", width: 25, date: true },
  { name: "Follow-up permission", key: "consent", width: 22 },
  { name: "Follow-up state", key: "followUpState", width: 22 },
  { name: "Follow-up due", key: "followUpDue", width: 25, date: true },
  { name: "Summary", key: "summary", width: 60 },
  { name: "Original inquiry", key: "message", width: 70 },
  { name: "Internal notes", key: "notes", width: 60 },
  { name: "Sample record", key: "isSample", width: 18 },
];
