import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import * as code from './n8n/bridge-code.mjs';
import * as mailCode from './n8n/mail-code.mjs';
import { readReviewedWorkflow } from './n8n/workflow-reference.mjs';

const { publicReference } = readReviewedWorkflow();

const output = fileURLToPath(new URL('../templates/leads/public/integrations/', import.meta.url));
mkdirSync(output, {recursive:true});
const base = 'http://host.docker.internal:3001';
function graph(name) {
  const workflow = {name, nodes:[], connections:{}, active:false, settings:{executionOrder:'v1'}, pinData:{}, tags:[]};
  const add = (name, type, parameters, position, extra = {}) => { workflow.nodes.push({id:randomUUID(),name,type:`n8n-nodes-base.${type}`,typeVersion:({httpRequest:4.2,googleSheets:4.7,if:2.2,set:3.4,code:2,scheduleTrigger:1.2,splitInBatches:3,stickyNote:1})[type] || 1,parameters,position,...extra}); return name; };
  const link = (from,to,branch=0) => { const edges = workflow.connections[from] ||= {main:[]}; while(edges.main.length<=branch) edges.main.push([]); edges.main[branch].push({node:to,type:'main',index:0}); };
  return {workflow,add,link};
}
const http = (url, method='GET', body) => ({method,url,authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',...(body ? {sendBody:true,specifyBody:'json',jsonBody:body} : {}),options:{timeout:15000}});
const bool = expression => ({conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:2},conditions:[{id:randomUUID(),leftValue:`={{ ${expression} }}`,rightValue:true,operator:{type:'boolean',operation:'true',singleValue:true}}],combinator:'and'},options:{}});
const js = (jsCode, mode='runOnceForEachItem') => ({mode,jsCode});
const credentialNote = 'Select the CustomerLead HTTP Header Auth credential: Authorization = Bearer <private token>. No token is included in this file.';
const retry = {retryOnFail:true,maxTries:3,waitBetweenTries:1000,notes:credentialNote};
const schema = (keys,match) => keys.map(id => ({id,displayName:id,required:false,defaultMatch:id===match,canBeUsedToMatch:true,display:true,type:'string'}));
const sheet = (operation,tab,match,keys) => ({operation,documentId:{__rl:true,value:"={{ $('Bridge settings').first().json.spreadsheetId }}",mode:'id'},sheetName:{__rl:true,value:`={{ $('Bridge settings').first().json.${tab} }}`,mode:'name'},...(match ? {columns:{mappingMode:'autoMapInputData',value:{},matchingColumns:[match],schema:schema(keys,match),attemptToConvertTypes:false,convertFieldsToString:false}} : {}),options:{cellFormat:'RAW',handlingExtraData:'ignoreIt'}});
const leadFields = ['Lead_ID','Created_At_UTC','Name','Email','Phone','Service','Message','Source','Consent','Status','Priority','Follow_Up_Due_UTC','Follow_Up_State','Follow_Up_Sent_UTC','Owner','Notes','Acknowledgement_Status','Owner_Alert_Status','Category','AI_Summary','Gmail_Thread_ID'];
const reviewFields = ['Draft_ID','Lead_ID','Gmail_Draft_ID','Gmail_Thread_ID','Email','Subject','Body','Review_Status','Updated_At_UTC'];

