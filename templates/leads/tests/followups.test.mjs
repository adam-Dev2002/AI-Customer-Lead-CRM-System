import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeed } from '../lib/crm/seed.ts';
import { applyAutomationEvent, applyMutation } from '../lib/crm/domain.ts';
import { claimFollowUp } from '../lib/crm/followups.ts';
import { followUpApproved, followUpDue, followUpPreview, matchesFollowUp } from '../lib/crm/followup-email.ts';
import { installFollowUpReview } from '../../../scripts/n8n/followup-review.mjs';
import { followUpExpected, followUpFilterFixtures } from '../../../scripts/qa/filter-fixtures.mjs';
import { matchesPeriod } from '../lib/crm/date-filter.ts';

const now = '2026-10-20T01:00:00.000Z';
let sequence = 0;
const makeId = () => `followup-test-${++sequence}`;
const mutate = (data, action, payload = {}) => applyMutation(data, { action, payload }, now, makeId);
function fixture() {
  const data = createSeed(new Date(now));
  data.settings.automaticEmailsEnabled = true;
  data.settings.customerFollowUps = true;
  mutate(data, 'lead.create', {
    name: 'Follow-up Customer', email: 'customer@example.com', service: 'Inspection',
    message: 'Please inspect my tap.', consent: true,
  });
  const lead = data.leads[0];
  lead.followUpDue = '2026-10-20T00:00:00.000Z';
  mutate(data, 'followup.save', { id: lead.id, revision: 0, subject: 'Your inspection follow-up', body: 'Hello, do you still need help with your inspection? Please reply when convenient.' });
  approve(data, lead);
  data.syncChanges = [];
  return { data, lead, input: { action: 'claim', leadId: lead.id, email: lead.email, followUpDue: lead.followUpDue, executionId: 'followup-execution-1', capabilities: ['approved-followups-v1'] } };
}
function approve(data, lead) {
  const email = lead.followUpEmail;
  mutate(data, 'followup.approve', { id: lead.id, revision: email.revision, email: lead.email, dueAt: lead.followUpDue, subject: email.subject, body: email.body, confirmed: true });
}
const claim = f => claimFollowUp(f.data, f.input, now);
function event(f, state, executionId = f.input.executionId, extra = {}) {
  return applyAutomationEvent(f.data, {
    eventId: makeId(), type: 'followup.updated',
    data: { Lead_ID: f.lead.id, Follow_Up_State: state, Execution_ID: executionId, ...extra },
  }, now, makeId);
}

test('a follow-up reservation is persisted once and never reclaimed by the same or a competing execution', () => {
  const f = fixture();
  const { action, capabilities, ...identity } = f.input;
  assert.deepEqual(claim(f), { ...identity, claimed: true, reason: 'claimed', subject: f.lead.followUpEmail.subject, body: f.lead.followUpEmail.body, revision: f.lead.followUpEmail.revision });
});

test('eligible claims lock follow-up state before manual sending and reject all duplicate claim attempts', () => {
  const f = fixture();
  assert.equal(claim(f).claimed, true);
  assert.equal(f.lead.followUpState, 'Reserved');
  assert.equal(f.lead.followUpExecutionId, f.input.executionId);
  assert.equal(f.lead.followUpClaimedAt, now);
  assert.equal(claim(f).reason, 'already_reserved');
  assert.equal(claimFollowUp(f.data, { ...f.input, executionId: 'competing-execution' }, now).claimed, false);
  assert.equal(f.lead.followUpExecutionId, f.input.executionId);
});

test('both automation switches are required and a refusal does not reserve or alter the inquiry', () => {
  for (const setting of ['automaticEmailsEnabled', 'customerFollowUps']) {
    const f = fixture(); f.data.settings[setting] = false;
    const before = structuredClone(f.data);
    assert.equal(claim(f).reason, 'automation_disabled');
    assert.deepEqual(f.data, before);
  }
});

