import { createHash } from 'node:crypto';
import { prepareGmail } from './bridge-code.mjs';
import { prepareMailDraft } from './mail-code.mjs';
import { installFollowUpReview } from './followup-review.mjs';

export const unifiedName = 'ClearFlow — Customer support, leads & dashboard (Gemini only)';
export const removedAINodes = [
  'IF — Primary Gemini?', 'IF — Gemini Valid?', 'IF — OpenAI Valid?',
  'AI — OpenAI Primary', 'AI — OpenAI Backup', 'Parse OpenAI Result',
  'Parse Backup OpenAI', 'AI — Gemini Backup', 'Parse Backup Gemini',
];
const defaultBase = 'http://host.docker.internal:3001';
const stableId = name => {
  const hex = createHash('sha256').update('customerlead-unified-v1:' + name).digest('hex');
  return [hex.slice(0,8),hex.slice(8,12),'4'+hex.slice(13,16),'a'+hex.slice(17,20),hex.slice(20,32)].join('-');
};
const edge = node => ({node,type:'main',index:0});
const isSticky = node => node.type === 'n8n-nodes-base.stickyNote';
const isManual = node => node.type === 'n8n-nodes-base.manualTrigger';
const refs = value => {
  const names = new Set();
  const visit = entry => {
    if (typeof entry === 'string') {
      for (const match of entry.matchAll(/(?:\$\(|\$items\(|\$node\[)\s*(['"])([^'"\r\n]+)\1/g)) names.add(match[2]);
    } else if (Array.isArray(entry)) entry.forEach(visit);
    else if (entry && typeof entry === 'object') Object.values(entry).forEach(visit);
  };
  visit(value);
  return [...names];
};

export function combineWorkflows(input, options = {}) {
  const crmBaseUrl = (options.crmBaseUrl || defaultBase).replace(/\/$/,'');
  const baseURL=new URL(crmBaseUrl);
  if(!['http:','https:'].includes(baseURL.protocol) || baseURL.username || baseURL.password || baseURL.pathname!=='/' || baseURL.search || baseURL.hash)
    throw Error('CRM base URL must be an HTTP(S) origin without a path, credentials or query.');
  const sources = structuredClone(input);
  const removed = new Set([...removedAINodes,'Publish Form Captured']);
  const workflow = {name:unifiedName,nodes:[],connections:{},active:false,settings:{executionOrder:'v1',timezone:'Asia/Singapore'},pinData:{},tags:[]};
  const report = {sourceNodeCount:0,removedNodes:[],preservedCredentialBindings:0,removedInlineKeyHeaders:0};
  const sourceByName = new Map();
  for (const role of ['main','sync','sender']) {
    const source = sources[role];
    if (!source?.nodes || !source?.connections) throw Error('Missing workflow source: '+role);
    report.sourceNodeCount += source.nodes.length;
    for (const node of source.nodes) {
      if (isSticky(node) || isManual(node) || removed.has(node.name)) {
        report.removedNodes.push(node.name); continue;
      }
      if (sourceByName.has(node.name)) throw Error('Source node-name collision: '+node.name);
      sourceByName.set(node.name,{role,node});
      // Keep original IDs, names, node types and credential references.
      report.preservedCredentialBindings += Object.keys(node.credentials || {}).length;
      workflow.nodes.push(node);
    }
    for (const [name, outputs] of Object.entries(source.connections))
      workflow.connections[name] = outputs;
  }
  const get = name => {
    const node = workflow.nodes.find(node=>node.name===name);
    if (!node) throw Error('Required source node is missing: '+name);
    return node;
  };
  const add = (name,type,parameters,position,extra={}) => {
    const versions={httpRequest:4.2,code:2,if:2.2,stickyNote:1,manualTrigger:1};
    const node={id:stableId(name),name,type:'n8n-nodes-base.'+type,typeVersion:versions[type],parameters,position,...extra};
    workflow.nodes.push(node); return node;
  };
  const connect = (from,to,branch=0) => {
    const output = workflow.connections[from] ||= {main:[]};
    while(output.main.length<=branch) output.main.push([]);
    output.main[branch].push(edge(to));
  };
  const names = new Set(workflow.nodes.map(node=>node.name));
  for (const [name,outputs] of Object.entries(workflow.connections)) {
    if (!names.has(name)) { delete workflow.connections[name]; continue; }
    for (const [kind,branches] of Object.entries(outputs))
      outputs[kind] = branches.map(branch=>branch.filter(item=>names.has(item.node)));
  }

  // Gemini is the only provider. Invalid responses still reach manual review.
  workflow.connections['Compose Trusted AI Prompt'] = {main:[[edge('AI — Gemini Primary')]]};
  workflow.connections['Parse Gemini Result'] = {main:[[edge('Review AI & Route')]]};
  get('Parse Gemini Result').parameters.jsCode = String.raw`const response=$json;
const email=$('Compose Trusted AI Prompt').item.json;
try {
  if (response.error) throw new Error(response.error.message || 'Gemini request failed');
  const raw=(response.candidates?.[0]?.content?.parts || []).map(part=>part.text || '').join('').trim().replace(/^\x60\x60\x60(?:json)?\s*/i,'').replace(/\s*\x60\x60\x60$/,'');
  const ai=JSON.parse(raw);
  const valid=!!ai && typeof ai==='object' && !Array.isArray(ai) && typeof ai.reply_needed==='boolean' && typeof ai.needs_human==='boolean' && ['reply_body','category','priority','summary'].every(field=>typeof ai[field]==='string');
  return {json:{...email,valid,ai:valid?ai:null,ai_provider:'gemini',ai_error:valid?'':'Gemini response could not be used; manual review required.'}};
} catch(error) {
  return {json:{...email,valid:false,ai:null,ai_provider:'gemini',ai_error:'Gemini could not prepare a reply. Review this inquiry manually.'}};
}`;
  const config=get('CONFIG — BUSINESS, FAQ & AI MODELS');
  config.parameters.assignments.assignments = config.parameters.assignments.assignments.filter(item=>!['primary_ai','openai_model'].includes(item.name));
  const prompt=get('Compose Trusted AI Prompt');
  const previousContext='primary_ai:c.primary_ai,gemini_model:c.gemini_model,openai_model:c.openai_model';
  if(!prompt.parameters.jsCode.includes(previousContext))throw Error('The trusted AI prompt context changed; review before consolidating.');
  prompt.parameters.jsCode=prompt.parameters.jsCode.replace(previousContext,'gemini_model:c.gemini_model');
  // Preserve the later, reviewed fixes already running in the two helpers.
  // Their uploaded exports predate MIME wrapping and missing-draft diagnostics.
  get('Prepare Gmail update').parameters.jsCode=prepareGmail;
  get('Claim approved reply').parameters.jsonBody="={{ {action:'claim',executionId:$execution.id,senderEmail:$json.emailAddress,capabilities:['lead-reports-v1']} }}";
  get('Build confirmed Gmail draft').parameters.jsCode=prepareMailDraft;
  const existingLead=get('Read existing lead');
  existingLead.parameters.operation='read';
  existingLead.parameters.options={...existingLead.parameters.options,cellFormat:'RAW',handlingExtraData:'ignoreIt'};
  get('Gmail — Create Draft (NEVER SEND)').parameters.emailType='text';
  const appendLead=get('SHEETS — Append Customer Lead');
  appendLead.parameters.options={...appendLead.parameters.options,cellFormat:'RAW',handlingExtraData:'ignoreIt'};
  for(const name of ['CONFIG — BUSINESS SETTINGS (EDIT HERE)','Keep inquiry context'])get(name).parameters.mode='runOnceForAllItems';
  for(const name of ['Read shared CRM configuration','Read shared email configuration'])get(name).parameters.method='GET';
  for (const name of ['AI — Gemini Primary','LEADS — Gemini Classify (Optional)']) {
    const node=get(name);
    if (!node.credentials?.httpHeaderAuth?.id) throw Error('Saved Gemini credential is missing on '+name);
    const headers=node.parameters.headerParameters?.parameters || [];
    report.removedInlineKeyHeaders += headers.filter(item=>/^(x-goog-api-key|authorization)$/i.test(item.name)).length;
    node.parameters.headerParameters={parameters:headers.filter(item=>!/^(x-goog-api-key|authorization)$/i.test(item.name))};
    node.parameters.sendHeaders=node.parameters.headerParameters.parameters.length>0;
    node.onError='continueRegularOutput';
    node.retryOnFail=false;
  }

  // Independent trigger executions: an empty/failed sync does not starve sending.
  get('START — Every 5 Minutes').parameters.rule={interval:[{field:'minutes',minutesInterval:5}]};
  get('SCHEDULE — Check Open Leads Hourly').parameters.rule={interval:[{field:'hours',hoursInterval:1}]};
  for (const name of ['Poll every minute','Check queued replies every minute'])
    get(name).parameters.rule={interval:[{field:'minutes',minutesInterval:1}]};

  const crmCredential=structuredClone(get('Read owner changes').credentials);
  const gmailCredential=structuredClone(get('Read sending Gmail account').credentials);
  const sheetsCredential=structuredClone(get('Read existing lead').credentials);
  const bridge=get('Bridge settings').parameters.assignments.assignments;
  const sheetId=bridge.find(item=>item.name==='spreadsheetId')?.value;
  if (!sheetId || String(sheetId).startsWith('=')) throw Error('Expected the existing spreadsheet ID.');
  bridge.find(item=>item.name==='crmBaseUrl').value=crmBaseUrl;

  const crmHTTP = (url,body) => ({method:body?'POST':'GET',url,authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',...(body?{sendBody:true,specifyBody:'json',jsonBody:body}:{}),options:{timeout:15000}});
  add('Claim consented follow-up','httpRequest',crmHTTP(crmBaseUrl+'/api/n8n/followups',"={{ {action:'claim',leadId:$json.Lead_ID,email:$json.Email,followUpDue:$json.Follow_Up_Due_UTC,executionId:$execution.id} }}"),[820,1740],{credentials:crmCredential,retryOnFail:false,notes:'Atomic CRM reservation blocks stale Sheet reads, outstanding edits and competing manual replies. Requires the updated CRM backend.'});
  add('Follow-up claimed?','if',{conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:2},conditions:[{id:stableId('follow-up-condition'),leftValue:'={{ $json.claimed }}',rightValue:true,operator:{type:'boolean',operation:'true',singleValue:true}}],combinator:'and'},options:{}},[1060,1740]);
  workflow.connections['FILTER — Pending Consented Follow-Ups']={main:[[edge('Claim consented follow-up')]]};
  connect('Claim consented follow-up','Follow-up claimed?');
  connect('Follow-up claimed?','SHEETS — Reserve Follow-Up');
  get('SHEETS — Reserve Follow-Up').parameters.columns.value.Lead_ID='={{ $json.leadId }}';
  for(const name of ['SHEETS — Reserve Follow-Up','Follow-up reserved','Publish Follow-up reserved','GMAIL — Send Consented Follow-Up','SHEETS — Log Follow-Up Outcome','Follow-up outcome','Publish Follow-up outcome']) {
    get(name).position=[get(name).position[0]+620,get(name).position[1]+220];
  }

  // A single read-only Manual Trigger is valid in n8n and cannot send mail.
  add('Manual system check','manualTrigger',{},[-100,-650]);
  add('Check CRM connection','httpRequest',crmHTTP(crmBaseUrl+'/api/n8n/health'),[140,-650],{credentials:crmCredential,retryOnFail:false});
  add('Check Gmail connection','httpRequest',{method:'GET',url:'https://gmail.googleapis.com/gmail/v1/users/me/profile',authentication:'predefinedCredentialType',nodeCredentialType:'gmailOAuth2',options:{timeout:15000}},[380,-650],{credentials:gmailCredential,retryOnFail:false});
  add('Check Sheets connection','httpRequest',{method:'GET',url:'https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(sheetId)+'?fields=spreadsheetId,properties(title),sheets(properties(title))',authentication:'predefinedCredentialType',nodeCredentialType:'googleSheetsOAuth2Api',options:{timeout:15000}},[620,-650],{credentials:sheetsCredential,retryOnFail:false});
  add('System check complete','code',{mode:'runOnceForAllItems',jsCode:"const crm=$('Check CRM connection').first().json; const gmail=$('Check Gmail connection').first().json; const sheet=$input.first().json; const tabs=(sheet.sheets||[]).map(item=>item.properties.title); if(!crm.capabilities?.atomicFollowUpClaim) throw new Error('Restart the updated CRM backend before activating this workflow.'); if(!crm.ready || !gmail.emailAddress || !tabs.includes('Leads') || !tabs.includes('ReplyReviews')) throw new Error('A required connection or worksheet is unavailable.'); return [{json:{ready:true,gmailAccount:gmail.emailAddress,spreadsheet:sheet.properties.title,tabs,mailSent:false,message:'Connections checked. No customer data was changed and no email was sent.'}}];"},[860,-650]);
  for(const [from,to] of [['Manual system check','Check CRM connection'],['Check CRM connection','Check Gmail connection'],['Check Gmail connection','Check Sheets connection'],['Check Sheets connection','System check complete']])connect(from,to);

  for(const node of workflow.nodes) {
    if(typeof node.parameters.url==='string' && node.parameters.url.startsWith(defaultBase+'/api/n8n/'))
      node.parameters.url=crmBaseUrl+node.parameters.url.slice(defaultBase.length);
    const role=sourceByName.get(node.name)?.role;
    if(role==='sync')node.position=[node.position[0],node.position[1]+2600];
    if(role==='sender')node.position=[node.position[0],node.position[1]+4400];
    if(node.type==='n8n-nodes-base.gmail' && node.parameters.sendTo)node.retryOnFail=false;
    if(node.name==='Send confirmed Gmail draft')node.retryOnFail=false;
  }
  const notes=[
    ['START HERE — Unified system',[-180,-1140],'# One workflow, five independent paths\nImport as a new INACTIVE workflow. Keep the three original workflows as rollback copies. Deactivate them before publishing this workflow.\n\nManual system check is read-only. The minute/hour triggers run separately, so a sync failure does not stop sending or intake. Dashboard sending still requires approval and explicit confirmation.\n\nGemini, Gmail, Sheets and CRM use your existing saved credentials. Gemini is the only AI provider.'],
    ['01 — Email inquiries',[-180,-330],'# 1. Incoming customer email\nEvery five minutes: screen new messages, use Gemini, create a draft and publish the inquiry to the dashboard. AI failure becomes manual review; support replies are never auto-sent.'],
    ['02 — Forms and agreed follow-ups',[-180,790],'# 2. Form inquiries and follow-ups\nYour original form address, validation and Sheets columns are preserved. Hourly follow-ups must also claim the current CRM lead before reserving Sheets or sending. A manual reply or unsaved change blocks that claim.'],
    ['03 — Dashboard changes',[-180,2460],'# 3. Save dashboard changes\nEvery minute: apply ordered lead/review updates to the same Sheet and eligible Gmail drafts. Initial capture only indexes the draft; it never sends or overwrites it.'],
    ['04 — Confirmed replies',[-180,4230],'# 4. Owner-confirmed sending\nEvery minute: claim one explicitly confirmed reply after its saved changes finish syncing. Preserve recipient/thread checks. A send is never retried automatically. An uncertain send stays on hold for review.'],
  ];
  for(const [name,position,content] of notes)add(name,'stickyNote',{content,width:880,height:name.startsWith('START')?350:220,color:name.startsWith('03')?5:name.startsWith('04')?4:6},position);

  // The installed CLI runner can fall back to the first trigger despite its
  // advertised startNodes. Keep the entire read-only manual path first.
  const manualPath=['Manual system check','Check CRM connection','Check Gmail connection','Check Sheets connection','System check complete'];
  workflow.nodes=[...manualPath.map(get),...workflow.nodes.filter(node=>!manualPath.includes(node.name))];

  report.nodeCount=workflow.nodes.length;
  report.credentialReferences=Object.fromEntries(['httpHeaderAuth','gmailOAuth2','googleSheetsOAuth2Api'].map(kind=>[kind,[...new Set(workflow.nodes.map(node=>node.credentials?.[kind]?.id).filter(Boolean))]]));
  report.spreadsheetId=sheetId;
  report.formWebhookId=get('FORM — Customer Inquiry').webhookId;
  report.preservedLiveHelperFixes=['Plain-text Gmail drafts','RAW Sheets reads','Missing-draft diagnostics','Wrapped MIME bodies','Unicode subject folding'];
  report.manualTriggerCount=workflow.nodes.filter(isManual).length;
  report.independentScheduleCount=workflow.nodes.filter(node=>node.type==='n8n-nodes-base.scheduleTrigger').length;
  installFollowUpReview(workflow);
  validateUnified(workflow);
  return {workflow,report};
}

export function validateUnified(workflow) {
  const names=new Set(workflow.nodes.map(node=>node.name));
  if(names.size!==workflow.nodes.length)throw Error('Duplicate node names in unified workflow.');
  if(new Set(workflow.nodes.map(node=>node.id)).size!==workflow.nodes.length)throw Error('Duplicate node IDs.');
  if(workflow.nodes.filter(isManual).length!==1)throw Error('n8n permits exactly one Manual Trigger.');
  if(workflow.nodes[0]?.name!=='Manual system check')throw Error('The read-only Manual Trigger must precede all business triggers.');
  if(workflow.active!==false)throw Error('The import must remain inactive until cutover.');
  for(const node of workflow.nodes){
    if(node.type==='n8n-nodes-base.code')new Function(node.parameters.jsCode);
    if(/openai|api\.openai\.com|\$env\.OPENAI/i.test(node.name+' '+JSON.stringify(node.parameters)))throw Error('OpenAI content remains in '+node.name);
    for(const name of refs(node.parameters))if(!names.has(name))throw Error('Unresolved node reference from '+node.name+' to '+name);
  }
  for(const [from,outputs] of Object.entries(workflow.connections)){
    if(!names.has(from))throw Error('Unknown connection source: '+from);
    for(const branches of Object.values(outputs))for(const item of branches.flat())if(!names.has(item.node))throw Error('Unknown connection destination: '+item.node);
  }
  const outgoing=name=>(workflow.connections[name]?.main || []).flat().map(item=>item.node);
  if(outgoing('Poll every minute').join(',')!=='Bridge settings')throw Error('Sync schedule must remain independent.');
  if(outgoing('Check queued replies every minute').join(',')!=='Read sending Gmail account')throw Error('Sender schedule must remain independent.');
  if(outgoing('Claim approved reply').join(',')!=='Reply waiting?')throw Error('Mail claim must run once outside the sync loop.');
  if(outgoing('FILTER — Pending Consented Follow-Ups').join(',')!=='Claim consented follow-up')throw Error('Follow-ups must be reserved atomically in the CRM first.');
  return true;
}
