import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSeed } from '../lib/crm/seed.ts';
import { applyMutation, applyAutomationEvent } from '../lib/crm/domain.ts';
import { claimMail, prepareMail, finishMail } from '../lib/crm/mail.ts';
import { prepareMailDraft, mailResult } from '../../../scripts/n8n/mail-code.mjs';

const now = '2026-10-19T12:00:00.000Z';
let sequence = 0;
const makeId = () => `mail-${++sequence}`;
const mutate = (data, action, payload = {}) => applyMutation(data, {action,payload}, now, makeId);
function fixture() {
  const data = createSeed(new Date(now));
  mutate(data,'lead.create',{name:'Mail Customer',email:'customer@example.com',service:'Drain inspection',message:'Please inspect my drain.',consent:true});
  const lead = data.leads[0];
  mutate(data,'draft.create',{leadId:lead.id});
  const draft = data.drafts[0];
  mutate(data,'draft.approve',{id:draft.id,subject:'Re: Drain inspection',body:'Thank you for your inquiry. Please share your preferred time for an inspection.'});
  data.lastMailPollAt = now;
  data.mailSenderEmail = 'owner@example.com';
  return {data,lead,draft};
}
const send = ({data,lead,draft}, extra = {}) => mutate(data,'draft.send',{id:draft.id,subject:draft.subject,body:draft.body,email:lead.email,senderEmail:data.mailSenderEmail,confirmed:true,...extra});
const synced = data => data.syncChanges.forEach(c=>c.status='Applied');
const claim = (data, executionId='exec-1') => claimMail(data,{executionId,senderEmail:'owner@example.com'},now).job;

test('approval and enabled automatic-email settings never queue a manual reply',()=>{
  const f=fixture();
  mutate(f.data,'settings.update',{...f.data.settings,automaticEmailsEnabled:true,aiClassification:true});
  assert.equal(f.draft.status,'Approved');
  assert.equal(f.data.mailJobs.length,0);
});

test('manual sends require confirmation, approval, connection and the exact reviewed recipient/body',()=>{
  const f=fixture();
  assert.throws(()=>send(f,{confirmed:false}),/Confirm the recipient/);
  assert.throws(()=>send(f,{body:'A changed reply that was not approved.'}),/reply or recipient changed/);
  assert.throws(()=>send(f,{email:'different@example.com'}),/reply or recipient changed/);
  f.data.lastMailPollAt='';
  assert.throws(()=>send(f),/Connect the manual Gmail sender/);
  f.data.lastMailPollAt=now;
  f.lead.isSample=true;
  assert.throws(()=>send(f),/Sample inquiries/);
  f.lead.isSample=false;
  f.draft.status='Pending review';
  assert.throws(()=>send(f),/Save and approve/);
  f.draft.status='Approved'; f.lead.followUpState='Reserved';
  assert.throws(()=>send(f),/follow-up is already being processed/);
  assert.equal(f.data.mailJobs.length,0);
});

test('queueing cancels pending follow-up, locks the draft, and supports cancellation before claim',()=>{
  const f=fixture(); send(f);
  assert.equal(f.lead.followUpState,'Skipped');
  assert.equal(f.data.syncChanges.at(-1).intent,'followup.cancel');
  assert.equal(f.data.mailJobs[0].status,'Queued');
  assert.throws(()=>send(f),/already has a delivery request/);
  assert.throws(()=>mutate(f.data,'draft.save',{id:f.draft.id,body:'An attempt to change a queued email.'}),/delivery request/);
  assert.throws(()=>mutate(f.data,'lead.delete',{id:f.lead.id}),/Cancel the queued reply/);
  mutate(f.data,'mail.cancel',{id:f.data.mailJobs[0].id});
  assert.equal(f.data.mailJobs[0].status,'Cancelled');
  mutate(f.data,'draft.save',{id:f.draft.id,body:f.draft.body});
});

test('claims wait for sync, persist one execution owner, and never reclaim a sending job',()=>{
  const f=fixture(); send(f);
  assert.equal(claim(f.data),null);
  synced(f.data);
  const job=claim(f.data);
  assert.equal(job.status,'Sending');
  assert.equal(claim(f.data,'exec-2'),null);
  assert.equal(claim(f.data,'exec-1'),null);
  assert.throws(()=>mutate(f.data,'mail.cancel',{id:job.id}),/Only a reply still in the queue/);
  assert.throws(()=>prepareMail(f.data,{jobId:job.id,executionId:'another-exec',gmailDraftId:'draft-1'},now),/does not own/);
});

