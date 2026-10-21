// Read-only private review. Never print code, prompts, bodies, headers or keys.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { DatabaseSync } from 'node:sqlite';

const expected = { main: '8yrYwA0BHLqkdaNU', sync: 'MLz8oxiFRaHlEUWi', sender: 'xVUk4j8UMpJL2npU' };
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value) ?? 'undefined').digest('hex');
const oneWorkflow = value => Array.isArray(value) && value.length === 1 ? value[0] : value;
const describe = value => value === undefined ? { present: false } : {
  present: true, type: Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value,
  ...(typeof value === 'string' ? { length: value.length } : Array.isArray(value) ? { count: value.length } : {}),
  sha256: digest(value),
};
const safePath = parts => parts.map(part => typeof part === 'number' ? `[${part}]` : /^[a-zA-Z_$][a-zA-Z0-9_$-]{0,64}$/.test(part) ? `.${part}` : '[field]').join('').replace(/^\./, '');
function safeValue(value, parts) {
  const key = parts[parts.length - 1], joined = parts.join('.');
  if (value === undefined || value === null) return value === undefined ? { present: false } : null;
  if (/^(?:type|typeVersion|disabled|retryOnFail|maxTries|waitBetweenTries|alwaysOutputData|onError|operation|resource)$/.test(key)
      && ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (parts[0] === 'position' && typeof value === 'number') return value;
  if (parts[0] === 'credentials' && /^(id|name)$/.test(key) && typeof value === 'string' && value.length < 150) return value;
  if ((/columns\.schema\.\d+\.(id|displayName)$/.test(joined) || /columns\.matchingColumns\.\d+$/.test(joined)
      || /filtersUI\.values\.\d+\.lookupColumn$/.test(joined))
      && typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_ .-]{0,100}$/.test(value)) return value;
  if (/parameters\.(?:documentId|sheetName)\.(?:value|mode|cachedResultName)$/.test(joined)
      && typeof value === 'string' && /^[A-Za-z0-9_ .-]{1,120}$/.test(value)) return value;
  if (parts[0] === 'connections' && /^(node|type|index)$/.test(key)
      && ['string', 'number'].includes(typeof value)) return value;
  return describe(value);
}
function category(parts) {
  if (['position', 'notes', 'notesInFlow', 'color', 'nodeOrder'].includes(parts[0])) return 'cosmetic';
  if (parts[0] === 'credentials') return 'credential-reference';
  if (parts[0] === 'connections') return 'routing';
  if (parts.includes('jsCode')) return 'code';
  return 'configuration';
}

export function compareWorkflowGraphs(selected, live, limit = 600) {
  const changes = [], changedNodes = new Set();
  let changeCount = 0;
  const add = (node, parts, before, after, kind = 'changed') => {
    changeCount++;
    if (node) changedNodes.add(node);
    if (changes.length < limit) changes.push({ node, path: safePath(parts), kind, category: category(parts), selected: safeValue(before, parts), live: safeValue(after, parts) });
  };
  const walk = (node, parts, before, after) => {
    if (isDeepStrictEqual(before, after)) return;
    if (Array.isArray(before) && Array.isArray(after)) {
      for (let i = 0; i < Math.max(before.length, after.length); i++) walk(node, [...parts, i], before[i], after[i]);
    } else if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) walk(node, [...parts, key], before[key], after[key]);
    } else add(node, parts, before, after);
  };
  const beforeById = new Map((selected.nodes || []).map(node => [node.id, node]));
  const afterById = new Map((live.nodes || []).map(node => [node.id, node]));
  for (const id of new Set([...beforeById.keys(), ...afterById.keys()])) {
    const before = beforeById.get(id), after = afterById.get(id);
    const name = after?.name || before?.name || '(unnamed node)';
    if (!before || !after) add(name, ['node'], before ? { id: before.id, name: before.name, type: before.type } : undefined, after ? { id: after.id, name: after.name, type: after.type } : undefined, before ? 'removed-live-node' : 'added-live-node');
    else walk(name, [], before, after);
  }
  const selectedOrder = (selected.nodes || []).map(node => node.id), liveOrder = (live.nodes || []).map(node => node.id);
  if (!isDeepStrictEqual(selectedOrder, liveOrder)) add(null, ['nodeOrder'], selectedOrder, liveOrder);
  for (const name of new Set([...Object.keys(selected.connections || {}), ...Object.keys(live.connections || {})]))
    walk(name, ['connections'], selected.connections?.[name], live.connections?.[name]);
  return { match: changeCount === 0, changeCount, truncated: changeCount > changes.length, changedNodes: [...changedNodes], changes };
}

function review() {
  let db;
  try {
    const stage = path.dirname(fileURLToPath(import.meta.url));
    if (!/^\/tmp\/customerlead-unified-[0-9a-f]{32}$/.test(stage) || process.argv.length !== 2)
      throw new Error('Unexpected read-only review staging directory or argument.');
    const manifest = JSON.parse(fs.readFileSync(path.join(stage, 'unified-sources.json'), 'utf8').replace(/^\uFEFF/, ''));
    db = new DatabaseSync('/home/node/.n8n/database.sqlite', { readOnly: true });
    const results = [];
    for (const [role, id] of Object.entries(expected)) {
      const raw = fs.readFileSync(path.join(stage, role + '.json'), 'utf8');
      const source = oneWorkflow(JSON.parse(raw.replace(/^\uFEFF/, '')));
      const reference = manifest.sources?.find(item => item.role === role);
      if (source.id !== id || !reference || digest(raw) !== reference.sha256)
        throw new Error('A staged source identity or reviewed fingerprint did not verify.');
      const row = db.prepare('SELECT id,name,active,versionId,activeVersionId,nodes,connections FROM workflow_entity WHERE id=? AND isArchived=0').get(id);
      if (!row) { results.push({ role, id, found: false }); continue; }
      const live = { nodes: JSON.parse(row.nodes), connections: JSON.parse(row.connections) };
      const result = {
        role, id, found: true, active: !!row.active, selectedNodeCount: source.nodes.length, liveNodeCount: live.nodes.length,
        savedGraphSha256: digest(JSON.stringify(live)),
        savedGraph: compareWorkflowGraphs(source, live),
      };
      if (row.activeVersionId) {
        const published = db.prepare('SELECT nodes,connections FROM workflow_history WHERE workflowId=? AND versionId=?').get(id, row.activeVersionId);
        result.publishedGraph = published ? compareWorkflowGraphs(source, { nodes: JSON.parse(published.nodes), connections: JSON.parse(published.connections) }) : { found: false };
      }
      results.push(result);
    }
    console.log(JSON.stringify({ mode: 'read-only-review', ready: true, recordsChanged: false, workflows: results }));
  } catch {
    // Exception messages and stacks can reveal private workflow literals.
    console.log(JSON.stringify({ mode: 'read-only-review', ready: false, error: 'The private read-only comparison could not complete. No workflow parameters or exception details were logged.' }));
    process.exitCode = 1;
  } finally { db?.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) review();