const {workflow,add,link} = graph('CustomerLead — Sheets write-back & Gmail draft review bridge');
add('Setup notes','stickyNote',{content:'# CustomerLead sync bridge\nInactive until you configure it. Set the spreadsheet ID below. Prepare Leads + ReplyReviews headers using the connection guide. Select CRM Header Auth and Google credentials. Run ONE bridge execution at a time.\n\nThis workflow writes Sheets and updates existing plain-text Gmail drafts. It has NO email send operation. Manual CRM drafts are recorded in ReplyReviews for review in Gmail. Import the event adapters into the original automation separately.',height:300,width:560},[-300,-420]);
add('Manual connection test','manualTrigger',{},[-280,0]);
add('Poll every minute','scheduleTrigger',{rule:{interval:[{field:'minutes',minutesInterval:1}]}},[-280,180]);
add('Bridge settings','set',{assignments:{assignments:[['crmBaseUrl',base],['spreadsheetId','REPLACE_WITH_EXISTING_SPREADSHEET_ID'],['leadTab','Leads'],['reviewTab','ReplyReviews']].map(([name,value])=>({id:randomUUID(),name,value,type:'string'}))},options:{}},[-40,40]);
add('Read owner changes','httpRequest',http("={{ $('Bridge settings').first().json.crmBaseUrl + '/api/n8n/sync' }}"),[180,40],retry);
add('Each change','code',js("return ($input.first().json.changes || []).map(c => ({json:c}));",'runOnceForAllItems'),[400,40]);
add('Loop changes','splitInBatches',{batchSize:1,options:{}},[620,40]);
add('Lead change?','if',bool("$json.kind !== 'draft.review'"),[840,100]);
const lookup = sheet('read','leadTab');
lookup.filtersUI = {values:[{lookupColumn:'Lead_ID',lookupValue:'={{ $json.payload.Lead_ID }}'}]};
add('Read existing lead','googleSheets',lookup,[1060,-100],{alwaysOutputData:true,onError:'continueRegularOutput'});
add('Merge owner fields','code',js(code.mergeLead,'runOnceForAllItems'),[1280,-100]);
add('Lead row valid?','if',bool('!$json._syncError'),[1500,-100]);
add('Save shared lead','googleSheets',sheet('appendOrUpdate','leadTab','Lead_ID',leadFields),[1720,-180],{onError:'continueRegularOutput'});
add('Lead acknowledgement','code',js("const c = $('Loop changes').item.json; return {json:{changeId:c.id,status:$json.error ? 'Failed' : 'Applied',detail:$json.error ? 'Sheets update failed. Check the credential, headers, and spreadsheet.' : 'Shared lead row updated in Sheets.',executionId:$execution.id}};"),[1940,-180]);
add('Guard acknowledgement','code',js("const c = $('Loop changes').item.json; return {json:{changeId:c.id,status:'Failed',detail:$json._syncError || 'Update needs review.',executionId:$execution.id}};"),[1940,0]);
add('Prepare review row','code',js("const p=$json.payload; return {json:{...p,Updated_At_UTC:new Date().toISOString()}};"),[1060,300]);
add('Save reply review','googleSheets',sheet('appendOrUpdate','reviewTab','Draft_ID',reviewFields),[1280,300],{onError:'continueRegularOutput'});
add('Update existing Gmail draft?','if',bool("!$json.error && $('Loop changes').item.json.intent !== 'mirror.capture' && !!$('Loop changes').item.json.payload.Gmail_Draft_ID && $('Loop changes').item.json.payload.Review_Status !== 'Rejected'"),[1500,300]);
const gmail = (method,url,body) => ({...http(url,method,body),authentication:'predefinedCredentialType',nodeCredentialType:'gmailOAuth2'});
add('Read Gmail draft','httpRequest',gmail('GET',"={{ 'https://gmail.googleapis.com/gmail/v1/users/me/drafts/' + encodeURIComponent($('Loop changes').item.json.payload.Gmail_Draft_ID) + '?format=full' }}"),[1720,220],{onError:'continueRegularOutput',notes:'Select your Gmail OAuth2 credential. Reads the existing draft to protect attachments, copied recipients, and thread identity.'});
add('Prepare Gmail update','code',js(code.prepareGmail),[1940,220]);
add('Gmail update valid?','if',bool('!$json._syncError'),[2160,220]);
add('Update Gmail draft — never send','httpRequest',gmail('PUT',"={{ 'https://gmail.googleapis.com/gmail/v1/users/me/drafts/' + encodeURIComponent($('Loop changes').item.json.payload.Gmail_Draft_ID) }}",'={{ $json.gmailBody }}'),[2380,160],{onError:'continueRegularOutput',notes:'Updates an existing draft only. There is no send operation.'});
add('Gmail acknowledgement','code',js("const c=$('Loop changes').item.json; return {json:{changeId:c.id,status:$json.error ? 'Failed':'Applied',detail:$json.error ? 'Review saved in Sheets, but Gmail draft update failed.' : 'Review saved in Sheets and the existing Gmail draft updated. No email sent.',executionId:$execution.id}};"),[2600,160]);
add('Review acknowledgement','code',js("const c=$('Loop changes').item.json; return {json:{changeId:c.id,status:$json.error ? 'Failed':'Applied',detail:$json.error ? 'Could not save the reply review to Sheets.' : c.intent === 'mirror.capture' ? 'Incoming reply draft recorded in ReplyReviews. Existing Gmail draft kept unchanged.' : c.payload.Review_Status === 'Rejected' ? 'Rejection recorded in ReplyReviews. Existing Gmail draft kept for owner review.' : 'Review recorded in ReplyReviews. Sending requires approval and explicit confirmation in the dashboard.',executionId:$execution.id}};"),[1720,480]);
add('Confirm external result','httpRequest',http("={{ $('Bridge settings').first().json.crmBaseUrl + '/api/n8n/sync' }}",'POST','={{ $json }}'),[2820,20],retry);
for (const [a,b,branch] of [
  ['Manual connection test','Bridge settings'],['Poll every minute','Bridge settings'],['Bridge settings','Read owner changes'],['Read owner changes','Each change'],['Each change','Loop changes'],['Loop changes','Lead change?',1],
  ['Lead change?','Read existing lead',0],['Read existing lead','Merge owner fields'],['Merge owner fields','Lead row valid?'],['Lead row valid?','Save shared lead',0],['Save shared lead','Lead acknowledgement'],['Lead acknowledgement','Confirm external result'],['Lead row valid?','Guard acknowledgement',1],['Guard acknowledgement','Confirm external result'],
  ['Lead change?','Prepare review row',1],['Prepare review row','Save reply review'],['Save reply review','Update existing Gmail draft?'],['Update existing Gmail draft?','Read Gmail draft',0],['Update existing Gmail draft?','Review acknowledgement',1],['Review acknowledgement','Confirm external result'],['Read Gmail draft','Prepare Gmail update'],['Prepare Gmail update','Gmail update valid?'],['Gmail update valid?','Update Gmail draft — never send',0],['Gmail update valid?','Guard acknowledgement',1],['Update Gmail draft — never send','Gmail acknowledgement'],['Gmail acknowledgement','Confirm external result'],['Confirm external result','Loop changes'],
]) link(a,b,branch);
writeFileSync(output+'customerlead-sync-bridge.json',JSON.stringify(workflow,null,2)+'\n');