test('recipient changes after confirmation stop delivery rather than silently redirecting it',()=>{
  const f=fixture(); send(f); synced(f.data); f.lead.email='changed@example.com';
  assert.equal(claim(f.data),null);
  assert.equal(f.data.mailJobs[0].status,'Needs Review');
  assert.match(f.data.mailJobs[0].detail,/Nothing was sent/);
});

test('a different sending Gmail account cannot replace the account confirmed by the owner',()=>{
  const f=fixture(); send(f); synced(f.data);
  assert.equal(claimMail(f.data,{executionId:'exec-other',senderEmail:'other-owner@example.com'},now).job,null);
  assert.equal(f.data.mailJobs[0].status,'Needs Review');
  assert.equal(f.data.mailJobs[0].senderEmail,'owner@example.com');
});

test('the oldest ready reply is claimed first and an execution cannot claim a second job',()=>{
  const f=fixture(); send(f); synced(f.data);
  const original=f.data.mailJobs[0];
  f.data.mailJobs.unshift({...original,id:'newer-job',draftId:'newer-draft'});
  f.data.drafts.unshift({...f.draft,id:'newer-draft'});
  assert.equal(claim(f.data).id,original.id);
  assert.equal(claim(f.data),null);
  assert.equal(claim(f.data,'exec-2').id,'newer-job');
});

test('Sent requires a prepared draft and message ID; duplicate callbacks do not duplicate effects',()=>{
  const f=fixture(); send(f); synced(f.data); const job=claim(f.data);
  const result={jobId:job.id,executionId:job.executionId,status:'Sent',gmailMessageId:'message-1',gmailThreadId:'thread-1'};
  assert.throws(()=>finishMail(f.data,result,now,makeId),/prepared draft/);
  prepareMail(f.data,{jobId:job.id,executionId:job.executionId,gmailDraftId:'draft-1'},now);
  assert.throws(()=>finishMail(f.data,{...result,gmailMessageId:''},now,makeId),/message ID/);
  assert.equal(finishMail(f.data,result,now,makeId).duplicate,false);
  const count=f.data.syncChanges.length, activityCount=f.data.activities.length;
  assert.equal(finishMail(f.data,result,now,makeId).duplicate,true);
  assert.equal(f.data.syncChanges.length,count);
  assert.equal(f.data.activities.length,activityCount);
  assert.equal(f.lead.status,'Contacted');
  assert.equal(f.lead.gmailThreadId,'thread-1');
  assert.equal(f.data.mailJobs[0].gmailMessageId,'message-1');
  assert.throws(()=>send(f),/already has a delivery request/);
});

test('uncertain sends never retry without an explicit owner review',()=>{
  const f=fixture(); send(f); synced(f.data); const job=claim(f.data);
  finishMail(f.data,{jobId:job.id,executionId:job.executionId,status:'Needs Review',detail:'Timeout; check Sent.'},now,makeId);
  assert.equal(claim(f.data,'exec-2'),null);
  assert.throws(()=>send(f),/already has a delivery request/);
  assert.throws(()=>mutate(f.data,'mail.resolve',{id:job.id}),/confirm this reply was not sent/);
  mutate(f.data,'mail.resolve',{id:job.id,confirmedNotSent:true});
  send(f);
  assert.equal(f.data.mailJobs[0].status,'Queued');
});

