import { defaultSettings } from "./seed.ts";
import type { CRMData } from "./types.ts";

// Account registration never copies records, delivery state or integrations.
export function createEmptyWorkspace(name: string): CRMData {
  return {
    version: 1, emailMirrorVersion: 1,
    settings: {
      ...defaultSettings,
      businessName: name.trim().slice(0, 100) || "My business",
      brandPreset: "generic", businessLogo: "", ownerEmail: "",
      customerAcknowledgements: false, customerFollowUps: false,
      aiClassification: false, ownerNotifications: false, automaticEmailsEnabled: false,
    },
    leads: [], drafts: [], tasks: [], activities: [], mailJobs: [], syncChanges: [],
    processedEventIds: [], archivedLeadIds: [], notificationsReadAt: "",
    lastAutomationEventAt: "", lastSyncPollAt: "", lastConfigReadAt: "",
    lastMailPollAt: "", mailSenderEmail: "", mailSenderCapabilities: [],
  };
}
