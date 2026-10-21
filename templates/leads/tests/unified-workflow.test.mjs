import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { combineWorkflows, removedAINodes, validateUnified } from '../../../scripts/n8n/unified-workflow.mjs';
import { prepareGmail } from '../../../scripts/n8n/bridge-code.mjs';
import { prepareMailDraft } from '../../../scripts/n8n/mail-code.mjs';

const metadata = JSON.parse(readFileSync(new URL('../../../scripts/n8n/unified-sources.json', import.meta.url), 'utf8'));
const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const sources = {};
for (const reference of metadata.sources) {
  const raw = readFileSync(reference.path);
  // Assertion failures disclose fingerprints only, never the private export body.
  assert.equal(digest(raw), reference.sha256, `${reference.role} source changed and must be reviewed again`);
  const workflow = JSON.parse(raw.toString('utf8'));
  assert.equal(workflow.nodes.length, reference.nodeCount);
  sources[reference.role] = workflow;
}
const originalFingerprint = digest(sources);
const { workflow, report } = combineWorkflows(sources);
const get = name => {
  const found = workflow.nodes.find(n => n.name === name);
  assert(found, `Expected node ${name}`);
  return found;
};
const destinations = (name, output = 0) => (workflow.connections[name]?.main?.[output] || []).map(edge => edge.node);
const reachable = start => {
  const seen = new Set(), pending = [start];
  while (pending.length) {
    const name = pending.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    pending.push(...(workflow.connections[name]?.main || []).flat().map(edge => edge.node));
  }
  return seen;
};
const referenceNames = value => {
  const found = new Set();
  const visit = entry => {
    if (typeof entry === 'string') {
      for (const expression of [/(?:\$|\$items)\(\s*(['"])([^'"\r\n]+)\1/g, /\$node\[\s*(['"])([^'"\r\n]+)\1/g])
        for (const match of entry.matchAll(expression)) found.add(match[2]);
    } else if (Array.isArray(entry)) entry.forEach(visit);
    else if (entry && typeof entry === 'object') Object.values(entry).forEach(visit);
  };
  visit(value);
  return found;
};

test('consolidation keeps source inputs immutable, retains original node identities and saved credential references', () => {
  assert.equal(digest(sources), originalFingerprint);
  for (const source of Object.values(sources)) {
    for (const original of source.nodes) {
      const retained = workflow.nodes.find(node => node.name === original.name);
      if (!retained) continue;
      assert.equal(retained.id, original.id, `Identity changed for ${original.name}`);
      assert.equal(retained.type, original.type, `Type changed for ${original.name}`);
      assert.deepEqual(retained.credentials, original.credentials, `Credential binding changed for ${original.name}`);
    }
  }
  const originalForm = sources.main.nodes.find(n => n.type === 'n8n-nodes-base.formTrigger');
  assert.equal(get(originalForm.name).webhookId, originalForm.webhookId);
  assert.equal(get(originalForm.name).parameters.path, originalForm.parameters.path);
  assert.equal(workflow.active, false);
  assert.equal(workflow.id, undefined);
  assert.equal(workflow.staticData, undefined);
  assert.equal(Object.keys(workflow.pinData || {}).length, 0);
  assert.equal(report.sourceNodeCount, metadata.sources.reduce((sum, source) => sum + source.nodeCount, 0));
});

test('one manual check reaches only read-only CRM, Gmail and Sheets requests and cannot reach business processing', () => {
  const triggers = workflow.nodes.filter(n => n.type === 'n8n-nodes-base.manualTrigger');
  assert.equal(triggers.length, 1);
  const expected = ['Manual system check', 'Check CRM connection', 'Check Gmail connection', 'Check Sheets connection', 'System check complete'];
  assert.deepEqual(workflow.nodes.slice(0, 5).map(node => node.name), expected, 'The CLI fallback must start at the read-only check.');
  assert.deepEqual([...reachable(triggers[0].name)].sort(), [...expected].sort());
  for (const name of expected.slice(1, -1)) {
    const node = get(name);
    assert.equal(node.type, 'n8n-nodes-base.httpRequest');
    assert.equal(node.parameters.method || 'GET', 'GET');
    assert.equal(node.parameters.sendBody, undefined);
    assert.equal(node.retryOnFail, false);
  }
  const execute = (capable = true) => new Function('$', '$input', get('System check complete').parameters.jsCode)(
    name => ({ first: () => ({ json: name === 'Check CRM connection' ? { ready: true, capabilities: { atomicFollowUpClaim: capable } } : { emailAddress: 'owner@example.com' } }) }),
    { first: () => ({ json: { properties: { title: 'QA Sheet' }, sheets: [{ properties: { title: 'Leads' } }, { properties: { title: 'ReplyReviews' } }] } }) },
  );
  assert.equal(execute()[0].json.ready, true);
  assert.equal(execute()[0].json.mailSent, false);
  assert.throws(() => execute(false), /updated CRM backend/);
});

test('consolidation retains the reviewed live MIME and deleted-draft fixes absent from the older helper exports', () => {
  assert.equal(get('Prepare Gmail update').parameters.jsCode, prepareGmail);
  assert.equal(get('Build confirmed Gmail draft').parameters.jsCode, prepareMailDraft);
  assert.equal(get('Read existing lead').parameters.operation, 'read');
  assert.equal(get('Read existing lead').parameters.options.cellFormat, 'RAW');
  assert.equal(get('Gmail — Create Draft (NEVER SEND)').parameters.emailType, 'text');
  assert.equal(get('SHEETS — Append Customer Lead').parameters.options.handlingExtraData, 'ignoreIt');
});

test('four schedules have independent entry paths with explicit intervals and no cross-lane sync or sender starts', () => {
  const schedules = workflow.nodes.filter(n => n.type === 'n8n-nodes-base.scheduleTrigger');
  assert.equal(schedules.length, 4);
  for (const [name, next, interval] of [
    ['START — Every 5 Minutes', 'Read shared email configuration', { field: 'minutes', minutesInterval: 5 }],
    ['SCHEDULE — Check Open Leads Hourly', 'TAG — Scheduled Review', { field: 'hours', hoursInterval: 1 }],
    ['Poll every minute', 'Bridge settings', { field: 'minutes', minutesInterval: 1 }],
    ['Check queued replies every minute', 'Read sending Gmail account', { field: 'minutes', minutesInterval: 1 }],
  ]) {
    assert.deepEqual(destinations(name), [next]);
    assert.deepEqual(get(name).parameters.rule.interval, [interval]);
  }
  assert(!reachable('Poll every minute').has('Claim approved reply'));
  assert(!reachable('Check queued replies every minute').has('Read owner changes'));
  assert(!reachable('START — Every 5 Minutes').has('Claim approved reply'));
  assert.deepEqual(destinations('Claim approved reply'), ['Reply waiting?']);
});

test('email draft publishing keeps the original label branch and incomplete AI replies still reach inquiry capture', () => {
  assert(destinations('Gmail — Create Draft (NEVER SEND)').includes('Gmail — Label Draft Outcome'));
  assert(destinations('Gmail — Create Draft (NEVER SEND)').includes('Email support processed'));
  assert(destinations('Gmail — Label No-Draft Outcome').includes('Email inquiry without draft'));
  assert.equal(get('Gmail — Create Draft (NEVER SEND)').parameters.resource, 'draft');
  assert.equal(get('Gmail — Create Draft (NEVER SEND)').parameters.options.sendTo, '={{ $json.sender }}');
  assert.deepEqual(destinations('Compose Trusted AI Prompt'), ['AI — Gemini Primary']);
  assert.deepEqual(destinations('AI — Gemini Primary'), ['Parse Gemini Result']);
  assert.deepEqual(destinations('Parse Gemini Result'), ['Review AI & Route']);
});

function parseAndReview(response) {
  const email = { message_id: 'qa-inquiry', sender: 'customer@example.com', subject: 'Inspection', body: 'Please inspect our tap.' };
  const parsed = new Function('$json', '$', get('Parse Gemini Result').parameters.jsCode)(response,
    name => { assert.equal(name, 'Compose Trusted AI Prompt'); return { item: { json: email } }; }).json;
  const reviewed = new Function('$json', get('Review AI & Route').parameters.jsCode)(parsed).json;
  return { parsed, reviewed, email };
}

test('Gemini parser creates a reviewable draft for valid response and preserves the original inquiry on every failure', () => {
  const ai = { reply_needed: true, needs_human: false, reply_body: 'Thank you for your inquiry. Please share your preferred inspection time.', category: 'technical', priority: 'normal', summary: 'Customer requests a tap inspection.' };
  const successful = parseAndReview({ candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify(ai) + '\n```' }] } }] });
  assert.equal(successful.parsed.valid, true);
  assert.equal(successful.parsed.ai_provider, 'gemini');
  assert.equal(successful.reviewed.create_draft, true);
  assert.equal(successful.reviewed.reply_body, ai.reply_body);
  for (const response of [
    { error: { message: 'Simulated provider outage' } }, {},
    { candidates: [{ content: { parts: [{ text: 'not valid JSON' }] } }] },
    { candidates: [{ content: { parts: [{ text: JSON.stringify({ ...ai, reply_needed: 'yes' }) }] } }] },
    { candidates: [{ content: { parts: [{ text: '[]' }] } }] },
  ]) {
    const { parsed, reviewed, email } = parseAndReview(response);
    assert.equal(parsed.valid, false);
    assert.equal(parsed.ai, null);
    assert.equal(reviewed.create_draft, false);
    assert.equal(reviewed.outcome, 'review');
    assert.equal(reviewed.sender, email.sender);
    assert.equal(reviewed.body, email.body);
  }
  const noReply = parseAndReview({ candidates: [{ content: { parts: [{ text: JSON.stringify({ ...ai, reply_needed: false }) }] } }] });
  assert.equal(noReply.reviewed.create_draft, false);
});