const adapters = graph('CustomerLead — copy event adapters into your existing workflow');
adapters.add('Adapter setup','stickyNote',{content:'# Copy these adapters into the original workflow\nEach pair is a Code adapter + authenticated HTTP event publisher. Source node names are matched to your supplied export. Follow the connection guide for exact attachment points.\n\nThe shared URL uses Docker Desktop host.docker.internal:3001. Select the CustomerLead Header Auth credential on every HTTP node. No Gmail, Sheets, or AI credential is included. These adapters publish saved outcomes and never send customer email.',width:640,height:260},[-350,-340]);
for (const [i,[name,snippet]] of [
  ['Form captured',code.formCaptured],['Initial email results',code.initialResults],['Email support processed',code.emailProcessed],['Follow-up reserved',code.followupReserved],['Follow-up outcome',code.followupOutcome],['Email screening result',code.screeningResult],['Form rejected or duplicate',code.rejectedForm],
].entries()) {
  const y=i*240;
  adapters.add(name,'code',js(snippet),[0,y]);
  adapters.add('Publish '+name,'httpRequest',http(base+'/api/n8n/events','POST','={{ $json }}'),[300,y],retry);
  adapters.link(name,'Publish '+name);
}
adapters.add('Read shared CRM configuration','httpRequest',http(base+'/api/n8n/config'),[0,1800],retry);
adapters.add('Authenticated CRM health check','httpRequest',http(base+'/api/n8n/health'),[300,1800],retry);
adapters.add('Keep inquiry context','code',js('return $input.all();','runOnceForAllItems'),[0,2000]);
adapters.add('Apply lead configuration','code',js("const config = {...$input.first().json.config, sheet_id:'REPLACE_WITH_EXISTING_SPREADSHEET_ID', sheet_tab:'Leads'}; return $('Keep inquiry context').all().map(item => ({json:{...item.json,_cfg:config}}));",'runOnceForAllItems'),[300,2000]);
adapters.add('Workflow failure','errorTrigger',{},[0,2240]);
adapters.add('Execution failure event','code',js(code.executionFailed),[300,2240]);
adapters.add('Publish execution failure','httpRequest',http(base+'/api/n8n/events','POST','={{ $json }}'),[600,2240],retry);
adapters.link('Workflow failure','Execution failure event');
adapters.link('Execution failure event','Publish execution failure');
writeFileSync(output+'customerlead-event-adapters.json',JSON.stringify(adapters.workflow,null,2)+'\n');
const formNodeNames = new Set(['Form captured', 'Publish Form captured']);
const formNodes = structuredClone(adapters.workflow.nodes.filter(node => formNodeNames.has(node.name)));
formNodes.forEach((node, index) => { node.position = [index * 320, 0]; });
const formPackage = {
  name: 'CustomerLead — Form inquiry to CRM (2 nodes)',
  nodes: formNodes,
  connections: { 'Form captured': structuredClone(adapters.workflow.connections['Form captured']) },
  active: false,
  settings: { executionOrder: 'v1' },
  pinData: {},
  tags: [],
};
writeFileSync(output+'customerlead-form-nodes.json',JSON.stringify(formPackage,null,2)+'\n');

