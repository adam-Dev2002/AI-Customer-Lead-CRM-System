import { randomUUID } from 'node:crypto';
import * as events from './bridge-code.mjs';
import { prepareMailDraft } from './mail-code.mjs';

export const sheetId = '1IugQXIcteoSLJ0aACmG8A5eSb6vl-CvelPWg9b4K8-Y';
export const leadFields = ['Lead_ID','Created_At_UTC','Name','Email','Phone','Service','Message','Source','Consent','Status','Priority','Follow_Up_Due_UTC','Follow_Up_State','Follow_Up_Sent_UTC','Owner','Notes','Acknowledgement_Status','Owner_Alert_Status','Category','AI_Summary','Gmail_Thread_ID'];
export const reviewFields = ['Draft_ID','Lead_ID','Gmail_Draft_ID','Gmail_Thread_ID','Email','Subject','Body','Review_Status','Updated_At_UTC'];
const configName = 'CONFIG — BUSINESS SETTINGS (EDIT HERE)';
const emailConfigName = 'CONFIG — BUSINESS, FAQ & AI MODELS';
const appendName = 'SHEETS — Append Customer Lead';
const base = 'http://host.docker.internal:3001';
const schema = (keys,match) => keys.map(id=>({id,displayName:id,required:false,defaultMatch:id===match,canBeUsedToMatch:true,display:true,type:'string'}));
const condition = expression => ({conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:2},conditions:[{id:randomUUID(),leftValue:`={{ ${expression} }}`,rightValue:true,operator:{type:'boolean',operation:'true',singleValue:true}}],combinator:'and'},options:{}});

