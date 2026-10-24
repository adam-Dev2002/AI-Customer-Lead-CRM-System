// Maintainer-only repair for the reviewed first self-service template. Default
// is read-only. Secrets and the workflow backup remain encrypted and ignored.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { connectionConfig, sealConnection } from '../templates/leads/lib/connections/config.ts';
import { connectionRepository } from '../templates/leads/lib/connections/store.ts';
import { provisionedWorkflow } from '../templates/leads/lib/connections/workflow.ts';
import { workflowDigest } from '../templates/leads/lib/connections/workflow-integrity.mjs';
import { cloudRequest } from '../templates/leads/lib/crm/cloud-store.ts';

const workspace = process.argv[process.argv.indexOf('--workspace') + 1];
assert(process.argv.includes('--workspace') && /^[a-f0-9-]{36}$/.test(workspace), 'Choose a self-service workspace UUID.');
const config = connectionConfig(); assert(config?.mode === 'pull', 'Choose the existing local Docker connection.');
const record = await connectionRepository(workspace, config).read(), data = record.data;
assert(data?.workflowId && !data.pending && data.verifiedAt && ['active','paused','ready'].includes(data.phase), 'Finish or reconcile pending setup first.');
const worker = JSON.parse(await readFile('private-integrations/local-onboarding/worker.json', 'utf8'));
assert(worker.crmOrigin === config.origin && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(worker.n8nOrigin));
async function n8n(path, body, method = 'GET') {
  const response = await fetch(worker.n8nOrigin + '/api/v1/workflows/' + data.workflowId + path, { method, headers: { 'X-N8N-API-KEY': worker.apiKey, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000), redirect: 'error' });
  assert(response.ok, 'n8n update/read was not confirmed (HTTP ' + response.status + '). Inspect state before retrying.');
  return response.json();
}
const saved = await n8n(''), next = provisionedWorkflow(data, workspace, config);
assert.equal(saved.name, next.name, 'Wrong business workflow.');
if (workflowDigest(saved) === workflowDigest(next)) { console.log('Inbox reporting is already installed. No change.'); process.exit(0); }
const previous = provisionedWorkflow(data, workspace, config, false);
const guard = previous.nodes.find(n => n.name === 'Validate business setup');
guard.parameters.jsCode = guard.parameters.jsCode.slice(0, guard.parameters.jsCode.indexOf('// The n8n Code sandbox')) + "if(new URL(s.crmBaseUrl).origin!==s.crmBaseUrl||!s.crmBaseUrl.startsWith('https://')) throw new Error('Use the HTTPS CRM origin without a trailing slash.');\nreturn $input.all();";
assert.equal(workflowDigest(saved), workflowDigest(previous), 'The live graph differs from the reviewed original. Stop for review.');
const response = await cloudRequest('/rest/v1/crm_workspace_state?workspace_id=eq.' + workspace + '&select=data');
const rows = await response.json(), crm = rows[0]?.data;
assert(crm && !crm.settings.automaticEmailsEnabled && !crm.mailJobs.some(j=>['Queued','Sending'].includes(j.status)), 'Pause outgoing automation and finish pending deliveries before upgrading.');
const jobsResponse = await cloudRequest('/rest/v1/crm_connection_jobs?workspace_id=eq.' + workspace + '&status=in.(Queued,Claimed)&select=id');
assert.deepEqual(await jobsResponse.json(), [], 'Reconcile pending onboarding operations first.');
console.log(JSON.stringify({ reviewed: true, workspace, workflow: saved.id, beforeNodes: saved.nodes.length, afterNodes: next.nodes.length, resumePreviouslyEnabled: Boolean(saved.active), automaticEmail: false, apply: process.argv.includes('--apply') }));
if (!process.argv.includes('--apply')) process.exit(0);
const directory='private-integrations/local-onboarding/recovery-backups'; await mkdir(directory,{recursive:true});
await writeFile(directory+'/inbox-upgrade-'+Date.now()+'.enc',sealConnection({workflow:saved,connection:record},workspace,config.encryptionKey),{mode:0o600,flag:'wx'});
const wasActive=Boolean(saved.active);
if (wasActive) await n8n('/deactivate',{},'POST');
assert(!(await n8n('')).active, 'Deactivation was not confirmed.');
await n8n('',{...next,settings:{...saved.settings,...next.settings}},'PUT');
assert.equal(workflowDigest(await n8n('')),workflowDigest(next),'Updated graph was not confirmed. Leave paused for review.');
if (wasActive) await n8n('/activate',{},'POST');
const final=await n8n('');assert.equal(Boolean(final.active),wasActive);assert.equal(workflowDigest(final),workflowDigest(next));
console.log(JSON.stringify({upgraded:true,active:final.active,workflowIdPreserved:final.id===saved.id,mailSentByUpgrade:false}));
