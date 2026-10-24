import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const businessSourceHash = '13c6167752c025c00971a1c34c24976ddebd2ece0baede8a153bb5c1de2d2773';
export const setupCode = `const s=$input.first().json;
if(!/^[a-f0-9-]{36}$/.test(s.workspaceId)||s.workspaceId==='clearflow') throw new Error('Choose the new business workspace UUID.');
if(!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(s.businessEmail)) throw new Error('Set the business inbox email.');
if(!/^[A-Za-z0-9_-]{20,}$/.test(s.spreadsheetId)||s.spreadsheetId.includes('PASTE_')||s.spreadsheetId===s.originalSpreadsheetId) throw new Error('Create a NEW empty business spreadsheet and paste its ID in Business connection.');
if(!s.geminiModel||s.geminiModel.includes('PASTE_')) throw new Error('Set the working Gemini model in Business connection.');
if(new URL(s.crmBaseUrl).origin!==s.crmBaseUrl||!s.crmBaseUrl.startsWith('https://')) throw new Error('Use the HTTPS CRM origin without a trailing slash.');
return $input.all();`;
export const mailboxCode = `const profile=$input.first().json;
const original=$('Business connection').first();
if(String(profile.emailAddress||'').toLowerCase()!==String(original.json.businessEmail).toLowerCase()) throw new Error('Wrong Gmail credential. Connect the inbox specified in Business connection before processing.');
return [original];`;
export const sheetCode = `const sheet=$input.first().json;
const expected=$('Business connection').first().json.spreadsheetId;
const tabs=(sheet.sheets||[]).map(s=>s.properties?.title);
if(sheet.spreadsheetId!==expected||!tabs.includes('Leads')||!tabs.includes('ReplyReviews')) throw new Error('Wrong business spreadsheet or missing Leads / ReplyReviews tabs.');
return $input.all();`;
export const labelCode = `const labels=$input.first().json.labels||[];
const required=['AI-SUPPORT-PROCESSING','AI-SUPPORT-DRAFTED','AI-SUPPORT-REVIEW','AI-SUPPORT-SKIPPED'];
const missing=required.filter(name=>!labels.some(label=>label.name===name));
if(missing.length) throw new Error('Create these labels in the NEW Gmail account: '+missing.join(', '));
return $('Verify business spreadsheet').all();`;
const id = name => { const h=createHash('sha256').update('business-copy-v1:'+name).digest('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`; };
const edge = node => ({ node, type:'main', index:0 });

export function buildBusinessWorkflow(source, options) {
  assert.equal(source.nodes.length,128,'Review a changed source before rebuilding.');
  const w=structuredClone(source), original=structuredClone(source);
  const byName=name=>{const n=w.nodes.find(n=>n.name===name);assert(n,'Missing '+name);return n;};
  const bridge=byName('Bridge settings').parameters.assignments.assignments;
  const oldSheet=bridge.find(a=>a.name==='spreadsheetId').value;
  const oldBase=bridge.find(a=>a.name==='crmBaseUrl').value;
  const crmNames=new Set(source.nodes.filter(n=>n.credentials?.httpHeaderAuth&&JSON.stringify(n.parameters).includes('/api/n8n/')).map(n=>n.name));
  const geminiNames=new Set(source.nodes.filter(n=>n.credentials?.httpHeaderAuth&&!crmNames.has(n.name)).map(n=>n.name));
  assert.equal(geminiNames.size,2,'Review unexpected Header Auth nodes.');
  const bindings=[];
  for(const n of w.nodes){
    for(const type of Object.keys(n.credentials||{})) bindings.push({node:n.name,type,select:type==='gmailOAuth2'?'Business 2 - Gmail':type==='googleSheetsOAuth2Api'?'Business 2 - Sheets':crmNames.has(n.name)?'Business 2 - CRM':'Gemini API (existing approved key)'});
    delete n.credentials;
  }
  // Only connection configuration changes below; classification/send logic stays verbatim.
  for(const n of w.nodes){
    if(crmNames.has(n.name)&&n.parameters.url.startsWith(oldBase)) n.parameters.url=n.parameters.url.replace(oldBase,options.crmOrigin);
    if(n.type==='n8n-nodes-base.googleSheets') {
      n.parameters.documentId={__rl:true,value:"={{ $('Business connection').first().json.spreadsheetId }}",mode:'id'};
      if(n.parameters.sheetName.mode==='list')n.parameters.sheetName={__rl:true,value:'Leads',mode:'name'};
    }
    // Form webhook identity must differ when both businesses run at the same time.
    if(n.type==='n8n-nodes-base.formTrigger')n.webhookId=id('form:'+options.workspaceId);
  }
  for(const a of bridge){
    if(a.name==='crmBaseUrl')a.value="={{ $('Business connection').first().json.crmBaseUrl }}";
    if(a.name==='spreadsheetId')a.value="={{ $('Business connection').first().json.spreadsheetId }}";
  }
  const formConfig=w.nodes.find(n=>n.name.startsWith('CONFIG')&&n.parameters.jsCode);
  assert(formConfig.parameters.jsCode.includes("sheet_id:'"+oldSheet+"'"));
  formConfig.parameters.jsCode=formConfig.parameters.jsCode.replace("sheet_id:'"+oldSheet+"'","sheet_id:$('Business connection').first().json.spreadsheetId");
  // Empty new workspaces intentionally have no model; provide a per-copy model setting.
  formConfig.parameters.jsCode=formConfig.parameters.jsCode.replace("sheet_tab:'Leads'","sheet_tab:'Leads', gemini_model:$('Business connection').first().json.geminiModel, lead_ai_model:$('Business connection').first().json.geminiModel");
  for(const a of w.nodes.find(n=>n.name.startsWith('CONFIG')&&n.type.endsWith('.set')).parameters.assignments.assignments){
    if(a.name==='gmail_query')a.value="={{ 'in:inbox newer_than:2d to:' + $('Business connection').first().json.businessEmail + ' -from:me -label:AI-SUPPORT-PROCESSING -label:AI-SUPPORT-DRAFTED -label:AI-SUPPORT-REVIEW -label:AI-SUPPORT-SKIPPED' }}";
    if(a.name==='gemini_model')a.value="={{ $('Business connection').first().json.geminiModel }}";
  }
  byName('Check Sheets connection').parameters.url="={{ 'https://sheets.googleapis.com/v4/spreadsheets/' + $('Business connection').first().json.spreadsheetId + '?fields=spreadsheetId,properties(title),sheets(properties(title))' }}";
  const startNote=w.nodes.find(n=>n.name.startsWith('START HERE'));
  startNote.parameters.content='# Second business: separate inactive copy\nOriginal workflow is untouched. Keep the original business running independently.\nSet Business connection, then select the NEW Gmail, Sheets and CRM credentials using credential-mapping.csv. Never select the original CRM credential.\nRun ONLY Manual system check first. Publish only after the checklist passes. Dashboard account switching does not select Gmail credentials.\nThe manual check reads profile, metadata and labels; it sends no mail.';

  const add=(name,type,parameters,position,typeVersion=2)=>w.nodes.push({id:id(name),name,type:'n8n-nodes-base.'+type,typeVersion,position,parameters});
  const link=(a,b)=>w.connections[a]={main:[[edge(b)]]};
  const triggers=source.nodes.filter(n=>/Trigger$/.test(n.type));
  const routes=[];
  for(const [i,n]of triggers.entries()){
    const old=w.connections[n.name];
    assert.equal(old.main.length,1);assert.equal(old.main[0].length,1);
    const route='business-path-'+i, tag='Business entry '+i;
    routes.push({route,target:old.main[0][0].node,trigger:n.name});
    add(tag,'code',{jsCode:`return $input.all().map(item=>({...item,json:{...item.json,_businessPath:${JSON.stringify(route)}}}));`},[-1800,i*180]);
    link(n.name,tag);link(tag,'Business connection');
  }
  const settings={businessEmail:options.email,workspaceId:options.workspaceId,crmBaseUrl:options.crmOrigin,spreadsheetId:'PASTE_NEW_BUSINESS_SPREADSHEET_ID',geminiModel:options.geminiModel,originalSpreadsheetId:oldSheet};
  add('Business connection','set',{assignments:{assignments:Object.entries(settings).map(([name,value])=>({id:id('setting:'+name),name,value,type:'string'}))},includeOtherFields:true,options:{stripBinary:false}},[-1550,0],3.4);
  add('Validate business setup','code',{jsCode:setupCode},[-1300,0]);
  add('Verify connected business Gmail','httpRequest',{url:'https://gmail.googleapis.com/gmail/v1/users/me/profile',authentication:'predefinedCredentialType',nodeCredentialType:'gmailOAuth2',options:{timeout:15000}},[-1050,0],4.2);
  add('Require matching business Gmail','code',{jsCode:mailboxCode},[-800,0]);
  add('Route business execution','switch',{rules:{values:routes.map(r=>({conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:2},conditions:[{id:id(r.route),leftValue:'={{ $json._businessPath }}',rightValue:r.route,operator:{type:'string',operation:'equals'}}],combinator:'and'},renameOutput:true,outputKey:r.route}))},options:{}},[-550,0],3.2);
  link('Business connection','Validate business setup');link('Validate business setup','Verify connected business Gmail');link('Verify connected business Gmail','Require matching business Gmail');link('Require matching business Gmail','Route business execution');
  w.connections['Route business execution']={main:routes.map(r=>[edge(r.target)])};
  add('Verify business spreadsheet','code',{jsCode:sheetCode},[1050,-650]);
  add('Read business Gmail labels','httpRequest',{url:'https://gmail.googleapis.com/gmail/v1/users/me/labels',authentication:'predefinedCredentialType',nodeCredentialType:'gmailOAuth2',options:{timeout:15000}},[1300,-650],4.2);
  add('Verify business Gmail labels','code',{jsCode:labelCode},[1550,-650]);
  link('Check Sheets connection','Verify business spreadsheet');link('Verify business spreadsheet','Read business Gmail labels');link('Read business Gmail labels','Verify business Gmail labels');link('Verify business Gmail labels','System check complete');
  bindings.push(...['Verify connected business Gmail','Read business Gmail labels'].map(node=>({node,type:'gmailOAuth2',select:'Business 2 - Gmail'})));
  add('BUSINESS COPY - setup checklist','stickyNote',{content:'# New business setup\n1. Import into a NEW workflow, leave inactive.\n2. Create a NEW empty Sheet with Leads and ReplyReviews.\n3. Paste the Sheet ID in Business connection.\n4. Generate this workspace CRM token using the supplied guide.\n5. Bind credentials in credential-mapping.csv. All Gmail nodes must use the same NEW inbox.\n6. Create the four AI-SUPPORT labels.\n7. Run Manual system check. No email is sent.\n8. Set verified business facts and enable AI in this business dashboard. Leave automatic emails off for the first test.\n9. Publish the new copy and send a controlled inquiry from another mailbox.\nThe original workflow and its data are unchanged.',width:650,height:600,color:5},[-1850,-750],1);
  w.name='Business 2 - Customer support, leads and dashboard (Gemini only)';w.active=false;w.pinData={};
  delete w.id;delete w.versionId;delete w.meta;delete w.staticData;w.tags=[];
  const changedNodes=original.nodes.flatMap(before=>{const after=byName(before.name);const keys=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(k=>JSON.stringify(before[k])!==JSON.stringify(after[k]));return keys.length?[{name:before.name,fields:keys}]:[];});
  const report={sourceNodes:128,totalNodes:w.nodes.length,addedNodes:w.nodes.filter(n=>!source.nodes.some(o=>o.id===n.id)).map(n=>n.name),changedNodes,changedConnectionSources:Object.keys(w.connections).filter(k=>JSON.stringify(w.connections[k])!==JSON.stringify(original.connections[k])),routes,credentialBindings:bindings.length,originalSourceUnchanged:true,liveImported:false,liveExecuted:false,liveMailSent:false};
  return {workflow:w,report,bindings};
}
