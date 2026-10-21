// Run only the verified read-only Manual system check. Never forward CLI logs.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

process.umask(0o077);
const stage = path.dirname(fileURLToPath(import.meta.url));
const expectedNames = ['Manual system check', 'Check CRM connection', 'Check Gmail connection', 'Check Sheets connection', 'System check complete'];
class SafeError extends Error {}
const ensure = (condition, message) => { if (!condition) throw new SafeError(message); };
const readJSON = filename => JSON.parse(fs.readFileSync(path.join(stage, filename), 'utf8').replace(/^\uFEFF/, ''));
const targets = (connections, name) => Object.values(connections[name] || {}).flatMap(outputs => outputs.flatMap(output => output.map(edge => edge.node)));

// n8n writes status messages before raw JSON. Parse complete balanced objects,
// respecting strings/escapes, and never expose unparsed output on failure.
function jsonObjects(output) {
  const objects = [];
  let attempts = 0;
  for (let start = 0; start < output.length && attempts < 10000; start++) {
    if (output[start] !== '{') continue;
    attempts++;
    let depth = 0, quoted = false, escaped = false;
    for (let end = start; end < output.length; end++) {
      const character = output[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') quoted = false;
      } else if (character === '"') quoted = true;
      else if (character === '{') depth++;
      else if (character === '}') {
        depth--;
        if (!depth) {
          try { objects.push(JSON.parse(output.slice(start, end + 1))); start = end; } catch {}
          break;
        }
      }
    }
  }
  return objects;
}
function findRun(objects) {
  const queue = [...objects];
  while (queue.length) {
    const item = queue.shift();
    if (!item || typeof item !== 'object') continue;
    if (item.data?.resultData?.runData) return item;
    queue.push(...Object.values(item).filter(value => value && typeof value === 'object'));
  }
  return null;
}
async function availableBrokerPort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return String(port);
}
let db;
try {
  ensure(/^\/tmp\/customerlead-check-[0-9a-f]{32}$/.test(stage), 'Unexpected private check directory.');
  if (process.argv.includes('--cleanup')) {
    fs.rmSync(stage, { recursive: true, force: true });
    process.exit(0);
  }
  ensure(process.argv.length === 2, 'Unsupported connection-check argument.');
  const imported = readJSON('import-result.json');
  const raw = fs.readFileSync(path.join(stage, 'customerlead-unified-gemini.json'));
  ensure(createHash('sha256').update(raw).digest('hex') === imported.preparedSha256, 'The prepared workflow changed since its verified import.');
  const prepared = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, ''));
  ensure(typeof imported.workflowId === 'string' && imported.active === false && imported.ready === true, 'A verified inactive import result is required.');
  db = new DatabaseSync('/home/node/.n8n/database.sqlite', { readOnly: true });
  const getWorkflow = () => db.prepare('SELECT * FROM workflow_entity WHERE id=? AND isArchived=0').get(imported.workflowId);
  const before = getWorkflow();
  ensure(before && !before.active && !before.activeVersionId, 'The selected workflow must still be inactive.');
  const nodes = JSON.parse(before.nodes), connections = JSON.parse(before.connections);
  ensure(isDeepStrictEqual(nodes, prepared.nodes) && isDeepStrictEqual(connections, prepared.connections), 'The imported graph differs from the reviewed prepared workflow.');
  // n8n 2.43.8's runtime can use the first node even when CLI start discovery
  // finds the manual trigger. Require the complete safe chain first as well.
  ensure(isDeepStrictEqual(nodes.slice(0, 5).map(node => node.name), expectedNames), 'The five read-only check nodes must be first in the saved workflow array. Execution was blocked.');
  ensure(nodes[0].type === 'n8n-nodes-base.manualTrigger' && nodes.filter(node => node.type === 'n8n-nodes-base.manualTrigger').length === 1, 'The saved workflow must begin with its only Manual system check trigger.');
  const require = createRequire(import.meta.url);
  const { findCliWorkflowStart } = require('/usr/local/lib/node_modules/n8n/dist/utils.js');
  ensure(typeof findCliWorkflowStart === 'function', 'The installed n8n CLI start-node check is unavailable.');
  const start = findCliWorkflowStart(nodes);
  ensure(start?.name === expectedNames[0] && start.type === 'n8n-nodes-base.manualTrigger', 'The installed CLI would not start at Manual system check. Execution was blocked.');
  const reached = new Set(), remaining = [start.name];
  while (remaining.length) {
    const name = remaining.shift();
    if (reached.has(name)) continue;
    reached.add(name);
    remaining.push(...targets(connections, name));
  }
  ensure(reached.size === 5 && expectedNames.every(name => reached.has(name)), 'The manual check reaches an unexpected workflow path. Execution was blocked.');
  for (let index = 0; index < expectedNames.length; index++) {
    const name = expectedNames[index];
    const node = nodes.find(item => item.name === name);
    const next = index < 4 ? [expectedNames[index + 1]] : [];
    ensure(node && isDeepStrictEqual(targets(connections, name), next), 'The read-only system-check chain has changed.');
    ensure(!node.disabled && !node.executeOnce && node.type !== 'n8n-nodes-base.executeWorkflowTrigger', 'An expected check node has unsupported execution settings.');
    if (index >= 1 && index <= 3) {
      ensure(node.type === 'n8n-nodes-base.httpRequest' && (node.parameters.method || 'GET') === 'GET', 'The system check contains a request that is not read-only GET.');
      const url = new URL(node.parameters.url);
      ensure(!url.username && !url.password && ['http:', 'https:'].includes(url.protocol), 'The system-check request address is unsupported.');
      if (index === 1) ensure(url.pathname === '/api/n8n/health' && !url.search, 'The CRM check must use the read-only health endpoint.');
      if (index === 2) ensure(url.href === 'https://gmail.googleapis.com/gmail/v1/users/me/profile', 'The Gmail check must only read the account profile.');
      if (index === 3) ensure(url.protocol === 'https:' && url.hostname === 'sheets.googleapis.com' && /^\/v4\/spreadsheets\/[^/]+$/.test(url.pathname), 'The Sheets check must only read spreadsheet metadata.');
    }
    if (index === 4) ensure(node.type === 'n8n-nodes-base.code', 'The completion step has an unexpected node type.');
  }
  const latestExecution = () => db.prepare('SELECT id FROM execution_entity WHERE workflowId=? ORDER BY id DESC LIMIT 1').get(imported.workflowId)?.id || null;
  const previousExecutionId = latestExecution();
  const brokerPort = await availableBrokerPort();
  const result = spawnSync('n8n', ['execute', '--id=' + imported.workflowId, '--rawOutput'], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 90000,
    env: { ...process.env, N8N_RUNNERS_BROKER_PORT: brokerPort, NODE_NO_WARNINGS: '1', NO_COLOR: '1' },
  });
  ensure(result.status === 0 && !result.error, 'The read-only connection check did not finish successfully. Private n8n output was withheld.');
  const run = findRun(jsonObjects(result.stdout || '')) || findRun(jsonObjects(result.stderr || ''));
  ensure(run && !run.data.resultData.error && run.finished !== false, 'The read-only connection check returned no successful execution result. Private output was withheld.');
  const runData = run.data.resultData.runData;
  const executedNodeNames = Object.keys(runData);
  ensure(executedNodeNames.length === 5 && expectedNames.every(name => executedNodeNames.includes(name)), 'The execution did not contain exactly the five read-only check nodes. Recorded steps: '+executedNodeNames.join(', '));
  const completed = runData['System check complete'];
  const json = completed?.[completed.length - 1]?.data?.main?.[0]?.[0]?.json;
  ensure(json?.ready === true && json.mailSent === false && typeof json.gmailAccount === 'string' && typeof json.spreadsheet === 'string' && Array.isArray(json.tabs), 'The system check did not confirm all required connections.');
  const after = getWorkflow();
  ensure(after && !after.active && !after.activeVersionId && after.nodes === before.nodes && after.connections === before.connections, 'The inactive workflow state did not verify after the check.');
  const latestId = latestExecution();
  // Only completion fields are allowed out; never return raw HTTP responses.
  console.log(JSON.stringify({
    ready: true,
    result: { ready: true, gmailAccount: json.gmailAccount, spreadsheet: json.spreadsheet, tabs: json.tabs, mailSent: false, message: 'Connections checked. No customer data was changed and no email was sent.' },
    executedNodeNames,
    executionId: latestId !== previousExecutionId ? latestId : null,
    workflowId: imported.workflowId,
    active: false,
  }));
} catch (error) {
  console.log(JSON.stringify({ ready: false, error: error instanceof SafeError ? error.message : 'The read-only system check could not be completed. No private command output was displayed.' }));
  process.exitCode = 1;
} finally {
  db?.close();
}
