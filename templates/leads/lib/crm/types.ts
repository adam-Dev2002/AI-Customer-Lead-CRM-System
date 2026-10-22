export const leadStatuses = [
  "New",
  "Pending",
  "Contacted",
  "Qualified",
  "Won",
  "Lost",
  "Closed",
] as const;
export const priorities = ["Low", "Normal", "High", "Urgent"] as const;
export type LeadStatus = (typeof leadStatuses)[number];
export type Priority = (typeof priorities)[number];
export const reportRecipientKinds = ["sender", "business", "custom"] as const;
export type ReportRecipientKind = (typeof reportRecipientKinds)[number];
export type FollowUpState =
  | "Pending"
  | "Reserved"
  | "Sent"
  | "Skipped"
  | "Needs Review";
export interface FollowUpEmail {
  subject: string;
  body: string;
  revision: number;
  updatedAt: string;
  approvedAt: string;
  approvedTo: string;
  approvedDue: string;
}
export interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string;
  service: string;
  message: string;
  source: string;
  status: LeadStatus;
  priority: Priority;
  category: string;
  summary: string;
  owner: string;
  notes: string;
  consent: boolean;
  createdAt: string;
  updatedAt: string;
  followUpDue: string;
  followUpState: FollowUpState;
  followUpSentAt: string;
  // Durable ownership for follow-ups reserved through the authenticated claim API.
  followUpExecutionId?: string;
  followUpClaimedAt?: string;
  followUpEmail?: FollowUpEmail;
  acknowledgementStatus: string;
  ownerAlertStatus: string;
  gmailThreadId?: string;
  photoUrl?: string;
  isSample: boolean;
}
export interface Draft {
  id: string;
  leadId: string;
  subject: string;
  body: string;
  status: "Pending review" | "Approved" | "Rejected";
  provider: string;
  reason: string;
  createdAt: string;
  updatedAt: string;
  gmailDraftId?: string;
}
export interface Task {
  id: string;
  title: string;
  leadId: string;
  dueAt: string;
  completed: boolean;
  createdAt: string;
}
export interface MailJob {
  id: string;
  kind?: "lead-report";
  reportId?: string;
  reportDigest?: string;
  reportRecipientKind?: ReportRecipientKind;
  draftId: string;
  leadId: string;
  to: string;
  subject: string;
  body: string;
  gmailDraftId: string;
  gmailThreadId: string;
  senderEmail: string;
  status: "Queued" | "Sending" | "Sent" | "Needs Review" | "Cancelled";
  detail: string;
  executionId: string;
  createdAt: string;
  updatedAt: string;
  sentAt: string;
  gmailMessageId: string;
}
export interface Activity {
  id: string;
  type: "lead" | "draft" | "followup" | "task" | "settings" | "automation";
  title: string;
  detail: string;
  leadId?: string;
  createdAt: string;
  status?: "running" | "success" | "failed" | "skipped";
  executionId?: string;
  stage?: string;
  workflow?: string;
}
export interface Settings {
  brandPreset?: "clearflow" | "generic";
  businessName: string;
  businessLogo?: string;
  ownerName: string;
  ownerEmail: string;
  reportEmailRecipient?: ReportRecipientKind;
  reportEmailAddress?: string;
  phone: string;
  website: string;
  timezone: string;
  businessFacts: string;
  replyTone: string;
  followUpHours: number;
  customerAcknowledgements: boolean;
  customerFollowUps: boolean;
  aiClassification: boolean;
  ownerNotifications: boolean;
  automaticEmailsEnabled: boolean;
  primaryAI: "gemini" | "openai";
  geminiModel: string;
  openaiModel: string;
  gmailQuery: string;
  maxEmailsPerScan: number;
  maxFollowUpsPerScan: number;
  responsePromise: string;
  replySignature: string;
}
export interface SyncChange {
  id: string;
  kind: "lead.upsert" | "lead.archive" | "draft.review";
  entityId: string;
  leadId: string;
  label: string;
  payload: Record<string, unknown>;
  fields: string[];
  intent: string;
  status: "Pending" | "Applied" | "Failed";
  detail: string;
  createdAt: string;
  updatedAt: string;
}
export interface CRMData {
  version: 1;
  emailMirrorVersion?: number;
  leads: Lead[];
  drafts: Draft[];
  tasks: Task[];
  activities: Activity[];
  settings: Settings;
  notificationsReadAt: string;
  processedEventIds: string[];
  lastAutomationEventAt: string;
  syncChanges: SyncChange[];
  archivedLeadIds: string[];
  lastSyncPollAt: string;
  lastConfigReadAt: string;
  mailJobs: MailJob[];
  lastMailPollAt: string;
  mailSenderEmail: string;
  mailSenderCapabilities?: string[];
}
export interface CRMSnapshot extends CRMData {
  connection: {
    mode: "local" | "supabase";
    webhookReady: boolean;
    lastEventAt: string;
    lastPollAt: string;
    lastConfigReadAt: string;
    pendingChanges: number;
    failedChanges: number;
    lastMailPollAt: string;
    mailSenderEmail: string;
  };
}
export interface Mutation {
  action: string;
  payload?: Record<string, unknown>;
}
