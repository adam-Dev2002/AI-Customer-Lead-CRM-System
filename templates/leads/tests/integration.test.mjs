import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSeed } from '../lib/crm/seed.ts';
import { applyMutation, applyAutomationEvent } from '../lib/crm/domain.ts';
import { pendingSyncChanges, workflowConfiguration, queueEmailMirrors } from '../lib/crm/integration.ts';
import { mergeLead, prepareGmail } from '../../../scripts/n8n/bridge-code.mjs';

const now='2026-10-19T04:00:00.000Z';
let sequence=0;
const makeId=()=>`sync-${++sequence}`;
const fresh=()=>createSeed(new Date(now));
const mutate=(d,action,payload)=>applyMutation(d,{action,payload},now,makeId);
function ownLead(d) { mutate(d,'lead.create',{name:'Sync Customer',email:'sync@example.com',service:'Drain repair',message:'Please inspect the drain.',consent:true}); return d.leads[0]; }

test('owner writes queue ordered snapshots and samples never queue external changes',()=>{
  const d=fresh();
  mutate(d,'lead.update',{id:d.leads[0].id,notes:'Sample edit'});
  assert.equal(d.syncChanges.length,0);
  const lead=ownLead(d);
  mutate(d,'lead.update',{id:lead.id,notes:'Owner note'});
  assert.equal(d.syncChanges.length,2);
  assert.deepEqual(d.syncChanges[1].fields,['Notes']);
  assert.equal(pendingSyncChanges(d).length,1);
  d.syncChanges[0].status='Failed';
  assert.equal(pendingSyncChanges(d).length,0);
  mutate(d,'sync.retry',{id:d.syncChanges[0].id});
  assert.equal(pendingSyncChanges(d)[0].id,d.syncChanges[0].id);
  d.syncChanges[0].status='Applied';
  assert.equal(pendingSyncChanges(d)[0].payload.Notes,'Owner note');
});

test('pending owner changes are protected from inbound overwrite and deleted leads stay archived',()=>{
  const d=fresh(),lead=ownLead(d);
  const event={eventId:'external-1',type:'lead.upsert',data:d.syncChanges[0].payload};
  assert.throws(()=>applyAutomationEvent(d,event,now,makeId),/outstanding CRM changes/);
  mutate(d,'lead.delete',{id:lead.id});
  assert.equal(d.syncChanges.at(-1).kind,'lead.archive');
  assert.equal(d.syncChanges.at(-1).payload.Consent,'No');
  assert.equal(applyAutomationEvent(d,event,now,makeId).ignored,true);
  assert.equal(d.leads.some(l=>l.id===lead.id),false);
});

test('email processing ingests lead and draft together with no inferred follow-up permission',()=>{
  const d=fresh();
  const event={eventId:'support-1',type:'support.processed',data:{Lead_ID:'GMAIL-1',Name:'Email Customer',Email:'customer@example.com',Service:'Blocked drain',Message:'Could you inspect the drain?',Consent:'No',Status:'New',Draft_ID:'DRAFT-1',Gmail_Draft_ID:'gmail-draft-1',Subject:'Re: Blocked drain',Body:'Thank you for your message. Could you share your location?',Run_Status:'success',Execution_ID:'101'}};
  assert.equal(applyAutomationEvent(d,event,now,makeId).duplicate,false);
  assert.equal(d.leads[0].consent,false);
  assert.equal(d.leads[0].followUpState,'Skipped');
  assert.equal(d.drafts[0].leadId,'GMAIL-1');
  assert.equal(d.activities[0].executionId,'101');
  assert.equal(applyAutomationEvent(d,event,now,makeId).duplicate,true);
  assert.equal(d.syncChanges.length,2);
  assert.deepEqual(d.syncChanges.map(c=>c.intent),['mirror.capture','mirror.capture']);
  assert.equal(d.syncChanges[0].payload.Consent,'No');
  assert.equal(d.syncChanges[1].payload.Gmail_Draft_ID,'gmail-draft-1');
});

test('email mirroring indexes existing inquiries once without replacing owner changes',()=>{
  const d=fresh();
  const lead=ownLead(d);
  mutate(d,'draft.create',{leadId:lead.id});
  const draft=d.drafts[0], originalLeadChange=d.syncChanges[0];
  const count=d.syncChanges.length;
  queueEmailMirrors(d,lead,draft,now,makeId);
  assert.equal(d.syncChanges.length,count);
  assert.equal(d.syncChanges[0],originalLeadChange);
  d.syncChanges=[];
  queueEmailMirrors(d,lead,draft,now,makeId);
  queueEmailMirrors(d,lead,draft,now,makeId);
  assert.equal(d.syncChanges.length,2);
  assert.equal(d.syncChanges[1].intent,'mirror.capture');
});

test('an email without an AI draft still queues its lead for Sheets',()=>{
  const d=fresh();
  applyAutomationEvent(d,{eventId:'no-ai',type:'support.processed',data:{Lead_ID:'GMAIL-NO-AI',Name:'Email Customer',Email:'customer@example.com',Service:'Inspection',Message:'Please inspect the tap.',Source:'Gmail',Consent:'No'}},now,makeId);
  assert.equal(d.syncChanges.length,1);
  assert.equal(d.syncChanges[0].kind,'lead.upsert');
  assert.equal(d.syncChanges[0].payload.Source,'Gmail');
});