function editor(workflow) {
  const find = name => {const n=workflow.nodes.find(n=>n.name===name); if(!n) throw Error(`Missing node: ${name}`); return n;};
  const upsert = (name,type,parameters,position=[0,0]) => {
    const existing=workflow.nodes.find(n=>n.name===name);
    if(existing){existing.parameters=parameters; return existing;}
    const n={id:randomUUID(),name,type:`n8n-nodes-base.${type}`,typeVersion:({code:2,httpRequest:4.2,if:2.2,set:3.4})[type]||1,parameters,position};
    workflow.nodes.push(n);return n;
  };
  const link=(from,to,branch=0,replace=false)=>{
    find(from);find(to);
    const edges=workflow.connections[from]||={main:[]};
    while(edges.main.length<=branch)edges.main.push([]);
    if(replace)edges.main[branch]=[];
    if(!edges.main[branch].some(e=>e.node===to))edges.main[branch].push({node:to,type:'main',index:0});
  };
  const code=(name,jsCode,position,mode='runOnceForEachItem')=>upsert(name,'code',{mode,jsCode},position);
  const credentials=workflow.nodes.find(n=>n.name.startsWith('Publish ')&&n.credentials?.httpHeaderAuth)?.credentials;
  const request=(name,url,position,body)=>{
    const n=upsert(name,'httpRequest',{method:body?'POST':'GET',url,authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',...(body?{sendBody:true,specifyBody:'json',jsonBody:body}:{}),options:{timeout:15000}},position);
    if(credentials)n.credentials=structuredClone(credentials);
    Object.assign(n,{retryOnFail:true,maxTries:3,waitBetweenTries:1000});return n;
  };
  const pair=(name,script,source,position=[0,0])=>{
    const publisher=workflow.nodes.find(n=>n.name.toLowerCase()===('Publish '+name).toLowerCase())?.name||'Publish '+name;
    code(name,script,position);request(publisher,base+'/api/n8n/events',[position[0]+260,position[1]],'={{ $json }}');
    link(source,name);link(name,publisher);return publisher;
  };
  return {find,upsert,link,code,request,pair};
}

export function upgradeMain(workflow) {
  const {find,upsert,link,code,request,pair}=editor(workflow);
  workflow.name='AI CUSTOMER SUPPORT + LEAD CAPTURE CRM | Gmail Drafts + Gemini + Follow-up | ONE WORKFLOW';

  // Read shared settings on every new form, follow-up run and support scan.
  code('Keep inquiry context','return $input.all();',[-850,900],'runOnceForAllItems');
  request('Read shared CRM configuration',base+'/api/n8n/config',[-600,900]);
  for(const name of ['TAG — Form Submission','TAG — Scheduled Review'])link(name,'Keep inquiry context',0,true);
  link('Keep inquiry context','Read shared CRM configuration',0,true);
  link('Read shared CRM configuration',configName,0,true);
  find(configName).parameters={mode:'runOnceForAllItems',jsCode:`const config = {...$input.first().json.config, sheet_id:'${sheetId}', sheet_tab:'Leads'};\nreturn $('Keep inquiry context').all().map(item=>({json:{...item.json,_cfg:config}}));`};
  request('Read shared email configuration',base+'/api/n8n/config',[-650,-400]);
  for(const name of ['START — Manual Test','START — Every 5 Minutes'])link(name,'Read shared email configuration',0,true);
  link('Read shared email configuration',emailConfigName,0,true);
  const assignments=find(emailConfigName).parameters.assignments.assignments;
  const shared=['business_name','signature','business_facts','reply_tone','primary_ai','gemini_model','openai_model','gmail_query','max_emails_per_scan'];
  for(const field of assignments)if(shared.includes(field.name))field.value=`={{ $json.config.${field.name} }}`;
  if(!assignments.some(a=>a.name==='lead_ai_enabled'))assignments.push({id:randomUUID(),name:'lead_ai_enabled',type:'boolean',value:'={{ $json.config.lead_ai_enabled }}'});
  find('START — Every 5 Minutes').parameters.rule={interval:[{field:'minutes',minutesInterval:5}]};
  find('SCHEDULE — Check Open Leads Hourly').parameters.rule={interval:[{field:'hours',hoursInterval:1}]};

  // The AI switch still captures incoming mail for manual handling when disabled.
  upsert('CHECK — Email AI Enabled?','if',condition(`$('${emailConfigName}').first().json.lead_ai_enabled`),[900,-200]);
  code('Prepare manual email review',"const e=$('Prepare Email + Safety Screen').item.json; return {json:{...e,ai_disabled:true,valid:true,ai_provider:'Manual'}};",[1150,-40]);
  link('Gmail — Lock For Processing','CHECK — Email AI Enabled?',0,true);
  link('CHECK — Email AI Enabled?','Compose Trusted AI Prompt',0,true);
  link('CHECK — Email AI Enabled?','Prepare manual email review',1,true);
  link('Prepare manual email review','Review AI & Route',0,true);
  const review=find('Review AI & Route');
  if(!review.parameters.jsCode.includes('v.ai_disabled'))review.parameters.jsCode=review.parameters.jsCode.replace('const v=$json;','const v=$json;\nif(v.ai_disabled) return {json:{...v,category:"general",priority:"normal",summary:"",reply_body:"",create_draft:false,outcome:"review",reason:"AI is disabled in dashboard Settings. Create a manual reply."}};');
  link('IF — Primary Gemini?','AI — OpenAI Primary',1,true);
  link('IF — Gemini Valid?','AI — OpenAI Backup',1,true);
  for(const n of workflow.nodes.filter(n=>n.name.startsWith('AI — ')&&n.type==='n8n-nodes-base.httpRequest'))n.onError='continueRegularOutput';

  const draft=find('Gmail — Create Draft (NEVER SEND)');
  draft.parameters.emailType='text';
  draft.parameters.options={...draft.parameters.options,sendTo:'={{ $json.sender }}'};
  const formExisting=workflow.nodes.find(n=>n.name.toLowerCase()==='form captured');
  const formName=formExisting?.name||'Form captured';
  const formPublisher=pair(formName,events.formCaptured,appendName,[1200,1100]);
  link(formName,formPublisher,0,true);
  for(const n of workflow.nodes.filter(n=>n.name.toLowerCase()===formPublisher.toLowerCase()&&n.name!==formPublisher))n.disabled=true;
  pair('Email support processed',events.emailProcessed,'Gmail — Create Draft (NEVER SEND)',[1500,-600]);
  // Preserve the original label path directly alongside the event branch.
  workflow.connections['Publish Email support processed']={main:[]};
  link('Gmail — Create Draft (NEVER SEND)','Gmail — Label Draft Outcome');
  const noDraft=pair('Email inquiry without draft',events.emailProcessed,'Gmail — Label No-Draft Outcome',[1750,-150]);
  workflow.connections[noDraft]={main:[]};
  pair('Email screening result',events.screeningResult,'Gmail — Mark Skipped',[1250,180]);
  code('Form rejected or duplicate',events.rejectedForm,[1200,1350]);
  request('Publish Form rejected or duplicate',base+'/api/n8n/events',[1460,1350],'={{ $json }}');
  link('CHECK — Is Lead Valid?','Form rejected or duplicate',1,true);
  link('CHECK — Not Duplicate?','Form rejected or duplicate',1,true);
  link('Form rejected or duplicate','Publish Form rejected or duplicate',0,true);
  pair('Initial email results',events.initialResults,'SHEETS — Save Initial Email Results',[2800,1050]);
  const reservation=pair('Follow-up reserved',events.followupReserved,'SHEETS — Reserve Follow-Up',[1600,1550]);
  link('SHEETS — Reserve Follow-Up','Follow-up reserved',0,true);
  link(reservation,'GMAIL — Send Consented Follow-Up',0,true);
  pair('Follow-up outcome',events.followupOutcome,'SHEETS — Log Follow-Up Outcome',[2600,1550]);

  // Gate acknowledgements and owner alerts independently, and report disabled results.
  upsert('CHECK — Customer Acknowledgement Enabled?','if',condition(`$('${configName}').first().json._cfg.send_customer_ack`),[1500,750]);
  upsert('CHECK — Owner Alerts Enabled?','if',condition(`$('${configName}').first().json._cfg.send_owner_alert && !!$('${configName}').first().json._cfg.owner_email`),[2050,750]);
  code('Record acknowledgement result',`const p=$('${appendName}').first().json; return {json:{...p,Acknowledgement_Status:$json.error?'Failed — check executions':'Sent'}};`,[1900,650]);
  code('Skip customer acknowledgement',"return {json:{...$json,Acknowledgement_Status:'Disabled'}};",[1700,900]);
  code('Record owner alert result',"const p=$('CHECK — Owner Alerts Enabled?').item.json; return {json:{...p,Owner_Alert_Status:$json.error?'Failed — check executions':'Sent'}};",[2450,650]);
  code('Skip owner alert',"return {json:{...$json,Owner_Alert_Status:'Disabled'}};",[2250,900]);
  code('Record disabled automatic emails',"return {json:{...$json,Acknowledgement_Status:'Disabled',Owner_Alert_Status:'Disabled'}};",[1900,1150]);
  link('CHECK — Customer Emails Enabled?','CHECK — Customer Acknowledgement Enabled?',0,true);
  link('CHECK — Customer Emails Enabled?','Record disabled automatic emails',1,true);
  link('CHECK — Customer Acknowledgement Enabled?','GMAIL — Acknowledge Inquiry',0,true);
  link('CHECK — Customer Acknowledgement Enabled?','Skip customer acknowledgement',1,true);
  link('GMAIL — Acknowledge Inquiry','Record acknowledgement result',0,true);
  link('Record acknowledgement result','CHECK — Owner Alerts Enabled?',0,true);
  link('Skip customer acknowledgement','CHECK — Owner Alerts Enabled?',0,true);
  link('CHECK — Owner Alerts Enabled?','GMAIL — Alert Business Owner',0,true);
  link('CHECK — Owner Alerts Enabled?','Skip owner alert',1,true);
  link('GMAIL — Alert Business Owner','Record owner alert result',0,true);
  for(const name of ['Record owner alert result','Skip owner alert','Record disabled automatic emails'])link(name,'SHEETS — Save Initial Email Results',0,true);
  const result=find('SHEETS — Save Initial Email Results');
  result.parameters.columns.value={Lead_ID:'={{ $json.Lead_ID }}',Acknowledgement_Status:'={{ $json.Acknowledgement_Status }}',Owner_Alert_Status:'={{ $json.Owner_Alert_Status }}'};
  for(const n of workflow.nodes.filter(n=>n.type==='n8n-nodes-base.gmail'&&n.parameters.sendTo))n.retryOnFail=false;
  for(const n of workflow.nodes.filter(n=>n.type==='n8n-nodes-base.googleSheets'&&n.parameters.columns)){
    n.parameters.columns.schema=schema(leadFields,n.parameters.columns.matchingColumns?.[0]||'Lead_ID');
  }
  const append=find(appendName);
  Object.assign(append.parameters.columns.value,{
    Category:"={{ $json.Category || (String($json.Notes || '').match(/^AI category:\\s*(Sales|Quote|Booking|General)\\./)?.[1]) || 'General' }}",
    AI_Summary:"={{ $json.AI_Summary || (String($json.Notes || '').match(/^AI category:\\s*(?:Sales|Quote|Booking|General)\\.\\s*(.+)$/s)?.[1]) || '' }}",
    Gmail_Thread_ID:"={{ $json.Gmail_Thread_ID || '' }}",
  });
  append.parameters.options={...append.parameters.options,cellFormat:'RAW',handlingExtraData:'ignoreIt'};
  return workflow;
}

export function upgradeBridge(workflow,prepared) {
  for(const name of ['Read existing lead','Save shared lead','Save reply review','Update existing Gmail draft?','Prepare Gmail update','Review acknowledgement']){
    const existing=workflow.nodes.find(n=>n.name===name), template=prepared.nodes.find(n=>n.name===name);
    if(!existing||!template)throw Error('Missing bridge node '+name);
    existing.parameters=structuredClone(template.parameters);
    if(name==='Read existing lead'){existing.alwaysOutputData=true;existing.onError='continueRegularOutput';}
  }
  const settings=workflow.nodes.find(n=>n.name==='Bridge settings');
  settings.parameters.assignments.assignments.find(a=>a.name==='spreadsheetId').value=sheetId;
  return workflow;
}

export function upgradeSender(workflow) {
  const node=workflow.nodes.find(n=>n.name==='Build confirmed Gmail draft');
  if(!node)throw Error('Missing sender preparation node.');
  node.parameters.jsCode=prepareMailDraft;
  return workflow;
}

export function verifyWorkflow(workflow) {
  const names=new Set(workflow.nodes.map(n=>n.name));
  if(names.size!==workflow.nodes.length)throw Error('Duplicate node names.');
  for(const node of workflow.nodes){
    if(node.type==='n8n-nodes-base.code')new Function(node.parameters.jsCode);
  }
  for(const [from,edges] of Object.entries(workflow.connections)){
    if(!names.has(from))throw Error('Unknown connection source '+from);
    for(const edge of (edges.main||[]).flat())if(!names.has(edge.node))throw Error('Unknown connection target '+edge.node);
  }
  return true;
}