// Separate from the review bridge: this workflow can send only a claimed,
// owner-confirmed reply. Never enable retries on the claim or Gmail send nodes.
const sender = graph('CustomerLead — owner-confirmed Gmail sender');
sender.add('Sender setup','stickyNote',{content:'# Manual replies from the dashboard\nSelect Header Account 2 (CRM Header Auth) on the three CRM requests, and the SAME Gmail OAuth2 account on the four Gmail requests. Run once with an empty queue to register the sending account. Then enable the schedule.\n\nOnly replies approved and explicitly confirmed in the dashboard can be claimed. Review sync must finish first. One claim per execution. NEVER retry or re-run the Gmail send node: check Gmail when delivery is uncertain. This workflow sends real email.',width:640,height:320},[-280,-380]);
sender.add('Test manual sender','manualTrigger',{},[-280,0]);
sender.add('Check queued replies every minute','scheduleTrigger',{rule:{interval:[{field:'minutes',minutesInterval:1}]}},[-280,180]);
sender.add('Read sending Gmail account','httpRequest',gmail('GET','https://gmail.googleapis.com/gmail/v1/users/me/profile'),[0,40]);
sender.add('Claim approved reply','httpRequest',http(base+'/api/n8n/mail','POST',"={{ {action:'claim',executionId:$execution.id,senderEmail:$json.emailAddress,capabilities:['lead-reports-v1']} }}"),[240,40],{notes:credentialNote,retryOnFail:false});
sender.add('Reply waiting?','if',bool('!!$json.job'),[480,40]);
sender.add('Read Gmail reply context','httpRequest',gmail('GET',"={{ $('Claim approved reply').first().json.job.gmailDraftId ? 'https://gmail.googleapis.com/gmail/v1/users/me/drafts/' + encodeURIComponent($('Claim approved reply').first().json.job.gmailDraftId) + '?format=full' : $('Claim approved reply').first().json.job.gmailThreadId ? 'https://gmail.googleapis.com/gmail/v1/users/me/threads/' + encodeURIComponent($('Claim approved reply').first().json.job.gmailThreadId) + '?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To' : 'https://gmail.googleapis.com/gmail/v1/users/me/profile' }}"),[720,0],{onError:'continueRegularOutput'});
sender.add('Build confirmed Gmail draft','code',js(mailCode.prepareMailDraft),[960,0]);
sender.add('Draft ready to save?','if',bool('!$json._mailError'),[1200,0]);
sender.add('Save confirmed Gmail draft','httpRequest',gmail("={{ $('Claim approved reply').first().json.job.gmailDraftId ? 'PUT' : 'POST' }}","={{ 'https://gmail.googleapis.com/gmail/v1/users/me/drafts' + ($('Claim approved reply').first().json.job.gmailDraftId ? '/' + encodeURIComponent($('Claim approved reply').first().json.job.gmailDraftId) : '') }}",'={{ $json.gmailBody }}'),[1440,-80],{onError:'continueRegularOutput',retryOnFail:false});
sender.add('Draft saved?','if',bool('!$json.error && !!$json.id'),[1680,-80]);
sender.add('Record prepared draft','httpRequest',http(base+'/api/n8n/mail','POST',"={{ {action:'prepared',jobId:$('Claim approved reply').first().json.job.id,executionId:$execution.id,gmailDraftId:$json.id} }}"),[1920,-160],retry);
sender.add('Send confirmed Gmail draft','httpRequest',gmail('POST','https://gmail.googleapis.com/gmail/v1/users/me/drafts/send',"={{ {id:$json.gmailDraftId} }}"),[2160,-160],{onError:'continueRegularOutput',retryOnFail:false,notes:'SENDS REAL EMAIL. Do not retry this node or restart a failed execution from it. The Gmail draft is consumed on success. Review Gmail Sent when the result is uncertain.'});
sender.add('Gmail delivery result','code',js(mailCode.mailResult),[2400,-160]);
sender.add('Preparation needs review','code',js(mailCode.mailPreparationFailed),[1920,140]);
sender.add('Confirm Gmail delivery','httpRequest',http(base+'/api/n8n/mail','POST','={{ $json }}'),[2640,0],retry);
for (const [from,to,branch] of [
  ['Test manual sender','Read sending Gmail account'],['Check queued replies every minute','Read sending Gmail account'],['Read sending Gmail account','Claim approved reply'],['Claim approved reply','Reply waiting?'],['Reply waiting?','Read Gmail reply context',0],['Read Gmail reply context','Build confirmed Gmail draft'],['Build confirmed Gmail draft','Draft ready to save?'],['Draft ready to save?','Save confirmed Gmail draft',0],['Draft ready to save?','Preparation needs review',1],['Save confirmed Gmail draft','Draft saved?'],['Draft saved?','Record prepared draft',0],['Draft saved?','Preparation needs review',1],['Record prepared draft','Send confirmed Gmail draft'],['Send confirmed Gmail draft','Gmail delivery result'],['Gmail delivery result','Confirm Gmail delivery'],['Preparation needs review','Confirm Gmail delivery']
]) sender.link(from,to,branch);
writeFileSync(output+'customerlead-manual-gmail-sender.json',JSON.stringify(sender.workflow,null,2)+'\n');

