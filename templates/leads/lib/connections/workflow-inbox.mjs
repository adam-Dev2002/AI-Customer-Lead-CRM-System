import { createHash } from 'node:crypto';

// Fixed, tenant-bound telemetry. Never include email text, provider responses,
// addresses, tokens or arbitrary exception messages in an inbox status event.
export function addInboxReporting(workflow, crmCredentialId) {
  const nodes = workflow.nodes, byName = name => nodes.find(n => n.name === name);
  if (byName('Inbox scan started')) return workflow;
  const edge = node => ({ node, type: 'main', index: 0 });
  const link = (a, b) => { workflow.connections[a] = { main: [[edge(b)]] }; };
  const add = (name, type, parameters, position) => {
    const h = createHash('sha256').update('inbox-reporting-v1:' + name).digest('hex');
    const node = { id: `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`, name, type: 'n8n-nodes-base.' + type, typeVersion: type === 'httpRequest' ? 4.2 : 2, position, parameters };
    nodes.push(node); return node;
  };
  const event = (phase, values = '') => `return [{json:{eventId:$execution.id+':inbox:${phase}'+${phase === 'processing' ? "':' + $runIndex" : "''"},type:'inbox.scan',data:{runId:String($execution.id),startedAt:$('Inbox scan started').first().json.data.startedAt,phase:'${phase}'${values}}}}];`;
  const publish = (name, position) => {
    const node = add(name, 'httpRequest', { method: 'POST', url: 'https://crm.example.invalid/api/n8n/events', authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', sendBody: true, specifyBody: 'json', jsonBody: '={{ $json }}', options: { timeout: 15000 } }, position);
    node.credentials = { httpHeaderAuth: { id: crmCredentialId, name: 'CustomerLead crm' } };
    node.retryOnFail = true; node.maxTries = 3; node.waitBetweenTries = 1000;
    // An unavailable status receiver must not lose an inquiry or repeat a send.
    node.onError = 'continueRegularOutput';
  };
  byName('START — Every 5 Minutes').parameters.rule.interval = [{ field: 'minutes', minutesInterval: 5 }];
  add('Inbox scan started', 'code', { jsCode: "return [{json:{eventId:$execution.id+':inbox:checking',type:'inbox.scan',data:{runId:String($execution.id),startedAt:new Date().toISOString(),phase:'checking'}}}];" }, [-2400,180]);
  publish('Report inbox check', [-2200,180]);
  link('START — Every 5 Minutes', 'Inbox scan started'); link('Inbox scan started', 'Report inbox check'); link('Report inbox check', 'Business entry 1');

  byName('Gmail — Find Unhandled Customer Emails').alwaysOutputData = true;
  add('Inbox messages found', 'code', { jsCode: "const matched=$input.all().filter(i=>i.json.id).length;\n" + event('fetched', ",matched,phase:matched?'processing':'complete'") }, [700,1100]);
  publish('Report inbox matches', [920,1100]);
  add('Continue matching emails', 'code', { jsCode: "return $('Gmail — Find Unhandled Customer Emails').all().filter(i=>i.json.id);" }, [1140,1100]);
  link('Gmail — Find Unhandled Customer Emails', 'Inbox messages found'); link('Inbox messages found', 'Report inbox matches'); link('Report inbox matches', 'Continue matching emails'); link('Continue matching emails', 'LOOP — One Email At A Time');
  add('Inbox message progress', 'code', { jsCode: event('processing', ",matched:$('Inbox messages found').first().json.data.matched,current:$runIndex+1") }, [1400,1100]);
  publish('Report inbox progress', [1620,1100]);
  add('Continue email processing', 'code', { jsCode: "return $('Gmail — Read Full Email').all(0,$runIndex);" }, [1840,1100]);
  link('Gmail — Read Full Email', 'Inbox message progress'); link('Inbox message progress', 'Report inbox progress'); link('Report inbox progress', 'Continue email processing'); link('Continue email processing', 'Prepare Email + Safety Screen');
  add('Inbox scan completed', 'code', { jsCode: event('complete', ",matched:$('Inbox messages found').first().json.data.matched") }, [4500,1100]);
  publish('Report completed inbox check', [4720,1100]);
  link('END — Batch Complete', 'Inbox scan completed'); link('Inbox scan completed', 'Report completed inbox check');

  const groups = {
    checking: ['Validate business setup', 'Verify connected business Gmail', 'Require matching business Gmail', 'Read shared email configuration', 'CONFIG — BUSINESS, FAQ & AI MODELS', 'Gmail — List Labels', 'Verify Gmail Labels'],
    fetching: ['Gmail — Find Unhandled Customer Emails'],
    processing: ['LOOP — One Email At A Time', 'Gmail — Read Full Email', 'Prepare Email + Safety Screen', 'IF — Eligible Customer Email?', 'Gmail — Lock For Processing', 'CHECK — Email AI Enabled?', 'Compose Trusted AI Prompt', 'Parse Gemini Result', 'Review AI & Route', 'IF — Create Customer Draft?', 'Prepare manual email review', 'Gmail — Create Draft (NEVER SEND)', 'Gmail — Label Draft Outcome', 'Gmail — Label No-Draft Outcome', 'Gmail — Remove Processing Lock', 'Gmail — Mark Skipped', 'Email support processed', 'Publish Email support processed', 'Email inquiry without draft', 'Publish Email inquiry without draft', 'Email screening result', 'Publish Email screening result'],
  };
  add('Stop failed inbox check', 'stopAndError', { errorMessage: 'Inbox processing stopped. Review the saved inbox status in CustomerLead.' }, [2550,1580]).typeVersion = 1;
  for (const [stage, sources] of Object.entries(groups)) {
    const name = 'Inbox failure — ' + stage;
    add(name, 'code', { jsCode: `if($('Business connection').first().json._businessPath!=='business-path-1') throw new Error('A business connection check failed.');
const raw=$input.first().json; const message=JSON.stringify(raw.error||raw);
const code=/401|403|invalid.grant|invalid.client|authenticat|permission|access.denied/i.test(message)?'gmail-access':/429|quota|rate.limit/i.test(message)?'gmail-busy':${JSON.stringify(stage === 'checking' ? 'setup-failed' : stage === 'fetching' ? 'gmail-unavailable' : 'processing-failed')};
` + event('failed', ",code,stage:'" + stage + "'") }, [2100,1400 + Object.keys(groups).indexOf(stage)*180]);
    publish('Report ' + stage + ' failure', [2320,1400 + Object.keys(groups).indexOf(stage)*180]);
    link(name, 'Report ' + stage + ' failure');
    link('Report ' + stage + ' failure', 'Stop failed inbox check');
    for (const source of sources) {
      const node = byName(source); if (!node) throw new Error('Missing inbox step: ' + source);
      if (node.onError) continue; // Retain existing AI fallback and delivery rules.
      node.onError = 'continueErrorOutput';
      const connection = workflow.connections[source] ??= { main: [[]] };
      // IF and Loop nodes have two normal outputs. The error output is added
      // after BOTH; replacing output 1 would turn a normal branch into a failure.
      connection.main[Math.max(1, connection.main.length)] = [edge(name)];
    }
  }
  // Retries are limited to read-only Gmail requests. Gmail mutations, drafts,
  // delivery, claims and follow-up reservations keep their existing semantics.
  for (const name of ['Verify connected business Gmail', 'Gmail — List Labels', 'Gmail — Find Unhandled Customer Emails', 'Gmail — Read Full Email']) {
    const node = byName(name); node.retryOnFail = true; node.maxTries = 3; node.waitBetweenTries = 1000;
  }
  return workflow;
}
