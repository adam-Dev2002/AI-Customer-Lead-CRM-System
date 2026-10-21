import test from "node:test";
import assert from "node:assert/strict";
import { createSeed } from "../lib/crm/seed.ts";
import {
  applyMutation,
  applyAutomationEvent,
  eligibleForFollowUp,
  buildLead,
} from "../lib/crm/domain.ts";
const now = "2026-10-19T04:00:00.000Z";
let sequence = 0;
const id = () => `test${String(++sequence).padStart(6, "0")}-uuid`;
function fresh() {
  return createSeed(new Date(now));
}
function input(extra = {}) {
  return {
    name: "Test Customer",
    email: "test@example.com",
    service: "Kitchen sink",
    message: "Can you help with a leaking sink?",
    consent: true,
    ...extra,
  };
}
function change(data, action, payload) {
  applyMutation(data, { action, payload }, now, id);
}
test("only due, consented New/Pending leads qualify for a follow-up", () => {
  const l = buildLead(
    input(),
    fresh().settings,
    "2026-10-17T04:00:00Z",
    "test",
  );
  assert.equal(eligibleForFollowUp(l, Date.parse(now)), true);
  for (const patch of [
    { consent: false },
    { status: "Contacted" },
    { followUpState: "Sent" },
    { followUpState: "Reserved" },
    { followUpDue: "2027-01-01T00:00:00Z" },
  ])
    assert.equal(
      eligibleForFollowUp({ ...l, ...patch }, Date.parse(now)),
      false,
    );
});
test("marking contacted skips a pending follow-up and preserves a sent result", () => {
  const d = fresh(),
    lead = d.leads[0];
  change(d, "lead.update", { id: lead.id, status: "Contacted" });
  assert.equal(lead.followUpState, "Skipped");
  lead.followUpState = "Sent";
  change(d, "lead.update", { id: lead.id, consent: false });
  assert.equal(lead.followUpState, "Sent");
});
test("revoking permission cancels pending scheduling; scheduling needs future time and consent", () => {
  const d = fresh(),
    lead = d.leads[0];
  change(d, "lead.update", { id: lead.id, consent: false });
  assert.equal(lead.followUpState, "Skipped");
  assert.throws(
    () =>
      change(d, "followup.reschedule", {
        id: lead.id,
        dueAt: "2026-10-20T00:00:00Z",
      }),
    /consent/,
  );
  change(d, "lead.update", { id: lead.id, consent: true });
  assert.equal(lead.followUpState, "Skipped");
  assert.throws(
    () =>
      change(d, "followup.reschedule", {
        id: lead.id,
        dueAt: "2026-10-01T00:00:00Z",
      }),
    /future/,
  );
  change(d, "followup.reschedule", {
    id: lead.id,
    dueAt: "2026-10-20T00:00:00Z",
  });
  assert.equal(lead.followUpState, "Pending");
});
test("approving an edited reply records review without marking a customer contacted or sending", () => {
  const d = fresh(),
    draft = d.drafts[0],
    lead = d.leads.find((l) => l.id === draft.leadId);
  change(d, "draft.approve", {
    id: draft.id,
    body: "Thank you for the details. We will review your inquiry.",
    subject: "Your inquiry",
  });
  assert.equal(draft.status, "Approved");
  assert.equal(lead.status, "New");
  assert.equal(lead.followUpState, "Pending");
  assert.equal(lead.followUpSentAt, "");
  assert.equal(d.activities[0].detail, "Local review only; no email was sent.");
});
test("manual draft placeholders cannot be approved", () => {
  const d = fresh(),
    l = d.leads[4];
  change(d, "draft.create", { leadId: l.id });
  assert.throws(
    () => change(d, "draft.approve", { id: d.drafts[0].id }),
    /placeholder/,
  );
});
test("invalid CSV imports do not partially add records", () => {
  const d = fresh(),
    count = d.leads.length;
  assert.throws(
    () =>
      change(d, "leads.import", {
        rows: [input(), input({ email: "invalid" })],
      }),
    /Row 3/,
  );
  assert.equal(d.leads.length, count);
});
test("repeat inquiries within 15 minutes are rejected", () => {
  const d = fresh();
  change(d, "lead.create", input());
  assert.throws(() => change(d, "lead.create", input()), /already added/);
});
test("automation events upsert n8n fields and are idempotent", () => {
  const d = fresh(),
    count = d.leads.length;
  const event = {
    eventId: "n8n-test-1",
    type: "lead.upsert",
    data: {
      Lead_ID: "n8n-test",
      Name: "Webhook Customer",
      Email: "webhook@example.com",
      Service: "Drain repair",
      Message: "Please inspect the drain.",
      Consent: "Yes",
      Status: "New",
      Priority: "High",
      Follow_Up_State: "Pending",
      Follow_Up_Due_UTC: "2026-10-20T00:00:00Z",
    },
  };
  assert.equal(applyAutomationEvent(d, event, now, id).duplicate, false);
  assert.equal(applyAutomationEvent(d, event, now, id).duplicate, true);
  assert.equal(d.leads.length, count + 1);
  assert.equal(d.leads[0].priority, "High");
  assert.equal(d.leads[0].isSample, false);
});
test("automation cannot overwrite an owner-reviewed draft", () => {
  const d = fresh(),
    draft = d.drafts[0];
  change(d, "draft.approve", { id: draft.id });
  assert.throws(
    () =>
      applyAutomationEvent(
        d,
        {
          eventId: "new-event",
          type: "draft.upsert",
          data: {
            Draft_ID: draft.id,
            Lead_ID: draft.leadId,
            Subject: "Changed reply",
            Body: "This must not replace an approved reply.",
          },
        },
        now,
        id,
      ),
    /cannot be overwritten/,
  );
});
test("removing samples keeps manually added leads and business settings", () => {
  const d = fresh();
  change(d, "lead.create", input());
  change(d, "samples.clear", {});
  assert.equal(d.leads.length, 1);
  assert.equal(d.leads[0].email, "test@example.com");
  assert.equal(d.settings.businessName, "5S Plumbing");
});