test('shared configuration respects the email master setting and settings validate scan limits',()=>{
  const d=fresh();
  assert.equal(workflowConfiguration(d).send_emails_enabled,false);
  mutate(d,'settings.update',{...d.settings,primaryAI:'openai',maxEmailsPerScan:20,automaticEmailsEnabled:true,ownerNotifications:false});
  const config=workflowConfiguration(d);
  assert.equal(config.primary_ai,'openai');
  assert.equal(config.max_emails_per_scan,20);
  assert.equal(config.send_emails_enabled,true);
  assert.equal(config.send_owner_alert,false);
  assert.throws(()=>mutate(d,'settings.update',{...d.settings,maxEmailsPerScan:1.5}),/whole numbers/);
});

test('Sheets merge preserves automated delivery outcomes and blocks rescheduling claimed follow-ups',()=>{
  const d=fresh(),lead=ownLead(d);
  mutate(d,'lead.update',{id:lead.id,notes:'Owner note'});
  let change=d.syncChanges.at(-1);
  const old={...d.syncChanges[0].payload,Notes:'Old note',Follow_Up_State:'Sent',Acknowledgement_Status:'Sent',AI_Summary:'External summary'};
  const execute=()=>new Function('$','$input',mergeLead)(()=>({item:{json:change}}),{all:()=>[{json:old}]})[0].json;
  let row=execute();
  assert.equal(row.Notes,'Owner note');
  assert.equal(row.Follow_Up_State,'Sent');
  assert.equal(row.Acknowledgement_Status,'Sent');
  assert.equal(row.AI_Summary,'External summary');
  change={...change,intent:'followup.reschedule',fields:['Follow_Up_State']};
  assert.match(execute()._syncError,/already reserved or sent/);
});

test('Gmail updates protect recipients and attachments and encode Unicode replies',()=>{
  const change={payload:{Email:'customer@example.com',Subject:'Your café inquiry',Body:'Thank you — we will review the details.',Gmail_Draft_ID:'draft1',Gmail_Thread_ID:'thread1'}};
  let current={id:'draft1',message:{threadId:'thread1',payload:{headers:[{name:'To',value:'Customer <customer@example.com>'}]}}};
  const execute=()=>new Function('$','$json','Buffer',prepareGmail)(()=>({item:{json:change}}),current,Buffer).json;
  const mime=Buffer.from(execute().gmailBody.message.raw,'base64url').toString('utf8');
  assert(mime.includes('\r\n\r\n'));
  assert(mime.includes('Content-Transfer-Encoding: base64'));
  assert(mime.includes(Buffer.from(change.payload.Subject).toString('base64')));
  current.message.payload.parts=[{filename:'photo.jpg'}];
  assert.match(execute()._syncError,/attachments/);
  delete current.message.payload.parts;
  current.message.payload.headers[0].value='other@example.com';
  assert.match(execute()._syncError,/recipient differs/);
  current.message.payload.headers[0].value='';
  assert(Buffer.from(execute().gmailBody.message.raw,'base64url').toString('utf8').includes('To: customer@example.com\r\n'));
});

test('late capture/delivery events preserve owner edits and confirmed follow-up sends',()=>{
  const d=fresh(),lead=ownLead(d);
  lead.followUpState='Sent';
  lead.followUpSentAt=now;
  const row={...d.syncChanges[0].payload,Acknowledgement_Status:'Sent',Owner_Alert_Status:'Sent'};
  applyAutomationEvent(d,{eventId:'delivery',type:'lead.delivery',data:row},now,makeId);
  assert.equal(lead.acknowledgementStatus,'Sent');
  assert.equal(lead.followUpState,'Sent');
  const ignored=applyAutomationEvent(d,{eventId:'late-capture',type:'lead.upsert',data:{...row,Create_Only:true}},now,makeId);
  assert.equal(ignored.ignored,true);
  assert.equal(applyAutomationEvent(d,{eventId:'late-reservation',type:'followup.updated',data:{Lead_ID:lead.id,Follow_Up_State:'Reserved'}},now,makeId).ignored,true);
});

test('support events accept the documented event-ID length and ignore archived inquiries',()=>{
  const d=fresh(),data={Lead_ID:'GMAIL-BOUNDARY',Name:'Email Customer',Email:'boundary@example.com',Service:'Drain repair',Message:'Please inspect the drain.',Draft_ID:'BOUNDARY-DRAFT',Subject:'Your inquiry',Body:'Thank you for sharing the details.'};
  applyAutomationEvent(d,{eventId:'x'.repeat(180),type:'support.processed',data},now,makeId);
  assert.equal(d.drafts[0].id,'BOUNDARY-DRAFT');
  mutate(d,'lead.delete',{id:data.Lead_ID});
  assert.equal(applyAutomationEvent(d,{eventId:'archived-support',type:'support.processed',data},now,makeId).ignored,true);
});

test('downloaded workflows contain valid connections, no credentials, and no email send nodes',()=>{
  for(const file of ['customerlead-sync-bridge.json','customerlead-event-adapters.json','customerlead-form-nodes.json','customerlead-email-nodes.json']) {
    const workflow=JSON.parse(readFileSync(new URL(`../public/integrations/${file}`,import.meta.url),'utf8'));
    assert.equal(workflow.active,false);
    const names=new Set(workflow.nodes.map(n=>n.name));
    for(const node of workflow.nodes) {
      assert.equal(node.credentials,undefined);
      if(node.type==='n8n-nodes-base.code') assert.doesNotThrow(()=>new Function(node.parameters.jsCode));
      assert(!/send/i.test(String(node.parameters.operation || '')));
    }
    for(const [from,connections] of Object.entries(workflow.connections)) {
      assert(names.has(from));
      for(const edge of connections.main.flat()) assert(names.has(edge.node));
    }
  }
});
