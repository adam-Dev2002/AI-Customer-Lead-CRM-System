// Builds the operator-controlled template from the already reviewed source.
// No account credentials or customer records are included in the artifact.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { businessSourceHash, buildBusinessWorkflow } from './n8n/business-workflow.mjs';
import { leadFields, reviewFields } from './n8n/upgrade-workflows.mjs';
const downloads = 'C:/Users/adamr/Downloads';
const candidates = (await fs.readdir(downloads)).filter(n => n.startsWith('ClearFlow ') && n.endsWith('(Gemini only) (1).json'));
assert.equal(candidates.length, 1, 'The reviewed workflow export is required.');
const raw = await fs.readFile(path.join(downloads, candidates[0]));
assert.equal(createHash('sha256').update(raw).digest('hex'), businessSourceHash, 'Review changed source before building.');
const source = JSON.parse(raw.toString().replace(/^\uFEFF/, ''));
const oldSheet = source.nodes.find(n => n.name === 'Bridge settings').parameters.assignments.assignments.find(a => a.name === 'spreadsheetId').value;
const built = buildBusinessWorkflow(source, { email: 'inbox@example.invalid', workspaceId: '00000000-0000-4000-a000-000000000001', crmOrigin: 'https://crm.example.invalid', geminiModel: 'configured-by-operator' });
let serialized = JSON.stringify(built.workflow).replaceAll(oldSheet, 'ORIGINAL_SHEET_NEVER_USE').replaceAll('ClearFlow Plumbing', 'Your business');
const addresses = new Set(serialized.match(/[A-Za-z0-9_.+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []);
for (const address of addresses) serialized = serialized.replaceAll(address, 'inbox@example.invalid');
// References to the original receiver are operator configuration, never inherited.
serialized = serialized.replaceAll('http://host.docker.internal:3001', 'https://crm.example.invalid').replaceAll('http://localhost:3001', 'https://crm.example.invalid');
const workflow = JSON.parse(serialized);
workflow.name = 'CustomerLead business service';
workflow.settings = { executionOrder: 'v1', timezone: 'Asia/Singapore', saveDataSuccessExecution: 'none', saveDataErrorExecution: 'none', saveManualExecutions: false };
workflow.nodes = workflow.nodes.filter(n => !n.type.endsWith('.stickyNote'));
for (const node of workflow.nodes.filter(n => n.type.endsWith('.formTrigger'))) {
  for (const field of node.parameters.formFields?.values || []) if (field.placeholder === 'inbox@example.invalid') field.placeholder = 'customer@example.com';
}
const roles = built.bindings.map(b => ({ node: b.node, type: b.type, role: b.type === 'gmailOAuth2' ? 'gmail' : b.type === 'googleSheetsOAuth2Api' ? 'sheets' : b.select === 'Business 2 - CRM' ? 'crm' : 'gemini' }));
assert(roles.every(r => workflow.nodes.some(n => n.name === r.node)));
assert(workflow.nodes.every(n => !n.credentials));
assert(!/AIza[\w-]{20,}|host\.docker\.internal|adamromas|clw_[\w-]{43}/i.test(JSON.stringify(workflow)));
const output = { version: 1, sourceHash: businessSourceHash, workflow, roles, leadHeaders: leadFields, reviewHeaders: reviewFields };
await fs.mkdir('templates/leads/lib/connections', { recursive: true });
await fs.writeFile('templates/leads/lib/connections/workflow-template.json', JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ nodes: workflow.nodes.length, bindings: roles.length, originalSourceUnchanged: true, secretsIncluded: false }));
