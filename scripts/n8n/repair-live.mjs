// Runs inside the user's n8n container. CLI output/exports may contain private
// workflow parameters: capture them, keep backups private, print summaries only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { upgradeMain, upgradeBridge, upgradeSender, verifyWorkflow } from './upgrade-workflows.mjs';

process.umask(0o077);
const apply=process.argv.includes('--apply');
const stage=path.dirname(fileURLToPath(import.meta.url));
if(process.argv.includes('--cleanup')){
  assert(/^\/tmp\/customerlead-repair-[0-9a-f]{32}$/.test(stage));
  fs.rmSync(stage,{recursive:true,force:true});
  process.exit(0);
}
const db=new DatabaseSync('/home/node/.n8n/database.sqlite',{readOnly:true});
const rows=db.prepare('SELECT id,name,active,versionId,updatedAt,nodes FROM workflow_entity WHERE isArchived=0').all();
const candidates=rows.map(row=>({...row,parsedNodes:JSON.parse(row.nodes)}));
const pick=predicate=>{const found=candidates.filter(c=>predicate(c.parsedNodes));assert.equal(found.length,1,'Expected one matching workflow.');return found[0];};
const main=pick(ns=>ns.some(n=>n.name==='FORM — Customer Inquiry')&&ns.some(n=>n.name==='Gmail — Create Draft (NEVER SEND)'));
const sync=pick(ns=>ns.some(n=>n.name==='Read owner changes')&&!ns.some(n=>n.name==='Claim approved reply'));
const sender=pick(ns=>ns.some(n=>n.name==='Claim approved reply')&&!ns.some(n=>n.name==='Read owner changes'));
const selected=[main,sync,sender];
const emailCfg=main.parsedNodes.find(n=>n.name==='CONFIG — BUSINESS, FAQ & AI MODELS');
const literals=Object.fromEntries(emailCfg.parameters.assignments.assignments.filter(a=>typeof a.value!=='string'||!a.value.startsWith('={{')).map(a=>[a.name,a.value]));
const leadCfg=main.parsedNodes.find(n=>n.name==='CONFIG — BUSINESS SETTINGS (EDIT HERE)').parameters.jsCode;
const suggestedSettings={};
for(const [key,field] of Object.entries({primaryAI:'primary_ai',geminiModel:'gemini_model',openaiModel:'openai_model',gmailQuery:'gmail_query',maxEmailsPerScan:'max_emails_per_scan'}))if(literals[field]!==undefined)suggestedSettings[key]=literals[field];
const master=leadCfg.match(/send_emails_enabled:\s*(true|false)/);
if(master)suggestedSettings.automaticEmailsEnabled=master[1]==='true';
if(!apply){console.log(JSON.stringify({mode:'plan',workflows:selected.map(r=>({id:r.id,name:r.name,active:!!r.active,nodeCount:r.parsedNodes.length})),suggestedSettings}));db.close();process.exit(0);}

const cli=args=>{
  const result=spawnSync('n8n',args,{encoding:'utf8',maxBuffer:4e6});
  assert.equal(result.status,0,'n8n CLI operation failed: '+args[0]);
};
const directory='/home/node/.n8n/customerlead-backups/'+new Date().toISOString().replace(/[:.]/g,'-');
fs.mkdirSync(directory,{recursive:true,mode:0o700});
const backups=new Map();
for(const row of selected){const file=path.join(directory,row.id+'.json');cli(['export:workflow','--id='+row.id,'--output='+file]);fs.chmodSync(file,0o600);backups.set(row.id,file);}
const prepared=JSON.parse(fs.readFileSync(path.join(stage,'customerlead-sync-bridge.json'),'utf8'));
const upgrades=[];
for(const row of selected){
  const original=JSON.parse(fs.readFileSync(backups.get(row.id),'utf8'))[0];
  assert.deepEqual(original.nodes,row.parsedNodes,'Workflow changed during preparation.');
  const workflow=structuredClone(original);
  if(row.id===main.id)upgradeMain(workflow);
  else if(row.id===sync.id)upgradeBridge(workflow,prepared);
  else upgradeSender(workflow);
  const crmCredential=sync.parsedNodes.find(n=>n.name==='Read owner changes')?.credentials?.httpHeaderAuth;
  assert(crmCredential,'Select CRM Header Auth on Read owner changes first.');
  for(const n of workflow.nodes.filter(n=>typeof n.parameters.url==='string'&&n.parameters.url.startsWith('http://host.docker.internal:3001/api/n8n/')))
    if(!n.credentials?.httpHeaderAuth)n.credentials={...n.credentials,httpHeaderAuth:structuredClone(crmCredential)};
  workflow.versionId=randomUUID();
  delete workflow.activeVersionId;
  delete workflow.activeVersion;
  verifyWorkflow(workflow);
  for(const node of original.nodes){
    const after=workflow.nodes.find(n=>n.id===node.id);
    assert(after,'Existing node was removed.');
    if(node.credentials)assert.deepEqual(after.credentials,node.credentials,'An existing credential binding changed.');
  }
  const project=db.prepare("SELECT projectId FROM shared_workflow WHERE workflowId=? AND role='workflow:owner'").get(row.id)?.projectId;
  assert(project,'Owner project not found.');
  const file=path.join(stage,'upgraded-'+row.id+'.json');
  fs.writeFileSync(file,JSON.stringify([workflow]),{mode:0o600});
  upgrades.push({row,workflow,file,project});
}
// Do not overwrite concurrent edits made while backups/patches were prepared.
for(const {row} of upgrades){const current=db.prepare('SELECT versionId,updatedAt,active FROM workflow_entity WHERE id=?').get(row.id);assert.equal(current.versionId,row.versionId);assert.equal(current.updatedAt,row.updatedAt);assert.equal(current.active,row.active);}
const changed=[];
try{
  for(const upgrade of upgrades){
    const {row,file,project,workflow}=upgrade;
    changed.push(upgrade);
    cli(['import:workflow','--input='+file,'--projectId='+project]);
    if(row.active)cli(['publish:workflow','--id='+row.id]);
    const saved=db.prepare('SELECT nodes,connections,active FROM workflow_entity WHERE id=?').get(row.id);
    assert.deepEqual(JSON.parse(saved.nodes),workflow.nodes);
    assert.deepEqual(JSON.parse(saved.connections),workflow.connections);
    assert.equal(!!saved.active,!!row.active);
  }
  console.log(JSON.stringify({mode:'applied',backupDirectory:directory,workflows:upgrades.map(u=>({id:u.row.id,name:u.workflow.name,nodeCount:u.workflow.nodes.length,active:!!u.row.active})),credentialBindingsPreserved:true,restartRequired:true}));
}catch(error){
  for(const u of changed){cli(['import:workflow','--input='+backups.get(u.row.id),'--projectId='+u.project]);if(u.row.active)cli(['publish:workflow','--id='+u.row.id]);}
  throw Error('Repair failed; restored the original workflow backups.');
}finally{
  for(const u of upgrades)fs.rmSync(u.file,{force:true});
  db.close();
}
