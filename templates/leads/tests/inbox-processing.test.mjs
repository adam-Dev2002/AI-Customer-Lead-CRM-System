import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { setupCode } from '../../../scripts/n8n/business-workflow.mjs';
import { addInboxReporting } from '../lib/connections/workflow-inbox.mjs';
import { createEmptyWorkspace } from '../lib/crm/new-workspace.ts';
import { applyAutomationEvent } from '../lib/crm/domain.ts';
import { inboxScanView } from '../lib/crm/inbox-scan.ts';

const now='2026-10-25T02:00:00.000Z', earlier='2026-10-25T01:59:00.000Z';
const fresh=()=>createEmptyWorkspace('QA isolated');
const event=(data,phase,extra={},id=phase)=>applyAutomationEvent(data,{eventId:id,type:'inbox.scan',data:{runId:'run-2',startedAt:earlier,phase,...extra}},now,()=>id);
function execute(code, context={}) { return vm.runInNewContext('(function(){'+code+'})()',context); }

test('business guard works inside a sandbox without URL and rejects unsafe origins',()=>{
  const settings={workspaceId:'12345678-1234-1234-1234-123456789abc',businessEmail:'qa@example.com',spreadsheetId:'qa_sheet_1234567890123456',geminiModel:'qa-model',crmBaseUrl:'https://crm.example.com'};
  const run=crmBaseUrl=>execute(setupCode,{URL:undefined,$input:{first:()=>({json:{...settings,crmBaseUrl}}),all:()=>[{json:settings}]}});
  assert.equal(run(settings.crmBaseUrl).length,1); assert.equal(run('https://crm.example.com:8443').length,1);
  for(const origin of ['http://crm.example.com','https://crm.example.com/','https://crm.example.com?token=x','https://user:pass@crm.example.com','https://crm.example.com/path','https://crm.example.com#x','https://crm.example.com:99999','https://crm.example.com:0','https://crm.example.com:443','https://bad..example.com','https://-bad.example.com','https://CRM.example.com','https://crm.example.com\n']) assert.throws(()=>run(origin),/HTTPS CRM origin/);
});
test('inbox events validate, deduplicate and cannot fabricate inquiries or delivery',()=>{
  const a=fresh(),b=fresh(); event(a,'checking');event(a,'processing',{matched:3,current:1});
  assert.equal(inboxScanView(a.inboxScan,Date.parse(now)).title,'Processing email 1 of 3');
  assert(event(a,'checking',{},'checking').duplicate);
  event(a,'complete',{matched:3}); assert.equal(a.activities.length,1);assert.equal(a.activities[0].status,'success');
  assert.equal(a.lastAutomationEventAt,'','scan telemetry is distinct from an actual inquiry event');
  assert.equal(a.leads.length,0); assert.equal(a.mailJobs.length,0);assert(!b.inboxScan);
  for(const extra of [{runId:'<script>'},{startedAt:'bad'},{phase:'sent'},{matched:-1},{matched:1001},{current:2,matched:1},{startedAt:'2030-01-01'}])assert.throws(()=>event(fresh(),'checking',extra),/valid inbox/);
});
test('late callbacks never regress current progress; failures beat late success in the same run',()=>{
  const data=fresh(); event(data,'processing',{matched:3,current:2},'p2');event(data,'processing',{matched:3,current:1},'p1');assert.equal(data.inboxScan.current,2);
  event(data,'checking',{},'late-start');assert.equal(data.inboxScan.phase,'processing');
  event(data,'complete',{matched:3},'done'); event(data,'failed',{code:'gmail-access'},'fail');event(data,'complete',{matched:3},'late-done');assert.equal(data.inboxScan.phase,'failed');
  event(data,'checking',{runId:'old',startedAt:'2026-10-25T01:58:00Z'},'old');assert.equal(data.inboxScan.runId,'run-2');
  assert(!JSON.stringify(data.inboxScan).includes('provider-response'));
});
test('empty, unavailable, busy and stalled scans are honest and recover on the next new run',()=>{
  const data=fresh();event(data,'complete',{matched:0});assert.match(inboxScanView(data.inboxScan,Date.parse(now)).title,/no new/);
  assert.equal(inboxScanView(data.inboxScan,Date.parse(now)+9*60000).state,'delayed');
  event(data,'failed',{code:'arbitrary-provider-response'},'failure');assert.equal(data.inboxScan.code,'processing-failed');
  const malicious=fresh();event(malicious,'failed',{code:'__proto__'});assert.equal(malicious.inboxScan.code,'processing-failed');
  event(data,'checking',{runId:'new',startedAt:now},'new');assert.equal(inboxScanView(data.inboxScan,Date.parse(now)).state,'running');
  assert.equal(inboxScanView(undefined).state,'waiting');
});
test('workflow reports real checks, empty results, per-email progress and read failures without changing sending',async()=>{
  const template=JSON.parse(await readFile(new URL('../lib/connections/workflow-template.json',import.meta.url),'utf8'));
  const before=structuredClone(template.workflow), workflow=addInboxReporting(template.workflow,'qa-crm');
  const find=name=>workflow.nodes.find(n=>n.name===name);
  const start={runId:'42',startedAt:earlier,phase:'checking'};
  const context={$execution:{id:'42'},$runIndex:0,$input:{all:()=>[],first:()=>({json:{}})},$:name=>({first:()=>({json:name==='Business connection'?{_businessPath:'business-path-1'}:{data:start}})})};
  const empty=execute(find('Inbox messages found').parameters.jsCode,context)[0].json;assert.equal(empty.data.phase,'complete');assert.equal(empty.data.matched,0);
  const matched=execute(find('Inbox messages found').parameters.jsCode,{...context,$input:{all:()=>[{json:{id:'a'}},{json:{id:'b'}}]}})[0].json;assert.equal(matched.data.matched,2);assert.equal(matched.data.phase,'processing');
  const failure=execute(find('Inbox failure — fetching').parameters.jsCode,{...context,$input:{first:()=>({json:{error:{message:'401 provider-response secret@example.com'}}})}})[0].json;
  assert.equal(failure.data.code,'gmail-access');assert(!JSON.stringify(failure).includes('secret@example.com'));assert(!JSON.stringify(failure).includes('provider-response'));
  const busy=execute(find('Inbox failure — fetching').parameters.jsCode,{...context,$input:{first:()=>({json:{error:'429 quota'}})}})[0].json;assert.equal(busy.data.code,'gmail-busy');
  for(const node of before.nodes.filter(n=>/Send confirmed Gmail draft|Save confirmed Gmail draft|Claim queued reply|Send Consented Follow-Up/.test(n.name)))assert.deepEqual(find(node.name),node,'sending semantics must be preserved');
  assert.equal(find('Gmail — Find Unhandled Customer Emails').alwaysOutputData,true);
  assert.equal(workflow.nodes.filter(n=>n.type.endsWith('.scheduleTrigger')).length,4);
  assert.equal(workflow.connections['Gmail — Find Unhandled Customer Emails'].main[1][0].node,'Inbox failure — fetching');
  for (const name of ['LOOP — One Email At A Time','IF — Eligible Customer Email?','CHECK — Email AI Enabled?','IF — Create Customer Draft?']) {
    assert.deepEqual(workflow.connections[name].main.slice(0,2),before.connections[name].main,'both normal branches must survive error reporting: '+name);
    assert.equal(workflow.connections[name].main[2][0].node,'Inbox failure — processing');
  }
  const count=workflow.nodes.length;addInboxReporting(workflow,'qa-crm');assert.equal(workflow.nodes.length,count,'instrumentation is idempotent');
});