test('claims require a current consented open due non-sample inquiry and exact current recipient/due time', () => {
  for (const change of [
    { consent: false }, { status: 'Contacted' }, { status: 'Closed' }, { isSample: true },
    { followUpDue: '2026-10-21T00:00:00.000Z' }, { followUpState: 'Skipped' }, { followUpState: 'Sent' },
  ]) {
    const f = fixture(); Object.assign(f.lead, change);
    assert.equal(claim(f).claimed, false);
    assert.equal(f.lead.followUpExecutionId, undefined);
  }
  for (const change of [{ email: 'changed@example.com' }, { followUpDue: '2026-10-19T22:00:00.000Z' }]) {
    const f = fixture(); Object.assign(f.lead, change);
    assert.equal(claim(f).reason, 'changed');
  }
  const archived = fixture(); archived.data.archivedLeadIds.push(archived.lead.id);
  assert.equal(claim(archived).reason, 'not_found');
  const missing = fixture(); missing.data.leads = [];
  assert.equal(claim(missing).reason, 'not_found');
});

test('pending or failed owner edits and pending review writes block reservation until applied', () => {
  for (const status of ['Pending', 'Failed']) {
    for (const kind of ['lead.upsert', 'draft.review']) {
      const f = fixture();
      f.data.syncChanges.push({ id: makeId(), leadId: f.lead.id, kind, status });
      assert.equal(claim(f).reason, 'sync_pending');
      f.data.syncChanges[0].status = 'Applied';
      assert.equal(claim(f).claimed, true);
    }
  }
});

test('queued, sending and uncertain manual replies block reservation; cancelled replies do not', () => {
  for (const status of ['Queued', 'Sending', 'Needs Review']) {
    const f = fixture();
    f.data.mailJobs.push({ id: makeId(), leadId: f.lead.id, status });
    assert.equal(claim(f).reason, 'manual_reply_pending');
    assert.equal(f.lead.followUpState, 'Pending');
  }
  const f = fixture();
  f.data.mailJobs.push({ id: makeId(), leadId: f.lead.id, status: 'Cancelled' });
  assert.equal(claim(f).claimed, true);
});

function readyManualReply(f) {
  mutate(f.data, 'draft.create', { leadId: f.lead.id });
  const draft = f.data.drafts[0];
  mutate(f.data, 'draft.approve', { id: draft.id, subject: draft.subject, body: 'Thank you for your inquiry. Please share your preferred inspection time.' });
  f.data.syncChanges.forEach(c => c.status = 'Applied');
  f.data.lastMailPollAt = now;
  f.data.mailSenderEmail = 'owner@example.com';
  return () => mutate(f.data, 'draft.send', {
    id: draft.id, subject: draft.subject, body: draft.body,
    email: f.lead.email, senderEmail: f.data.mailSenderEmail, confirmed: true,
  });
}

test('the reservation and manual-send ordering cannot allow both paths to start for a pending follow-up', () => {
  const manualFirst = fixture();
  readyManualReply(manualFirst)();
  assert.equal(manualFirst.lead.followUpState, 'Skipped');
  assert.equal(claim(manualFirst).claimed, false);
  const followupFirst = fixture();
  const send = readyManualReply(followupFirst);
  assert.equal(claim(followupFirst).claimed, true);
  assert.throws(send, /follow-up is already being processed/);
  assert.equal(followupFirst.data.mailJobs.length, 0);
});

test('claimed follow-up callbacks require their execution owner and cannot downgrade or revive terminal outcomes', () => {
  const f = fixture(); claim(f);
  assert.throws(() => event(f, 'Sent', 'other-execution', { Follow_Up_Sent_UTC: now }), /does not own/);
  assert.throws(() => event(f, 'Sent'), /sent time/);
  assert.throws(() => event(f, 'Pending'), /reservation or delivery result/);
  event(f, 'Reserved');
  event(f, 'Sent', f.input.executionId, { Follow_Up_Sent_UTC: now });
  assert.equal(f.lead.followUpState, 'Sent');
  assert.equal(f.lead.followUpSentAt, now);
  assert.equal(event(f, 'Sent', f.input.executionId, { Follow_Up_Sent_UTC: now }).ignored, true);
  assert.throws(() => event(f, 'Reserved'), /no longer awaiting/);
  assert.equal(claim(f).claimed, false);
  const uncertain = fixture(); claim(uncertain); event(uncertain, 'Needs Review');
  assert.equal(uncertain.lead.followUpState, 'Needs Review');
  assert.equal(claim(uncertain).claimed, false);
  assert.throws(() => event(uncertain, 'Sent', uncertain.input.executionId, { Follow_Up_Sent_UTC: now }), /no longer awaiting/);
});