test('Gemini is the sole provider, uses saved credentials, and no duplicate inline key headers survive', () => {
  for (const name of removedAINodes) assert(!workflow.nodes.some(node => node.name === name));
  for (const node of workflow.nodes) {
    assert(!/openai|api\.openai\.com|\$env\.OPENAI/i.test(node.name + ' ' + JSON.stringify(node.parameters)), `Unexpected provider reference on ${node.name}`);
  }
  for (const name of ['AI — Gemini Primary', 'LEADS — Gemini Classify (Optional)']) {
    const node = get(name);
    assert.equal(node.credentials.httpHeaderAuth.id, sources.main.nodes.find(source => source.name === name).credentials.httpHeaderAuth.id);
    assert.equal(node.onError, 'continueRegularOutput');
    assert.equal(node.retryOnFail, false);
    assert(!(node.parameters.headerParameters?.parameters || []).some(header => /^(x-goog-api-key|authorization)$/i.test(header.name)));
  }
});

test('real Gmail sends and claims have no automatic retries and preparation remains before sending', () => {
  const sends = workflow.nodes.filter(node => node.type === 'n8n-nodes-base.gmail' && (!node.parameters.resource || node.parameters.resource === 'message') && (!node.parameters.operation || node.parameters.operation === 'send'));
  assert.equal(sends.length, 3);
  for (const node of [...sends, get('Send confirmed Gmail draft'), get('Claim approved reply'), get('Claim consented follow-up')])
    assert.equal(node.retryOnFail, false, `Automatic retry configured on ${node.name}`);
  assert.equal(get('Send confirmed Gmail draft').parameters.url, 'https://gmail.googleapis.com/gmail/v1/users/me/drafts/send');
  assert.deepEqual(destinations('Record prepared draft'), ['Send confirmed Gmail draft']);
  assert.deepEqual(destinations('Send confirmed Gmail draft'), ['Gmail delivery result']);
  assert.deepEqual(destinations('Gmail delivery result'), ['Confirm Gmail delivery']);
  assert.equal(get('Save shared lead').parameters.operation, 'appendOrUpdate');
  assert.deepEqual(get('Save shared lead').parameters.columns.matchingColumns, ['Lead_ID']);
  assert.deepEqual(get('Save reply review').parameters.columns.matchingColumns, ['Draft_ID']);
});