test('Gmail draft preparation encodes Unicode, preserves reply headers, and blocks attachments or changed recipients',()=>{
  const job={id:'job1',to:'customer@example.com',senderEmail:'owner@example.com',subject:'Re: Café inquiry',body:'Thank you — please share a suitable time.',createdAt:now,gmailDraftId:'draft-1',gmailThreadId:'thread-1'};
  const profile={emailAddress:'owner@example.com'};
  const selectors=name=>({first:()=>({json:name==='Claim approved reply' ? {job} : profile})});
  const current={id:'draft-1',message:{threadId:'thread-1',payload:{headers:[{name:'To',value:job.to},{name:'Subject',value:job.subject},{name:'In-Reply-To',value:'<original@example.com>'},{name:'References',value:'<original@example.com>'}]}}};
  const execute=()=>new Function('$','$json','Buffer',prepareMailDraft)(selectors,current,Buffer).json;
  let result=execute();
  const mime=Buffer.from(result.gmailBody.message.raw,'base64url').toString('utf8');
  assert(mime.includes('From: owner@example.com\r\n'));
  assert(mime.includes('In-Reply-To: <original@example.com>'));
  assert(mime.includes(Buffer.from(job.body).toString('base64')));
  assert.equal(result.gmailBody.id,'draft-1');
  assert.equal(result.gmailBody.message.threadId,'thread-1');
  current.message.payload.parts=[{filename:'image.jpg'}];
  assert.match(execute()._mailError,/attachments/);
  delete current.message.payload.parts;
  current.message.payload.headers[0].value='another@example.com';
  assert.match(execute()._mailError,/recipient differs/);
  current.message.payload.headers[0].value='';
  assert(Buffer.from(execute().gmailBody.message.raw,'base64url').toString('utf8').includes('To: customer@example.com\r\n'));
  current.message.payload.headers[0].value=job.to;
  current.message.payload.headers.push({name:'Cc',value:'copy@example.com'});
  assert.match(execute()._mailError,/copied recipients/);
});

test('new replies can prepare drafts without an existing Gmail draft, including a verified thread',()=>{
  const job={id:'job2',to:'customer@example.com',senderEmail:'owner@example.com',subject:'Re: Inspection',body:'Please share your preferred inspection time.',createdAt:now,gmailDraftId:'',gmailThreadId:''};
  const selectors=name=>({first:()=>({json:name==='Claim approved reply' ? {job} : {emailAddress:job.senderEmail}})});
  const execute=current=>new Function('$','$json','Buffer',prepareMailDraft)(selectors,current,Buffer).json;
  assert.equal(execute({emailAddress:job.senderEmail}).gmailBody.id,undefined);
  job.gmailThreadId='thread-2';
  const context={id:'thread-2',messages:[{payload:{headers:[{name:'From',value:job.to},{name:'Subject',value:'Inspection'},{name:'Message-ID',value:'<inquiry@example.com>'}]}}]};
  const result=execute(context);
  assert.equal(result.gmailBody.message.threadId,'thread-2');
  assert(Buffer.from(result.gmailBody.message.raw,'base64url').toString().includes('In-Reply-To: <inquiry@example.com>'));
  context.messages[0].payload.headers[0].value='other@example.com';
  assert.match(execute(context)._mailError,/recipient is not present/);
});

test('owner-confirmed deleted links cancel a queued send and preserve its text for fresh review',()=>{
  const d=createSeed(new Date(now));
  applyAutomationEvent(d,{eventId:'missing-link',type:'support.processed',data:{Lead_ID:'GMAIL-DELETED',Name:'QA Customer',Email:'qa@example.com',Service:'Inspection',Message:'Please inspect the tap.',Source:'Gmail',Gmail_Thread_ID:'deleted-thread',Draft_ID:'DELETED-DRAFT',Gmail_Draft_ID:'deleted-draft',Subject:'Re: Inspection',Body:'Thank you. Please share your preferred inspection time.'}},now,makeId);
  const draft=d.drafts[0],body=draft.body;
  const id=makeId;
  assert.throws(()=>applyMutation(d,{action:'draft.unlink',payload:{id:draft.id}},now,id),/Confirm/);
  d.mailJobs.push({id:'queued-test',draftId:draft.id,leadId:draft.leadId,status:'Queued',updatedAt:now});
  applyMutation(d,{action:'draft.unlink',payload:{id:draft.id,confirmedUnavailable:true,clearThread:true}},now,id);
  assert.equal(d.mailJobs[0].status,'Cancelled');
  assert.equal(draft.gmailDraftId,'');
  assert.equal(draft.body,body);
  assert.equal(draft.status,'Pending review');
  assert.equal(d.leads[0].gmailThreadId,'');
  assert(d.syncChanges.filter(c=>c.entityId===`draft:${draft.id}`&&c.status!=='Applied').every(c=>c.payload.Gmail_Draft_ID===''));
  d.mailJobs[0].status='Sending';
  assert.throws(()=>applyMutation(d,{action:'draft.unlink',payload:{id:draft.id,confirmedUnavailable:true}},now,id),/Review this reply/);
});

