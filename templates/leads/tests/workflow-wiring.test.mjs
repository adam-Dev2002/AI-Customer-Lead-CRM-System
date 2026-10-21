import test from 'node:test';
import assert from 'node:assert/strict';
import { readReviewedWorkflow } from '../../../scripts/n8n/workflow-reference.mjs';
import { upgradeMain, verifyWorkflow } from '../../../scripts/n8n/upgrade-workflows.mjs';

const main=upgradeMain(structuredClone(readReviewedWorkflow().workflow));
const get=name=>main.nodes.find(n=>n.name===name);
const destinations=(name,branch=0)=>(main.connections[name]?.main?.[branch]||[]).map(e=>e.node);

test('connected automation keeps form capture, shared configuration and both AI fallback paths',()=>{
  assert.equal(verifyWorkflow(main),true);
  assert(destinations('TAG — Form Submission').includes('Keep inquiry context'));
  assert(destinations('START — Manual Test').includes('Read shared email configuration'));
  assert(destinations('IF — Primary Gemini?',1).includes('AI — OpenAI Primary'));
  assert(destinations('IF — Gemini Valid?',1).includes('AI — OpenAI Backup'));
  assert(destinations('Gmail — Create Draft (NEVER SEND)').includes('Gmail — Label Draft Outcome'));
  assert.equal(get('Gmail — Create Draft (NEVER SEND)').parameters.options.sendTo,'={{ $json.sender }}');
  const fields={Name:'Captured Customer',workflow_branch:'new_lead'};
  const shared={business_name:'QA Plumbing',send_emails_enabled:false};
  const result=new Function('$input','$',get('CONFIG — BUSINESS SETTINGS (EDIT HERE)').parameters.jsCode)({first:()=>({json:{config:shared}})},()=>({all:()=>[{json:fields}]}));
  assert.equal(result[0].json.Name,fields.Name);
  assert.equal(result[0].json._cfg.send_emails_enabled,false);
});

function simulateFormEmails(flags){
  const row={Lead_ID:'QA-LEAD',Name:'QA Customer',Email:'qa@example.com'};
  const outputs=new Map([['CONFIG — BUSINESS SETTINGS (EDIT HERE)',{_cfg:{owner_email:'owner@example.com',...flags}}],['SHEETS — Append Customer Lead',row]]);
  const select=name=>({first:()=>({json:outputs.get(name)}),item:{json:outputs.get(name)}});
  let name='CHECK — Customer Emails Enabled?', input=row;
  const sends=[];
  for(let steps=0;steps<20;steps++){
    const n=get(name);assert(n,`Missing route node ${name}`);
    outputs.set(name,input);
    if(name==='SHEETS — Save Initial Email Results')return {sends,row:input};
    let branch=0;
    if(n.type==='n8n-nodes-base.if'){
      const expression=n.parameters.conditions.conditions[0].leftValue.slice(3,-2).trim();
      branch=new Function('$','$json',`return (${expression});`)(select,input)?0:1;
    }else if(n.type==='n8n-nodes-base.code'){
      input=new Function('$','$json',n.parameters.jsCode)(select,input).json;
    }else if(n.type==='n8n-nodes-base.gmail'){
      sends.push(name);input={id:'SIMULATED-ONLY'};
    }
    name=destinations(name,branch)[0];
  }
  throw Error('Initial-email route did not finish.');
}

test('automatic master and individual switches control acknowledgements and owner alerts independently',()=>{
  for(const [master,ack,owner,expected] of [
    [false,true,true,[]],
    [true,true,false,['GMAIL — Acknowledge Inquiry']],
    [true,false,true,['GMAIL — Alert Business Owner']],
    [true,true,true,['GMAIL — Acknowledge Inquiry','GMAIL — Alert Business Owner']],
    [true,false,false,[]],
  ]){
    const result=simulateFormEmails({send_emails_enabled:master,send_customer_ack:ack,send_owner_alert:owner});
    assert.deepEqual(result.sends,expected);
    assert.equal(result.row.Acknowledgement_Status,master&&ack?'Sent':'Disabled');
    assert.equal(result.row.Owner_Alert_Status,master&&owner?'Sent':'Disabled');
    assert.equal(result.row.Lead_ID,'QA-LEAD');
  }
});

test('AI-disabled email still becomes a manual-review inquiry without a fabricated draft',()=>{
  const email={message_id:'qa-message',sender:'customer@example.com',subject:'Inspection',body:'Please inspect the tap.'};
  const prepared=new Function('$',get('Prepare manual email review').parameters.jsCode)(()=>({item:{json:email}})).json;
  const outcome=new Function('$json',get('Review AI & Route').parameters.jsCode)(prepared).json;
  assert.equal(outcome.valid,true);
  assert.equal(outcome.create_draft,false);
  assert.equal(outcome.message_id,email.message_id);
  assert.match(outcome.reason,/disabled/);
  assert(destinations('Gmail — Label No-Draft Outcome').includes('Email inquiry without draft'));
});
