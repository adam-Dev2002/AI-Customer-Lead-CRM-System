// Private container helper. Never log workflow parameters or CLI output.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

process.umask(0o077);
const stage = path.dirname(fileURLToPath(import.meta.url));
const expected = {
  main: '8yrYwA0BHLqkdaNU',
  sync: 'MLz8oxiFRaHlEUWi',
  sender: 'xVUk4j8UMpJL2npU',
};
class SafeError extends Error {}
const ensure = (condition, message) => { if (!condition) throw new SafeError(message); };
const readJSON = filename => JSON.parse(fs.readFileSync(path.join(stage, filename), 'utf8').replace(/^\uFEFF/, ''));
const oneWorkflow = value => Array.isArray(value) && value.length === 1 ? value[0] : value;
const digest = raw => createHash('sha256').update(raw).digest('hex');
const graphMatches = (row, workflow) =>
  isDeepStrictEqual(JSON.parse(row.nodes), workflow.nodes) &&
  isDeepStrictEqual(JSON.parse(row.connections), workflow.connections);
const orderOnlyDifference = (row, workflow) => {
  const existingNodes = JSON.parse(row.nodes);
  const byId = new Map(existingNodes.map(node => [node.id, node]));
  const desiredIds = new Set(workflow.nodes.map(node => node.id));
  return byId.size === existingNodes.length && desiredIds.size === workflow.nodes.length &&
    existingNodes.length === workflow.nodes.length &&
    workflow.nodes.every(node => typeof node.id === 'string' && isDeepStrictEqual(node, byId.get(node.id))) &&
    isDeepStrictEqual(JSON.parse(row.connections), workflow.connections);
};
const references = nodes => nodes.flatMap(node => Object.entries(node.credentials || {}).map(([type, credential]) => ({ type, id: credential.id })));
const snapshot = row => Object.fromEntries(
  ['id', 'name', 'active', 'versionId', 'activeVersionId', 'updatedAt', 'nodes', 'connections'].map(key => [key, row[key] ?? null]),
);
const cli = args => {
  // Exports and CLI failures can contain secrets. Keep stdout/stderr in memory.
  const result = spawnSync('n8n', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  ensure(result.status === 0 && !result.error, 'The supported n8n CLI operation failed: ' + args[0] + '. Private command output was withheld.');
};
let db;
try {
  ensure(/^\/tmp\/customerlead-unified-[0-9a-f]{32}$/.test(stage), 'Unexpected private staging directory.');
  if (process.argv.includes('--cleanup')) {
    fs.rmSync(stage, { recursive: true, force: true });
    process.exit(0);
  }
  const importing = process.argv.includes('--import-draft');
  const refreshing = process.argv.includes('--refresh-draft');
  ensure(!(importing && refreshing) && process.argv.slice(2).every(arg => ['--import-draft', '--refresh-draft'].includes(arg)), 'Unsupported or conflicting helper arguments.');
  const mutating = importing || refreshing;
  const manifest = readJSON('unified-sources.json');
  ensure(Array.isArray(manifest.sources) && manifest.sources.length === 3, 'Expected the three reviewed workflow sources.');
  const sources = {};
  for (const role of Object.keys(expected)) {
    const selected = manifest.sources.filter(source => source.role === role);
    ensure(selected.length === 1, 'Missing or duplicate reviewed source role: ' + role + '.');
    const raw = fs.readFileSync(path.join(stage, role + '.json'));
    ensure(digest(raw) === selected[0].sha256, 'The selected source hash changed: ' + role + '. Review and rebuild before importing.');
    const source = oneWorkflow(JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, '')));
    ensure(source.id === expected[role], 'The selected source ID does not match the existing ' + role + ' workflow.');
    ensure(source.nodes?.length === selected[0].nodeCount, 'The selected source node count changed: ' + role + '.');
    ensure(source.connections && typeof source.connections === 'object', 'Missing source connections: ' + role + '.');
    sources[role] = source;
  }
  const draftRaw = fs.readFileSync(path.join(stage, 'customerlead-unified-gemini.json'));
  const draft = oneWorkflow(JSON.parse(draftRaw.toString('utf8').replace(/^\uFEFF/, '')));
  ensure(draft && !draft.id && draft.active === false, 'The prepared workflow must be a new inactive draft without a root ID.');
  ensure(typeof draft.name === 'string' && draft.name.trim() && draft.nodes?.length === 123, 'Unexpected prepared workflow name or node count.');
  ensure(draft.connections && typeof draft.connections === 'object', 'The prepared workflow has no connections.');

  db = new DatabaseSync('/home/node/.n8n/database.sqlite', { readOnly: true });
  const find = id => db.prepare('SELECT * FROM workflow_entity WHERE id=? AND isArchived=0').get(id);
  const owner = id => db.prepare("SELECT projectId FROM shared_workflow WHERE workflowId=? AND role='workflow:owner'").all(id);
  const originals = Object.entries(expected).map(([role, id]) => {
    const row = find(id);
    ensure(row, 'The existing ' + role + ' workflow was not found.');
    const reviewed=manifest.sources.find(source=>source.role===role);
    const graphSha256=digest(JSON.stringify({nodes:JSON.parse(row.nodes),connections:JSON.parse(row.connections)}));
    ensure(graphMatches(row, sources[role]) || (manifest.liveReviewedOn && reviewed.liveSavedGraphSha256===graphSha256), 'The live ' + role + ' workflow differs from the selected export and reviewed live graph. No import was made; review its current nodes and connections first.');
    const projects = owner(id);
    ensure(projects.length === 1, 'The existing ' + role + ' workflow must have exactly one owner project.');
    return { role, row, before: snapshot(row), projectId: projects[0].projectId };
  });
  const projectId = originals[0].projectId;
  ensure(originals.every(item => item.projectId === projectId), 'The three existing workflows do not share one owner project.');

  const credentialReferences = references(draft.nodes);
  const uniqueCredentials = [...new Map(credentialReferences.map(ref => [ref.type + ':' + ref.id, ref])).values()];
  for (const ref of uniqueCredentials) {
    ensure(typeof ref.id === 'string' && ref.id, 'A prepared node has an incomplete credential reference.');
    const credential = db.prepare('SELECT id,type FROM credentials_entity WHERE id=?').get(ref.id);
    ensure(credential && credential.type === ref.type, 'A referenced credential is missing or has a different type. No credential was changed.');
    const access = db.prepare('SELECT 1 AS accessible FROM shared_credentials WHERE credentialsId=? AND projectId=? LIMIT 1').get(ref.id, projectId);
    ensure(access, 'A referenced credential is not shared with the workflow owner project.');
  }
  const verifyOriginals = () => {
    for (const original of originals) {
      const current = find(original.row.id);
      ensure(current && isDeepStrictEqual(snapshot(current), original.before), 'An existing workflow changed during the operation. No existing workflow was intentionally edited; review before proceeding.');
      ensure(owner(current.id).length === 1 && owner(current.id)[0].projectId === projectId, 'An existing workflow owner changed during the operation.');
    }
  };
  const existing = db.prepare('SELECT * FROM workflow_entity WHERE name=? AND isArchived=0').all(draft.name);
  ensure(existing.length <= 1, 'More than one workflow already uses the prepared name. Review the drafts before importing.');
  ensure(!refreshing || existing.length === 1, 'Refresh requires the existing matching inactive draft; it cannot create a workflow.');
  if (existing.length) {
    ensure(!existing[0].active && !existing[0].activeVersionId, 'A workflow with the prepared name is already published. No import or status change was made.');
    ensure(graphMatches(existing[0], draft) || (refreshing && orderOnlyDifference(existing[0], draft)), 'The existing draft differs by more than node order, or explicit refresh was not selected. It was not overwritten.');
    ensure(owner(existing[0].id).length === 1 && owner(existing[0].id)[0].projectId === projectId, 'The existing draft belongs to a different owner project.');
  }
  const summary = {
    mode: refreshing ? 'refreshed-draft' : importing ? (existing.length ? 'existing-draft' : 'imported') : 'plan',
    ready: true,
    name: draft.name,
    nodeCount: draft.nodes.length,
    uniqueCredentialCount: uniqueCredentials.length,
    credentialReferenceCount: credentialReferences.length,
    sourceFilesVerified: true,
    liveGraphsReviewed: true,
    preparedSha256: digest(draftRaw),
    existingWorkflows: originals.map(({ role, row }) => ({ role, id: row.id, active: !!row.active, nodeCount: JSON.parse(row.nodes).length })),
    oldWorkflowsUnchanged: true,
    restartRequired: false,
    cutoverPerformed: false,
    liveMailSent: false,
  };
  if (!mutating) {
    console.log(JSON.stringify({ ...summary, action: existing.length ? 'Reuse the matching inactive draft.' : 'Import a new inactive workflow; leave all existing workflows unchanged.', workflowId: existing[0]?.id || null }));
  } else if (existing.length && !refreshing) {
    verifyOriginals();
    console.log(JSON.stringify({ ...summary, workflowId: existing[0].id, active: false, importedAt: new Date().toISOString(), backupDirectory: null }));
  } else {
    const backupDirectory = '/home/node/.n8n/customerlead-backups/unified-draft-' + new Date().toISOString().replace(/[:.]/g, '-');
    fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
    const refreshBefore = refreshing ? snapshot(existing[0]) : null;
    const backups = refreshing ? [{ row: existing[0] }] : originals;
    let refreshBackup;
    for (const original of backups) {
      const output = path.join(backupDirectory, original.row.id + '.json');
      cli(['export:workflow', '--id=' + original.row.id, '--output=' + output]);
      fs.chmodSync(output, 0o600);
      const backup = oneWorkflow(JSON.parse(fs.readFileSync(output, 'utf8')));
      ensure(backup.id === original.row.id && graphMatches(original.row, backup), 'An existing workflow changed while creating its backup. Import stopped.');
      if (refreshing) refreshBackup = backup;
    }
    verifyOriginals();
    const workflowId = refreshing ? existing[0].id : randomUUID();
    if (refreshing) {
      ensure(isDeepStrictEqual(snapshot(find(workflowId)), refreshBefore), 'The inactive draft changed during backup. Refresh stopped.');
      ensure(orderOnlyDifference(find(workflowId), draft), 'The inactive draft no longer differs only by node order.');
    } else ensure(!db.prepare('SELECT id FROM workflow_entity WHERE id=?').get(workflowId), 'The new workflow ID is already in use.');
    // Refresh preserves every exported workflow field except node ordering and
    // the expected new inactive version. It never imports general graph edits.
    const prepared = refreshing
      ? { ...refreshBackup, nodes: draft.nodes, id: workflowId, active: false, versionId: randomUUID() }
      : { ...draft, id: workflowId, active: false, versionId: randomUUID() };
    delete prepared.activeVersionId;
    delete prepared.activeVersion;
    const input = path.join(stage, 'inactive-import.json');
    fs.writeFileSync(input, JSON.stringify([prepared]), { mode: 0o600 });
    cli(['import:workflow', '--input=' + input, '--projectId=' + projectId]);
    const saved = find(workflowId);
    ensure(saved && !saved.active && !saved.activeVersionId, 'The imported workflow did not verify as inactive. Do not publish it.');
    ensure(saved.name === draft.name && graphMatches(saved, draft), 'The imported workflow graph did not verify. Do not publish it.');
    ensure(isDeepStrictEqual(references(JSON.parse(saved.nodes)), credentialReferences), 'The imported credential references did not verify. Do not publish it.');
    ensure(owner(workflowId).length === 1 && owner(workflowId)[0].projectId === projectId, 'The imported draft owner project did not verify.');
    verifyOriginals();
    console.log(JSON.stringify({ ...summary, workflowId, active: false, importedAt: new Date().toISOString(), backupDirectory }));
  }
} catch (error) {
  console.log(JSON.stringify({ mode: 'blocked', ready: false, error: error instanceof SafeError ? error.message : 'The private import check failed. No private workflow parameters or CLI output were logged.' }));
  process.exitCode = 1;
} finally {
  db?.close();
}
