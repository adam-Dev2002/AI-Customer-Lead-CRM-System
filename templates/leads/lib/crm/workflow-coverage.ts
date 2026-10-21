import { inboxHref } from "./inbox-navigation.ts";

export const workflowCoverage = [
  { name: "Reports & owner email", page: "Dashboard / Leads", href: "/leads", detail: "Choose Report & email to download dashboard graphs and a lead table as PDF, or a formatted Excel workbook with full details. Owners can choose the connected sending address, business email or another delivery address, and save a default in Settings or when confirming the report. Reports include both attachments; follow confirmed delivery in Inbox → Outgoing emails. Changing the delivery address does not reconnect Gmail." },
  { name: "Form & email inquiries", page: "Leads / Inbox", href: "/inbox", detail: "Read customer requests and contact details. Search by customer or filter by where the inquiry came from." },
  { name: "Duplicate protection", page: "Leads / Activity", href: "/leads", detail: "Repeated submissions are checked so the same inquiry is not added twice. Activity explains when an inquiry is skipped." },
  { name: "Email checks", page: "Activity", href: "/activity", detail: "Automatic notifications and messages without readable text may be skipped. See the reason in plain language." },
  { name: "AI summaries & priority", page: "Inbox / Lead details", href: "/inbox", detail: "See what the customer needs, how urgent it is, and a short summary alongside the original message." },
  { name: "Suggested replies", page: "Inbox / AI replies", href: inboxHref("replies"), detail: "Open Inbox and switch to AI replies to edit, save, approve or reject suggested and manually written replies. Approval does not send an email." },
  { name: "Send a customer reply", page: "Inbox / AI replies / Outgoing emails", href: inboxHref("replies"), detail: "Confirm an approved reply in Inbox's AI replies tab to send it. Switch to Outgoing emails to follow its progress and review any delivery that needs attention." },
  { name: "Lead management", page: "Leads", href: "/leads", detail: "Add or import leads, assign owners, update their status, save notes and export your records." },
  { name: "Inquiry confirmations & owner alerts", page: "Settings / Lead details", href: "/settings", detail: "Choose whether form customers receive a receipt confirmation and whether the business owner receives an alert." },
  { name: "Permission-based follow-ups", page: "Follow-ups / Calendar", href: "/follow-ups", detail: "Preview, edit, schedule and approve one follow-up here. Sending requires the customer's permission and an eligible inquiry. Cancel or withdraw approval before sending begins." },
  { name: "Changes needing attention", page: "How it works", href: "/automation#sync", detail: "Review updates that could not finish and try them again. Retrying an update does not resend a customer email." },
  { name: "Business & reply preferences", page: "Settings", href: "/settings", detail: "Set business details, approved facts, reply style, signature, automatic email preferences and follow-up timing." },
  { name: "Tasks & reminders", page: "Tasks / Calendar", href: "/tasks", detail: "Create work items for yourself or your team, link them to a lead, and mark them complete." },
] as const;
