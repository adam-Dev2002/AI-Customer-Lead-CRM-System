import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { combineWorkflows } from './n8n/unified-workflow.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const reference=JSON.parse(readFileSync(new URL('./n8n/unified-sources.json',import.meta.url),'utf8'));
const sources={};
for(const source of reference.sources){
  const raw=readFileSync(source.path);
  if(createHash('sha256').update(raw).digest('hex')!==source.sha256)throw Error('A selected source changed after review: '+source.role);
  sources[source.role]=JSON.parse(raw.toString('utf8'));
  if(sources[source.role].nodes.length!==source.nodeCount)throw Error('Unexpected source node count: '+source.role);
}
const {workflow,report}=combineWorkflows(sources);
const directory=path.join(root,'private-integrations');
const backup=path.join(directory,'source-backups',new Date().toISOString().replace(/[:.]/g,'-'));
mkdirSync(backup,{recursive:true,mode:0o700});
for(const source of reference.sources)copyFileSync(source.path,path.join(backup,path.basename(source.path)));
const output=path.join(directory,'customerlead-unified-gemini.json');
writeFileSync(output,JSON.stringify(workflow,null,2)+'\n',{mode:0o600});
writeFileSync(path.join(directory,'validation-report.json'),JSON.stringify({...report,sourceReview:reference.reviewedOn,active:false,liveImported:false,liveMailSent:false},null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({file:path.relative(root,output),nodeCount:report.nodeCount,previousNodes:report.sourceNodeCount,manualTriggers:report.manualTriggerCount,independentSchedules:report.independentScheduleCount,active:false,credentialBindingsPreserved:report.preservedCredentialBindings,inlineKeyHeadersRemoved:report.removedInlineKeyHeaders,sourceBackups:path.relative(root,backup),liveChanges:false}));