test('long Unicode subjects use valid folded MIME encoded words',()=>{
  const subject='Inspection ' + '维修'.repeat(100);
  const job={id:'unicode-job',to:'customer@example.com',senderEmail:'owner@example.com',subject,body:'Please share your inspection details.',createdAt:now,gmailDraftId:'',gmailThreadId:''};
  const selectors=name=>({first:()=>({json:name==='Claim approved reply' ? {job} : {emailAddress:job.senderEmail}})});
  const result=new Function('$','$json','Buffer',prepareMailDraft)(selectors,{emailAddress:job.senderEmail},Buffer).json;
  const mime=Buffer.from(result.gmailBody.message.raw,'base64url').toString('utf8');
  const words=[...mime.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)];
  assert(words.length>1);
  assert(words.every(w=>w[0].length<=75));
  assert.equal(words.map(w=>Buffer.from(w[1],'base64').toString('utf8')).join(''),subject);
});

test('the downloadable sender has no credentials, valid connections, one non-retrying draft send, and truthful result mapping',()=>{
  const flow=JSON.parse(readFileSync(new URL('../public/integrations/customerlead-manual-gmail-sender.json',import.meta.url),'utf8'));
  assert.equal(flow.active,false);
  const names=new Set(flow.nodes.map(n=>n.name));
  for(const node of flow.nodes) {
    assert.equal(node.credentials,undefined);
    if(node.type==='n8n-nodes-base.code') assert.doesNotThrow(()=>new Function(node.parameters.jsCode));
  }
  for(const [from,connections] of Object.entries(flow.connections)) {
    assert(names.has(from));
    for(const edge of connections.main.flat()) assert(names.has(edge.node));
  }
  const sender=flow.nodes.find(n=>n.name==='Send confirmed Gmail draft');
  assert.equal(sender.parameters.url,'https://gmail.googleapis.com/gmail/v1/users/me/drafts/send');
  assert.equal(sender.retryOnFail,false);
  assert.equal(flow.nodes.find(n=>n.name==='Claim approved reply').retryOnFail,false);
  const selectors=()=>({first:()=>({json:{job:{id:'job-1'}}})});
  const result=current=>new Function('$','$json','$execution',mailResult)(selectors,current,{id:'exec-1'}).json;
  assert.equal(result({id:'message-1'}).status,'Sent');
  assert.equal(result({error:'timeout'}).status,'Needs Review');
});

test('the two-workflow bridge combines sync and sending behind one manual trigger and one timer',()=>{
  const flow=JSON.parse(readFileSync(new URL('../public/integrations/customerlead-sync-and-send-bridge.json',import.meta.url),'utf8'));
  assert.equal(flow.active,false);
  assert.equal(flow.nodes.filter(n=>n.type==='n8n-nodes-base.scheduleTrigger').length,1);
  assert.equal(flow.nodes.filter(n=>n.type==='n8n-nodes-base.manualTrigger').length,1);
  const names=new Set(flow.nodes.map(n=>n.name));
  assert.equal(names.size,flow.nodes.length);
  for(const n of flow.nodes) {
    assert.equal(n.credentials,undefined);
    if(n.type==='n8n-nodes-base.code') assert.doesNotThrow(()=>new Function(n.parameters.jsCode));
  }
  for(const [from,edges] of Object.entries(flow.connections)) {
    assert(names.has(from));
    for(const edge of edges.main.flat()) assert(names.has(edge.node));
  }
  for(const name of ['Manual connection test','Poll every minute']) {
    assert.deepEqual(flow.connections[name].main[0].map(e=>e.node),['Bridge settings','Read sending Gmail account']);
  }
  for(const name of ['Save shared lead','Save reply review']) {
    const node=flow.nodes.find(n=>n.name===name);
    assert.equal(node.parameters.operation,'appendOrUpdate');
    assert.deepEqual(node.parameters.columns.matchingColumns,[name==='Save shared lead'?'Lead_ID':'Draft_ID']);
  }
  assert.equal(flow.nodes.find(n=>n.name==='Send confirmed Gmail draft').retryOnFail,false);
});