// Two-workflow setup: the original automation plus one dashboard bridge that
// contains both review sync and owner-confirmed sending, using one shared timer.
const combined = structuredClone(workflow);
combined.name = 'CustomerLead — Dashboard sync and manual Gmail sending';
combined.nodes.find(n => n.name === 'Setup notes').parameters.content = '# Dashboard bridge: sync + manual sending\nUse this workflow instead of the old sync bridge AND the standalone sender. Keep the original AI-support automation as workflow 1. This is workflow 2.\n\nSet Bridge settings, select Sheets credentials on 3 nodes, CRM Header Auth on 5 nodes, and the SAME Gmail OAuth2 account on 6 Gmail requests. The lower path sends ONLY owner-approved, explicitly confirmed replies. Never retry its send node.\n\nRun a full Manual connection test with an empty mail queue first. See customerlead-setup-and-testing.pdf for the setup and test sequence.';
combined.nodes.find(n => n.name === 'Setup notes').parameters.height = 380;
combined.nodes.find(n => n.name === 'Bridge settings').parameters.assignments.assignments.find(a => a.name === 'spreadsheetId').value = '1IugQXIcteoSLJ0aACmG8A5eSb6vl-CvelPWg9b4K8-Y';
const omittedSenderNodes = new Set(['Sender setup','Test manual sender','Check queued replies every minute']);
for (const node of sender.workflow.nodes.filter(n => !omittedSenderNodes.has(n.name))) {
  const copy = structuredClone(node);
  copy.position[1] += 1060;
  combined.nodes.push(copy);
}
for (const [name, edges] of Object.entries(sender.workflow.connections)) {
  if (!omittedSenderNodes.has(name)) combined.connections[name] = structuredClone(edges);
}
for (const trigger of ['Manual connection test','Poll every minute'])
  combined.connections[trigger].main[0].push({node:'Read sending Gmail account',type:'main',index:0});
writeFileSync(output+'customerlead-sync-and-send-bridge.json',JSON.stringify(combined,null,2)+'\n');

const emailNames = new Set(['Email support processed','Publish Email support processed']);
const emailNodes = structuredClone(adapters.workflow.nodes.filter(n => emailNames.has(n.name)));
emailNodes.forEach((node, index) => { node.position = [index * 320, 0]; });
writeFileSync(output+'customerlead-email-nodes.json',JSON.stringify({name:'CustomerLead — Gmail inquiry and draft to CRM (2 nodes)',nodes:emailNodes,connections:{'Email support processed':structuredClone(adapters.workflow.connections['Email support processed'])},active:false,settings:{executionOrder:'v1'},pinData:{},tags:[]},null,2)+'\n');
copyFileSync(fileURLToPath(new URL('../docs/n8n-connection.md', import.meta.url)),output+'connection-guide.md');
copyFileSync(fileURLToPath(new URL('../docs/n8n-current-review.md', import.meta.url)),output+'workflow-review.md');
writeFileSync(output+'workflow-reference.json',JSON.stringify(publicReference,null,2)+'\n');
console.log('Built inactive sync bridge and event adapter kit (no credentials).');
console.log(`Current source: ${publicReference.nodeCount} nodes; ${publicReference.adapterSourcesChecked} adapter sources checked; ${publicReference.missingFallbacks.length} AI fallback connections still missing.`);
