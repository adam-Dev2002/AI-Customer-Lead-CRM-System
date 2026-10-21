import type { CRMData, Lead, Settings } from "./types";

export const defaultSettings: Settings = {
  businessName: "5S Plumbing",
  ownerName: "Business Owner",
  ownerEmail: "",
  reportEmailRecipient: "sender",
  reportEmailAddress: "",
  phone: "",
  website: "",
  timezone: "Asia/Singapore",
  businessFacts:
    "Add verified service areas, opening hours, prices, and policies here. AI replies should only use information you have approved.",
  replyTone:
    "Warm, professional, and concise. Ask for missing information; do not promise availability or quote unverified prices.",
  followUpHours: 24,
  customerAcknowledgements: true,
  customerFollowUps: true,
  aiClassification: true,
  ownerNotifications: true,
  automaticEmailsEnabled: false,
  primaryAI: "gemini",
  geminiModel: "",
  openaiModel: "",
  gmailQuery: "in:inbox -from:me -label:AI-SUPPORT-PROCESSING -label:AI-SUPPORT-DRAFTED -label:AI-SUPPORT-REVIEW -label:AI-SUPPORT-SKIPPED",
  maxEmailsPerScan: 10,
  maxFollowUpsPerScan: 10,
  responsePromise: "within one business day",
  replySignature: "",
};
export function createSeed(now = new Date()): CRMData {
  const at = (hours: number) =>
    new Date(now.getTime() + hours * 3600000).toISOString();
  const rows = [
    [
      "Olivia Chen",
      "Kitchen sink leak",
      "Hello, my kitchen sink is leaking. Can someone fix it tomorrow?",
      "New",
      "High",
      "Booking",
    ],
    [
      "James Wilson",
      "Bathroom renovation",
      "Could you provide a quote for new bathroom plumbing?",
      "Pending",
      "Normal",
      "Quote",
    ],
    [
      "Emma Davis",
      "Blocked drain",
      "Our shower drain is blocked. Do you cover our area?",
      "New",
      "High",
      "Booking",
    ],
    [
      "Liam Tan",
      "Water heater repair",
      "My water heater keeps switching off. What information do you need?",
      "Contacted",
      "Normal",
      "General",
    ],
    [
      "Sophia Lim",
      "Pipe replacement",
      "We need a quote to replace the old pipes in our kitchen.",
      "Qualified",
      "Normal",
      "Quote",
    ],
    [
      "Noah Lee",
      "Emergency leak",
      "A pipe under our bathroom basin has burst. Please call me.",
      "New",
      "Urgent",
      "Booking",
    ],
    [
      "Ava Thompson",
      "Tap installation",
      "I have bought a new mixer tap. Can you install it?",
      "Won",
      "Low",
      "Booking",
    ],
    [
      "Ethan Wong",
      "Low water pressure",
      "The water pressure in our upstairs bathroom is very low.",
      "Pending",
      "Normal",
      "General",
    ],
    [
      "Isabella Martin",
      "Toilet repair",
      "Our toilet keeps running after flushing. Could we arrange an inspection?",
      "Closed",
      "Normal",
      "Booking",
    ],
    [
      "Lucas Ng",
      "Commercial maintenance",
      "We manage a small office. Do you offer regular plumbing maintenance?",
      "Qualified",
      "Low",
      "Sales",
    ],
    [
      "Mia Taylor",
      "Drain inspection",
      "Could you explain how a drain inspection works?",
      "Lost",
      "Low",
      "General",
    ],
    [
      "Benjamin Koh",
      "Leak detection",
      "There is a damp patch on our kitchen ceiling. We need help finding the cause.",
      "New",
      "High",
      "Booking",
    ],
    [
      "Amelia Brown",
      "Washing machine connection",
      "I need a plumber to connect a new washing machine.",
      "Contacted",
      "Normal",
      "Booking",
    ],
    [
      "Henry Goh",
      "Outdoor tap",
      "Can you quote for adding an outdoor garden tap?",
      "Pending",
      "Normal",
      "Quote",
    ],
    [
      "Charlotte Teo",
      "Bathroom basin",
      "I would like to replace a bathroom basin and tap.",
      "Won",
      "Normal",
      "Quote",
    ],
    [
      "Alexander Wood",
      "Kitchen plumbing",
      "We are planning a kitchen renovation and need advice on the plumbing.",
      "Closed",
      "Low",
      "General",
    ],
  ];
  const leads: Lead[] = rows.map((r, i) => {
    const created = at(-i * 29 - 2),
      consent = i !== 2 && i !== 10;
    const followUpState =
      i === 7
        ? "Needs Review"
        : i === 13
          ? "Reserved"
          : i === 3
            ? "Sent"
            : consent && ["New", "Pending"].includes(r[3])
              ? "Pending"
              : "Skipped";
    return {
      id: `LEAD-2026-${String(i + 1).padStart(3, "0")}`,
      name: r[0],
      email: `${r[0].toLowerCase().replace(/ /g, ".")}@example.com`,
      phone: "",
      service: r[1],
      message: r[2],
      status: r[3] as Lead["status"],
      priority: r[4] as Lead["priority"],
      category: r[5],
      summary: r[2],
      owner: "Business Owner",
      source: i % 3 === 0 ? "Email" : "n8n Form",
      consent,
      notes:
        i === 7 ? "Sample delivery error: follow-up needs owner review." : "",
      createdAt: created,
      updatedAt: created,
      followUpDue: new Date(Date.parse(created) + 86400000).toISOString(),
      followUpState,
      followUpSentAt: i === 3 ? at(-60) : "",
      acknowledgementStatus: i % 3 === 0 ? "Not sent" : "Sample: sent",
      ownerAlertStatus: "Sample: sent",
      isSample: true,
    };
  });
  return {
    version: 1,
    leads,
    settings: { ...defaultSettings },
    drafts: leads
      .filter((_, i) => [0, 1, 2, 5, 9].includes(i))
      .map((l, i) => ({
        id: `sample-draft-${i + 1}`,
        leadId: l.id,
        subject: `Re: ${l.service}`,
        body: `Hi ${l.name.split(" ")[0]},\n\nThank you for getting in touch about ${l.service.toLowerCase()}. ${i === 0 ? "Could you share your location and a photo of the leak? Our team will review the details before confirming a time." : "Could you share your location and any photos or additional details? This will help our team review your request."}\n\nKind regards,\n5S Plumbing`,
        status: i === 4 ? "Approved" : "Pending review",
        provider: "Sample Gemini reply",
        reason:
          l.priority === "Urgent"
            ? "Urgent request. Owner review required before making any commitment."
            : "Review the reply and confirm all business details before use.",
        createdAt: l.createdAt,
        updatedAt: l.createdAt,
      })),
    tasks: [
      {
        id: "sample-task-1",
        title: "Call Olivia about the kitchen leak",
        leadId: leads[0].id,
        dueAt: at(2),
        completed: false,
        createdAt: at(-2),
      },
      {
        id: "sample-task-2",
        title: "Prepare bathroom renovation quote",
        leadId: leads[1].id,
        dueAt: at(26),
        completed: false,
        createdAt: at(-25),
      },
      {
        id: "sample-task-3",
        title: "Review failed follow-up delivery",
        leadId: leads[7].id,
        dueAt: at(-4),
        completed: false,
        createdAt: at(-30),
      },
      {
        id: "sample-task-4",
        title: "Confirm tap installation details",
        leadId: leads[6].id,
        dueAt: at(-24),
        completed: true,
        createdAt: at(-60),
      },
    ],
    activities: leads
      .slice(0, 10)
      .map((l, i) => ({
        id: `sample-event-${i}`,
        type: "lead",
        title: `Inquiry received from ${l.name}`,
        detail: `Sample ${l.source} inquiry · ${l.service}`,
        leadId: l.id,
        createdAt: l.createdAt,
      })),
    notificationsReadAt: "",
    emailMirrorVersion: 1,
    processedEventIds: [],
    lastAutomationEventAt: "",
    syncChanges: [],
    archivedLeadIds: [],
    lastSyncPollAt: "",
    lastConfigReadAt: "",
    mailJobs: [],
    lastMailPollAt: "",
    mailSenderEmail: "",
  };
}