test('a stale claimed callback cannot overwrite an owner reschedule or a newer reservation', () => {
  const f = fixture(); claim(f); event(f, 'Needs Review');
  assert.throws(() => mutate(f.data, 'followup.reschedule', { id: f.lead.id, dueAt: '2026-10-21T01:00:00.000Z' }));
  assert.throws(() => mutate(f.data, 'followup.resolve', { id: f.lead.id }));
  mutate(f.data, 'followup.resolve', { id: f.lead.id, confirmedNotSent: true });
  mutate(f.data, 'followup.reschedule', { id: f.lead.id, dueAt: '2026-10-21T01:00:00.000Z' });
  approve(f.data, f.lead);
  assert.throws(() => event(f, 'Sent', f.input.executionId, { Follow_Up_Sent_UTC: now }), /no longer awaiting/);
  f.data.syncChanges.forEach(c => c.status = 'Applied');
  const later = '2026-10-21T02:00:00.000Z';
  assert.equal(claimFollowUp(f.data, { ...f.input, followUpDue: f.lead.followUpDue, executionId: 'new-execution' }, later).claimed, true);
  assert.throws(() => event(f, 'Needs Review'), /does not own/);
  assert.equal(f.lead.followUpExecutionId, 'new-execution');
});

test('legacy scheduled inquiries and unapproved edits cannot send, and old senders cannot ignore reviewed content', () => {
  const f = fixture();
  delete f.lead.followUpEmail;
  assert.equal(claim(f).reason, 'approval_required');
  assert.equal(f.lead.followUpState, 'Pending');
  const suggestion = followUpPreview(f.lead, f.data.settings);
  assert(suggestion.body.includes('\n\n'));
  assert.equal(f.lead.followUpEmail, undefined, 'preview does not persist or approve anything');
  mutate(f.data, 'followup.save', { id: f.lead.id, revision: 0, ...suggestion });
  assert.equal(claim(f).reason, 'approval_required');
  approve(f.data, f.lead);
  assert.equal(claimFollowUp(f.data, { ...f.input, capabilities: [] }, now).reason, 'sender_update_required');
  const result = claim(f);
  assert.equal(result.body, suggestion.body);
  assert.equal(result.subject, suggestion.subject);
});

test('editing, rescheduling, permission revocation and withdrawing approval require a fresh review', () => {
  for (const action of ['followup.save', 'followup.reschedule', 'followup.permission', 'followup.unapprove']) {
    const f = fixture();
    const email = f.lead.followUpEmail;
    const payload = { id: f.lead.id, revision: email.revision, subject: email.subject, body: email.body + ' Updated text.', dueAt: '2026-10-21T01:00:00.000Z', consent: false };
    mutate(f.data, action, payload);
    assert.equal(followUpApproved(f.lead), false, action);
    assert.equal(f.lead.followUpSentAt, '');
    assert.equal(f.data.mailJobs.length, 0);
  }
});

test('approval binds the saved revision, recipient, schedule and exact text; no approval action records delivery', () => {
  for (const change of [{ revision: 0 }, { email: 'wrong@example.com' }, { dueAt: '2026-10-22T00:00:00.000Z' }, { subject: 'different' }, { body: 'different text for approval' }, { confirmed: false }]) {
    const f = fixture(), email = f.lead.followUpEmail;
    assert.throws(() => mutate(f.data, 'followup.approve', { id: f.lead.id, revision: email.revision, email: f.lead.email, dueAt: f.lead.followUpDue, subject: email.subject, body: email.body, confirmed: true, ...change }));
  }
  const f = fixture();
  assert.equal(followUpApproved(f.lead), true);
  assert.equal(f.lead.followUpState, 'Pending');
  assert.equal(f.lead.followUpSentAt, '');
  assert.equal(f.data.mailJobs.length, 0);
});