test('follow-up sends require a CRM claim followed by its true branch and preserve row lineage', () => {
  assert.deepEqual(destinations('FILTER — Pending Consented Follow-Ups'), ['Claim consented follow-up']);
  assert.deepEqual(destinations('Claim consented follow-up'), ['Follow-up claimed?']);
  assert.deepEqual(destinations('Follow-up claimed?'), ['SHEETS — Reserve Follow-Up']);
  assert.deepEqual(destinations('Follow-up claimed?', 1), []);
  assert.deepEqual(destinations('SHEETS — Reserve Follow-Up'), ['Follow-up reserved']);
  assert.deepEqual(destinations('Follow-up reserved'), ['Publish Follow-up reserved']);
  assert.deepEqual(destinations('Publish Follow-up reserved'), ['GMAIL — Send Consented Follow-Up']);
  const claim = get('Claim consented follow-up');
  assert.equal(claim.parameters.method, 'POST');
  assert(claim.parameters.url.endsWith('/api/n8n/followups'));
  const row = { Lead_ID: 'qa-lead', Email: 'customer@example.com', Follow_Up_Due_UTC: '2026-10-20T00:00:00.000Z' };
  const expression = claim.parameters.jsonBody.slice(3, -2).trim();
  const body = new Function('$json', '$execution', `return (${expression});`)(row, { id: 'qa-execution' });
  assert.deepEqual(body, { action: 'claim', leadId: row.Lead_ID, email: row.Email, followUpDue: row.Follow_Up_Due_UTC, executionId: 'qa-execution', capabilities: ['approved-followups-v1'] });
  assert.equal(get('SHEETS — Reserve Follow-Up').parameters.columns.value.Lead_ID, '={{ $json.leadId }}');
  for (const name of ['Follow-up reserved', 'SHEETS — Log Follow-Up Outcome'])
    assert(referenceNames(get(name).parameters).has('FILTER — Pending Consented Follow-Ups'), `Original row lineage missing on ${name}`);
  const reserved = new Function('$', '$json', '$execution', get('Follow-up reserved').parameters.jsCode)(
    name => { assert.equal(name, 'FILTER — Pending Consented Follow-Ups'); return { item: { json: row } }; }, {}, { id: 'qa-execution' },
  ).json;
  assert.equal(reserved.data.Execution_ID, 'qa-execution');
  assert.equal(reserved.data.Lead_ID, row.Lead_ID);
  assert.equal(reserved.data.Follow_Up_State, 'Reserved');
  const recipientExpression = get('GMAIL — Send Consented Follow-Up').parameters.sendTo.slice(3, -2).trim();
  const resultIdExpression = get('SHEETS — Log Follow-Up Outcome').parameters.columns.value.Lead_ID.slice(3, -2).trim();
  // Native HTTP/IF/Sheets nodes keep item pairing. Each downstream expression
  // must read the matched FILTER item rather than the first item in the scan.
  for (const selected of [row, { ...row, Lead_ID: 'second-lead', Email: 'second@example.com' }]) {
    const select = name => { assert(['FILTER — Pending Consented Follow-Ups', 'Claim consented follow-up'].includes(name)); return { item: { json: name === 'Claim consented follow-up' ? { email: selected.Email } : selected } }; };
    assert.equal(new Function('$', `return (${recipientExpression});`)(select), selected.Email);
    assert.equal(new Function('$', `return (${resultIdExpression});`)(select), selected.Lead_ID);
  }
});

