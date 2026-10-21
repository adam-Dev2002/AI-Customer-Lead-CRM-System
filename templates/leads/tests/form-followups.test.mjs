import test from 'node:test';
import assert from 'node:assert/strict';
import { readReviewedWorkflow } from '../../../scripts/n8n/workflow-reference.mjs';
import { createSeed } from '../lib/crm/seed.ts';
import { applyAutomationEvent, applyMutation } from '../lib/crm/domain.ts';
import { workflowConfiguration } from '../lib/crm/integration.ts';
import { claimFollowUp } from '../lib/crm/followups.ts';
import { followUpDue, followUpPreview } from '../lib/crm/followup-email.ts';

const { workflow } = readReviewedWorkflow();
const node = suffix => workflow.nodes.find(item => item.name.endsWith(suffix));
const form = node('Customer Inquiry');
const validator = node('Format & Check Lead');
const append = node('Append Customer Lead');
const captured = workflow.nodes.find(item => item.name.toLowerCase() === 'form captured');
const filter = node('Pending Consented Follow-Ups');
const submittedAt = '2026-10-21T01:00:00.000Z'; // 09:00 Singapore
const dueAt = '2026-10-22T01:00:00.000Z';
const beforeDue = '2026-10-22T00:59:59.999Z';
let sequence = 0;
const makeId = () => `form-followup-${++sequence}`;
const clock = instant => class extends Date {
  constructor(...args) { super(...(args.length ? args : [instant])); }
  static now() { return Date.parse(instant); }
};

function fixture(permission = 'Yes', hours = 24) {
  const data = createSeed(new Date(submittedAt));
  for (const key of ['leads', 'drafts', 'activities', 'tasks', 'syncChanges', 'mailJobs']) data[key] = [];
  data.settings.automaticEmailsEnabled = true;
  data.settings.customerFollowUps = true;
  data.settings.followUpHours = hours;
  const config = workflowConfiguration(data);
  const options = form.parameters.formFields.values.find(field => field.fieldLabel === 'Follow-up Permission').fieldOptions.values;
  const input = {
    'Full Name': 'Controlled Form Customer', 'Email Address': 'form.qa@example.com',
    'Service Needed': 'Tap inspection', Message: 'Please inspect my leaking tap.',
    'Follow-up Permission': options.find(option => option.option.startsWith(permission))?.option,
    _cfg: config,
  };
  const validated = new Function('$input', 'Date', validator.parameters.jsCode)(
    { first: () => ({ json: input }) }, clock(submittedAt),
  )[0].json;
  assert.equal(validated.valid, true);
  // Execute the actual Sheets field mapping without contacting Sheets.
  const row = Object.fromEntries(Object.entries(append.parameters.columns.value).map(([key, expression]) => [
    key, new Function('$json', `return (${expression.slice(3, -2).trim()});`)(validated),
  ]));
  const event = new Function('$json', '$execution', captured.parameters.jsCode)(row, { id: makeId() }).json;
  applyAutomationEvent(data, event, submittedAt, makeId);
  const lead = data.leads[0];
  return { data, config, row, event, lead };
}
const mutate = (f, action, payload) => applyMutation(f.data, { action, payload }, submittedAt, makeId);
function candidates(f, instant) {
  return new Function('$', '$input', 'Date', filter.parameters.jsCode)(
    () => ({ first: () => ({ json: { _cfg: workflowConfiguration(f.data) } }) }),
    { all: () => [{ json: { ...f.row, Status: f.lead.status, Consent: f.lead.consent ? 'Yes' : 'No', Follow_Up_State: f.lead.followUpState } }] },
    clock(instant),
  );
}
function claim(f, instant = dueAt) {
  return claimFollowUp(f.data, {
    action: 'claim', leadId: f.lead.id, email: f.lead.email,
    followUpDue: f.lead.followUpDue, executionId: 'simulated-form-followup', capabilities: ['approved-followups-v1'],
  }, instant);
}
function saveAndApprove(f) {
  const suggestion = followUpPreview(f.lead, f.data.settings);
  mutate(f, 'followup.save', { id: f.lead.id, revision: 0, ...suggestion });
  const email = f.lead.followUpEmail;
  mutate(f, 'followup.approve', { id: f.lead.id, revision: email.revision, subject: email.subject, body: email.body, email: f.lead.email, dueAt: f.lead.followUpDue, confirmed: true });
}