test('claimed email is immutable and a competing save or second approval cannot change a send', () => {
  const f = fixture(); const result = claim(f);
  for (const action of ['followup.save', 'followup.approve', 'followup.unapprove', 'followup.permission'])
    assert.throws(() => mutate(f.data, action, { id: f.lead.id, revision: result.revision }), /already being handled/);
  assert.equal(f.lead.followUpEmail.body, result.body);
});

test('due counts represent pending past-due schedules, independently of approval and sending permission', () => {
  const f = fixture();
  assert.equal(followUpDue(f.lead, Date.parse(now)), true);
  assert.equal(followUpDue({ ...f.lead, consent: false }, Date.parse(now)), true);
  for (const patch of [{ followUpState: 'Sent' }, { followUpState: 'Skipped' }, { followUpState: 'Reserved' }, { followUpDue: '' }, { followUpDue: 'invalid' }, { followUpDue: '2026-10-21T01:00:00Z' }])
    assert.equal(followUpDue({ ...f.lead, ...patch }, Date.parse(now)), false);
});

test('permission is recorded on the follow-up page only with explicit confirmation and syncs its correct fields', () => {
  const f = fixture(); f.lead.consent = false; f.lead.followUpState = 'Skipped';
  assert.throws(() => mutate(f.data, 'followup.permission', { id: f.lead.id, consent: true }), /Confirm/);
  mutate(f.data, 'followup.permission', { id: f.lead.id, consent: true, confirmed: true });
  assert.equal(f.lead.consent, true);
  assert.equal(f.lead.followUpState, 'Skipped', 'permission alone does not schedule a send');
  assert(f.data.syncChanges.at(-1).fields.includes('Consent'));
});

test('workflow reads each matched claim email, subject and body without changing other nodes or credentials', () => {
  const workflow = { nodes: [
    { name: 'Claim consented follow-up', parameters: { url: 'http://crm/api/n8n/followups', jsonBody: 'old' }, credentials: { httpHeaderAuth: { id: 'qa-crm' } } },
    { name: 'GMAIL — Send Consented Follow-Up', parameters: { emailType: 'text', options: { appendAttribution: false } }, credentials: { gmailOAuth2: { id: 'qa-gmail' } } },
    { name: 'Report sender', parameters: { untouched: true } },
  ], connections: { untouched: true } };
  const before = structuredClone(workflow);
  installFollowUpReview(workflow);
  assert.deepEqual(workflow.connections, before.connections);
  assert.deepEqual(workflow.nodes[2], before.nodes[2]);
  for (let index = 0; index < 2; index++) assert.deepEqual(workflow.nodes[index].credentials, before.nodes[index].credentials);
  for (const email of [{ email: 'first@example.com', subject: 'First', body: 'First saved body' }, { email: 'second@example.com', subject: 'Second', body: 'Second saved body' }]) {
    const select = name => { assert.equal(name, 'Claim consented follow-up'); return { item: { json: email } }; };
    for (const [field, value] of [['sendTo', email.email], ['subject', email.subject], ['message', email.body]])
      assert.equal(new Function('$', `return (${workflow.nodes[1].parameters[field].slice(3, -2).trim()});`)(select), value);
  }
});

test('an older Sheets capture cannot release an in-flight CRM reservation', () => {
  const f = fixture(); claim(f);
  applyAutomationEvent(f.data, {
    eventId: makeId(), type: 'lead.upsert', data: {
      Lead_ID: f.lead.id, Name: f.lead.name, Email: f.lead.email, Service: f.lead.service,
      Message: f.lead.message, Consent: 'Yes', Status: 'New', Follow_Up_State: 'Pending',
      Follow_Up_Due_UTC: f.lead.followUpDue,
    },
  }, now, makeId);
  assert.equal(f.lead.followUpState, 'Reserved');
  assert.equal(f.lead.followUpExecutionId, f.input.executionId);
  assert.equal(claim(f).claimed, false);
});