test('a configured CRM host updates every CRM endpoint together and leaves Google API addresses unchanged', () => {
  const origin = 'https://crm.example.test';
  const { workflow: hosted } = combineWorkflows(sources, { crmBaseUrl: origin + '/' });
  const localNodes = new Map(workflow.nodes.map(node => [node.name, node]));
  let crmEndpoints = 0, googleEndpoints = 0;
  for (const node of hosted.nodes) {
    const local = localNodes.get(node.name);
    const url = local.parameters.url;
    if (typeof url !== 'string') continue;
    if (url.startsWith('http://host.docker.internal:3001/api/n8n/')) {
      crmEndpoints++;
      assert.equal(node.parameters.url, origin + url.slice('http://host.docker.internal:3001'.length));
    } else if (url.includes('googleapis.com')) {
      googleEndpoints++;
      assert.equal(digest(node.parameters.url), digest(url), `Google endpoint changed for ${node.name}`);
    }
  }
  assert(crmEndpoints >= 15);
  assert(googleEndpoints >= 8);
  const bridge = hosted.nodes.find(node => node.name === 'Bridge settings');
  assert.equal(bridge.parameters.assignments.assignments.find(item => item.name === 'crmBaseUrl').value, origin);
  assert(!JSON.stringify(hosted.nodes.map(node => node.parameters)).includes('http://host.docker.internal:3001'));
  for (const crmBaseUrl of ['ftp://crm.example.test', origin + '/backend', 'https://user:password@crm.example.test', origin + '?query=yes', origin + '#fragment'])
    assert.throws(() => combineWorkflows(sources, { crmBaseUrl }), /HTTP\(S\) origin/);
  assert.equal(digest(sources), originalFingerprint);
});

test('all node identities, edges and literal cross-node references remain unique and resolvable', () => {
  assert.equal(validateUnified(workflow), true);
  const names = new Set(workflow.nodes.map(node => node.name));
  assert.equal(names.size, workflow.nodes.length);
  assert.equal(new Set(workflow.nodes.map(node => node.id)).size, workflow.nodes.length);
  for (const node of workflow.nodes) {
    if (node.type === 'n8n-nodes-base.code') assert.doesNotThrow(() => new Function(node.parameters.jsCode));
    for (const name of referenceNames(node.parameters)) assert(names.has(name), `Unresolved reference on ${node.name}: ${name}`);
  }
  for (const [from, output] of Object.entries(workflow.connections)) {
    assert(names.has(from));
    for (const branches of Object.values(output)) for (const edge of branches.flat()) assert(names.has(edge.node));
  }
  const broken = structuredClone(workflow);
  broken.nodes.find(node => node.name === 'System check complete').parameters.jsCode = "return $(\n  'Missing QA node'\n).all();";
  assert.throws(() => validateUnified(broken), /Unresolved node reference/);
  assert.equal(digest(sources), originalFingerprint);
});