test('form Yes records permission and schedules a pending follow-up through Sheets mapping and capture', () => {
  const f = fixture();
  assert.equal(f.lead.consent, true);
  assert.equal(f.lead.status, 'New');
  assert.equal(f.lead.followUpState, 'Pending');
  assert.equal(f.lead.followUpDue, dueAt);
  assert.equal(f.lead.followUpEmail, undefined);
  assert.equal(f.data.drafts.length, 0);
  assert.equal(f.data.mailJobs.length, 0);
  assert.equal(applyAutomationEvent(f.data, f.event, submittedAt, makeId).duplicate, true);
  assert.equal(f.data.leads.length, 1);
});

test('form No or missing permission is never scheduled as Pending and never becomes due', () => {
  for (const permission of ['No', 'missing']) {
    const f = fixture(permission);
    assert.equal(f.lead.consent, false);
    assert.equal(f.lead.followUpState, 'Skipped');
    assert.equal(followUpDue(f.lead, Date.parse(dueAt)), false);
    assert.equal(candidates(f, dueAt).length, 0);
    assert.equal(claim(f).claimed, false);
  }
});

test('form schedule honors configured hours; due changes at the exact time independently of approval', () => {
  const f = fixture();
  assert.equal(followUpDue(f.lead, Date.parse(beforeDue)), false);
  assert.equal(candidates(f, beforeDue).length, 0);
  assert.equal(followUpDue(f.lead, Date.parse(dueAt)), true);
  assert.equal(candidates(f, dueAt).length, 1);
  assert.equal(claim(f).reason, 'approval_required');
  const custom = fixture('Yes', 6);
  assert.equal(custom.lead.followUpDue, '2026-10-21T07:00:00.000Z');
});

test('suggested and saved form follow-up text cannot send until explicitly approved', () => {
  const f = fixture();
  const suggestion = followUpPreview(f.lead, f.data.settings);
  assert(suggestion.body.includes(f.lead.service));
  assert.equal(f.lead.followUpEmail, undefined, 'preview is not an automatically saved Gmail draft');
  assert.equal(claim(f).reason, 'approval_required');
  mutate(f, 'followup.save', { id: f.lead.id, revision: 0, ...suggestion });
  assert.equal(claim(f).reason, 'approval_required');
  assert.equal(f.data.mailJobs.length, 0);
  assert.equal(f.lead.followUpSentAt, '');
});

test('approved form follow-up waits for its due time, reserves exact saved text and accepts simulated delivery confirmation', () => {
  const f = fixture(); saveAndApprove(f);
  assert.equal(f.lead.followUpState, 'Pending');
  assert.equal(f.lead.followUpSentAt, '');
  assert.equal(claim(f, beforeDue).claimed, false);
  const reserved = claim(f);
  assert.equal(reserved.claimed, true);
  assert.equal(reserved.body, f.lead.followUpEmail.body);
  assert.equal(reserved.subject, f.lead.followUpEmail.subject);
  assert.equal(f.lead.followUpState, 'Reserved');
  assert.equal(followUpDue(f.lead, Date.parse(dueAt)), false);
  assert.equal(claim(f).claimed, false);
  applyAutomationEvent(f.data, { eventId: makeId(), type: 'followup.updated', data: {
    Lead_ID: f.lead.id, Follow_Up_State: 'Sent', Follow_Up_Sent_UTC: dueAt, Execution_ID: 'simulated-form-followup',
  } }, dueAt, makeId);
  assert.equal(f.lead.followUpState, 'Sent');
  assert.equal(f.lead.followUpSentAt, dueAt);
  assert.equal(claim(f).claimed, false);
});

test('form follow-ups send only while New or Pending and both automatic email switches are enabled', () => {
  for (const status of ['New', 'Pending', 'Contacted', 'Qualified', 'Won', 'Lost', 'Closed']) {
    const f = fixture(); saveAndApprove(f); f.lead.status = status;
    const expected = ['New', 'Pending'].includes(status);
    assert.equal(candidates(f, dueAt).length, expected ? 1 : 0, status);
    assert.equal(claim(f).claimed, expected, status);
  }
  for (const setting of ['automaticEmailsEnabled', 'customerFollowUps']) {
    const f = fixture(); saveAndApprove(f); f.data.settings[setting] = false;
    assert.equal(followUpDue(f.lead, Date.parse(dueAt)), true, 'due does not imply permission to send');
    assert.equal(candidates(f, dueAt).length, 0);
    assert.equal(claim(f).reason, 'automation_disabled');
  }
});