test('existing unclaimed follow-up events remain compatible and cannot reverse a recorded sent outcome', () => {
  const f = fixture();
  event(f, 'Reserved', 'legacy-execution');
  event(f, 'Sent', 'legacy-execution', { Follow_Up_Sent_UTC: now });
  assert.equal(f.lead.followUpState, 'Sent');
  assert.equal(event(f, 'Pending', 'legacy-execution').ignored, true);
});

test('malformed claims reject before touching saved state', () => {
  for (const change of [{ action: 'send' }, { leadId: '' }, { email: 'invalid' }, { followUpDue: 'bad-date' }, { executionId: '' }]) {
    const f = fixture(); const before = structuredClone(f.data);
    assert.throws(() => claimFollowUp(f.data, { ...f.input, ...change }, now));
    assert.deepEqual(f.data, before);
  }
});

test('all nine follow-up filters select exact independent expected records and never mutate them', () => {
  const leads = followUpFilterFixtures(fixture().lead, Date.parse(now)), before = structuredClone(leads);
  for (const [filter, expected] of Object.entries(followUpExpected)) {
    assert.deepEqual(leads.filter(lead => matchesFollowUp(lead, filter, Date.parse(now))).map(lead => lead.id).sort(), [...expected].sort(), filter);
  }
  assert.deepEqual(leads, before);
});

test('due and approval views overlap; approved pending emails are excluded from awaiting approval', () => {
  const leads = followUpFilterFixtures(fixture().lead, Date.parse(now));
  const get = id => leads.find(lead => lead.id === id);
  assert(matchesFollowUp(get('draft-due'), 'due', Date.parse(now)));
  assert(matchesFollowUp(get('draft-due'), 'review', Date.parse(now)));
  assert(matchesFollowUp(get('approved-due'), 'Pending', Date.parse(now)));
  assert(!matchesFollowUp(get('approved-due'), 'review', Date.parse(now)));
  for (const id of ['reserved', 'sent', 'uncertain', 'cancelled', 'unscheduled'])
    assert(!matchesFollowUp(get(id), 'review', Date.parse(now)));
});

test('due boundaries accept the exact scheduled instant and exclude missing/invalid dates', () => {
  const lead = fixture().lead;
  assert(!followUpDue({ ...lead, followUpDue: now }, Date.parse(now) - 1));
  assert(followUpDue({ ...lead, followUpDue: now }, Date.parse(now)));
  assert(!followUpDue({ ...lead, followUpDue: 'invalid' }, Date.parse(now)));
  assert(!followUpDue({ ...lead, followUpDue: '' }, Date.parse(now)));
});

test('date filters reject future/invalid timestamps and include exact recent-period boundaries', () => {
  const current = new Date(now), before = days => new Date(current.getTime() - days * 86400000).toISOString();
  for (const period of ['today', 'month', 'week', '30days']) {
    assert(!matchesPeriod('2026-10-21T01:00:00.000Z', period, 'Asia/Singapore', current));
    assert(!matchesPeriod('invalid', period, 'Asia/Singapore', current));
    assert(matchesPeriod(now, period, 'Asia/Singapore', current));
  }
  assert(matchesPeriod(before(7), 'week', 'Asia/Singapore', current));
  assert(!matchesPeriod(new Date(current.getTime() - 7 * 86400000 - 1).toISOString(), 'week', 'Asia/Singapore', current));
  assert(matchesPeriod(before(30), '30days', 'Asia/Singapore', current));
  assert(!matchesPeriod(before(31), '30days', 'Asia/Singapore', current));
  assert(matchesPeriod('invalid', 'all', 'Asia/Singapore', current));
});

test('today and this-month filters respect Singapore dates across UTC midnight/month boundaries', () => {
  const current = new Date('2026-11-01T01:00:00.000Z');
  assert(matchesPeriod('2026-10-31T16:01:00.000Z', 'today', 'Asia/Singapore', current));
  assert(!matchesPeriod('2026-10-31T15:59:00.000Z', 'today', 'Asia/Singapore', current));
  assert(matchesPeriod('2026-10-31T16:01:00.000Z', 'month', 'Asia/Singapore', current));
  assert(!matchesPeriod('2026-10-31T15:59:00.000Z', 'month', 'Asia/Singapore', current));
});
