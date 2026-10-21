// Explicit maintenance operation. Requires a quiescent CRM, approved private
// reset plan, immutable backup, and verified Sheet clear before applying.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const flags=process.argv.slice(2), applying=flags.includes('--apply');
assert(flags.every(flag=>flag==='--apply'||flag.startsWith('--plan=')),'Unsupported reset argument.');
const selected=flags.find(flag=>flag.startsWith('--plan='))?.slice(7);
assert(selected,'Provide the approved reset plan.');
const planFile=path.resolve(root,selected), privateRoot=path.join(root,'private-integrations')+path.sep;
assert(planFile.startsWith(privateRoot),'The reset plan must stay in private-integrations.');
const plan=JSON.parse(fs.readFileSync(planFile,'utf8'));
assert(plan.approved===true && plan.scope==='dashboard-and-sheet-data-rows','This reset scope was not approved.');
const directory=path.dirname(planFile);
const listening=await new Promise(resolve=>{
  const socket=net.connect({host:'127.0.0.1',port:3001});
  socket.setTimeout(2000);
  socket.once('connect',()=>{socket.destroy();resolve(true);});
  socket.once('error',()=>{socket.destroy();resolve(false);});
  socket.once('timeout',()=>{socket.destroy();resolve(true);});
});
assert(!listening,'Stop the CRM server before resetting its data.');
const filename=path.join(root,'templates','leads','.data','crm.json');
const raw=fs.readFileSync(filename,'utf8'), before=JSON.parse(raw);
assert.equal(before.version,1);
const fields=['leads','drafts','tasks','activities','syncChanges','mailJobs'];
for(const field of fields)assert(Array.isArray(before[field]),'Invalid CRM array: '+field);
assert(!before.mailJobs.some(job=>['Queued','Sending','Needs Review'].includes(job.status)),'Resolve active or uncertain delivery jobs before resetting.');
assert(!before.leads.some(lead=>lead.followUpState==='Reserved'),'Resolve any reserved follow-up before resetting.');
const hash=value=>createHash('sha256').update(value).digest('hex');
const backup=path.join(directory,'crm-before.json');
if(fs.existsSync(backup))assert.equal(hash(fs.readFileSync(backup)),hash(raw),'CRM changed after its reset backup.');
else fs.writeFileSync(backup,raw,{flag:'wx',mode:0o600});
const archiveIds=[...new Set([
  ...(before.archivedLeadIds||[]),...before.leads.map(item=>item.id),
  ...before.drafts.map(item=>item.leadId),...before.mailJobs.map(item=>item.leadId),
  ...before.syncChanges.map(item=>item.leadId),...(plan.sheetLeadIds||[]),
].filter(id=>typeof id==='string'&&id))];
const after={...before,...Object.fromEntries(fields.map(field=>[field,[]])),archivedLeadIds:archiveIds};
const protectedFields=Object.keys(before).filter(key=>!fields.includes(key)&&key!=='archivedLeadIds');
for(const field of protectedFields)assert.deepEqual(after[field],before[field],'A protected field changed: '+field);
const summary={
  applied:applying,backup: path.relative(root,backup),
  before:Object.fromEntries(fields.map(field=>[field,before[field].length])),
  after:Object.fromEntries(fields.map(field=>[field,0])),
  archivedLeadCount:archiveIds.length,settingsPreserved:true,
  senderRegistrationPreserved:true,processedEventIdsPreserved:true,liveEmailSent:false,
};
if(applying){
  const sheet=JSON.parse(fs.readFileSync(path.join(directory,'sheet-cleared.json'),'utf8'));
  assert(sheet.verified===true&&sheet.spreadsheetId===plan.spreadsheetId,'Verify the authorized Sheet clear first.');
  const temporary=path.join(path.dirname(filename),'crm-reset-'+randomUUID()+'.tmp');
  try{
    fs.writeFileSync(temporary,JSON.stringify(after,null,2)+'\n',{flag:'wx',mode:0o600});
    assert.equal(hash(fs.readFileSync(filename)),hash(raw),'CRM changed during reset preparation.');
    fs.renameSync(temporary,filename);
  }finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
  assert.deepEqual(JSON.parse(fs.readFileSync(filename,'utf8')),after);
  fs.writeFileSync(path.join(directory,'crm-reset-result.json'),JSON.stringify(summary,null,2)+'\n',{mode:0o600});
}
console.log(JSON.stringify(summary));
