import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyWorkspace } from "../lib/crm/new-workspace.ts";

test("business registration starts empty with no inherited delivery permissions or identity", () => {
  const first = createEmptyWorkspace(" First business "), second = createEmptyWorkspace("Second business");
  assert.equal(first.settings.businessName, "First business");
  assert.equal(first.settings.brandPreset, "generic");
  assert.equal(first.settings.ownerEmail, "");
  for (const key of ["customerAcknowledgements", "customerFollowUps", "aiClassification", "ownerNotifications", "automaticEmailsEnabled"]) assert.equal(first.settings[key], false);
  for (const key of ["leads", "drafts", "tasks", "activities", "mailJobs", "syncChanges", "processedEventIds", "archivedLeadIds", "mailSenderCapabilities"]) assert.deepEqual(first[key], []);
  assert.equal(first.mailSenderEmail, "");
  first.settings.businessName = "Changed"; first.leads.push({ id: "test" });
  assert.equal(second.settings.businessName, "Second business"); assert.deepEqual(second.leads, []);
});
