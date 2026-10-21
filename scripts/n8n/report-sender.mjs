// Inside n8n: private exports and CLI output stay on disk/in captured memory.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { prepareMailDraft } from "./mail-code.mjs";
const stage = path.dirname(fileURLToPath(import.meta.url)), id = "63a8178b-64a0-4360-8ff3-d150fe201cf9";
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const body = "={{ {action:'claim',executionId:$execution.id,senderEmail:$json.emailAddress,capabilities:['lead-reports-v1']} }}";
process.umask(0o077);
if (process.argv.includes("--cleanup")) { assert(/^\/tmp\/customerlead-report-[a-f0-9]{32}$/.test(stage)); fs.rmSync(stage, { recursive: true, force: true }); process.exit(0); }
const db = new DatabaseSync("/home/node/.n8n/database.sqlite", { readOnly: true });
try {
  const row = db.prepare("SELECT * FROM workflow_entity WHERE id=? AND isArchived=0").get(id); assert(row?.active, "The existing consolidated workflow must be active.");
  const nodes = JSON.parse(row.nodes), connections = JSON.parse(row.connections);
  const build = nodes.find(node => node.name === "Build confirmed Gmail draft"), claim = nodes.find(node => node.name === "Claim approved reply");
  assert(build && claim && /\/api\/n8n\/mail$/.test(claim.parameters.url), "The confirmed sender path was not found.");
  const reportStart = prepareMailDraft.indexOf("if (job.kind === 'lead-report') {");
  const reportEnd = prepareMailDraft.indexOf("\nlet headers", reportStart);
  const legacyCode = prepareMailDraft.slice(0, reportStart) + prepareMailDraft.slice(reportEnd + 1);
  assert([legacyCode, prepareMailDraft].includes(build.parameters.jsCode), "The sender has unreviewed custom code.");
  assert(["={{ {action:'claim',executionId:$execution.id,senderEmail:$json.emailAddress} }}", body].includes(claim.parameters.jsonBody), "The sender claim has unreviewed parameters.");
  const published = db.prepare("SELECT nodes,connections FROM workflow_history WHERE versionId=? AND workflowId=?").get(row.activeVersionId, id);
  assert(published && digest({ nodes: JSON.parse(published.nodes), connections: JSON.parse(published.connections) }) === digest({ nodes, connections }), "Saved and published graphs differ. Review before changing them.");
  const activeExecutions = db.prepare("SELECT id FROM execution_entity WHERE status='running'").all().length;
  const installed = build.parameters.jsCode === prepareMailDraft && claim.parameters.jsonBody === body;
  const before = digest({ nodes, connections, versionId: row.versionId, updatedAt: row.updatedAt, activeVersionId: row.activeVersionId });
  const plan = { id, graph: before };
  if (!process.argv.includes("--apply")) {
    fs.writeFileSync(path.join(stage, "plan.json"), JSON.stringify(plan), { mode: 0o600 });
    console.log(JSON.stringify({ installed, active: true, activeExecutions, nodes: nodes.length, plannedNodes: [build.name, claim.name], changes: installed ? 0 : 2 }));
  } else if (installed) console.log(JSON.stringify({ installed: true, changed: false, restartRequired: false }));
  else {
    assert.equal(JSON.parse(fs.readFileSync(path.join(stage, "plan.json"), "utf8")).graph, before, "Workflow changed since its review.");
    assert.equal(activeExecutions, 0, "Wait for running executions before applying.");
    const other = () => db.prepare("SELECT id,nodes,connections,active,activeVersionId FROM workflow_entity WHERE id<>? ORDER BY id").all(id);
    const credentials = () => db.prepare("SELECT id,type,data FROM credentials_entity ORDER BY id").all();
    const otherBefore = digest(other()), credentialBefore = digest(credentials());
    const backup = "/home/node/.n8n/customerlead-backups/report-sender-" + new Date().toISOString().replace(/[:.]/g, "-"); fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
    const cli = args => { const result = spawnSync("n8n", args, { encoding: "utf8", maxBuffer: 8e6, env: { ...process.env, N8N_LOG_LEVEL: "info", N8N_DIAGNOSTICS_ENABLED: "false", N8N_RUNNERS_ENABLED: "false" } }); assert.equal(result.status, 0, "The private n8n CLI operation failed."); };
    const originalFile = path.join(backup, "before.json"); cli(["export:workflow", `--id=${id}`, `--output=${originalFile}`]); fs.chmodSync(originalFile, 0o600);
    const workflow = JSON.parse(fs.readFileSync(originalFile, "utf8"))[0]; assert.equal(digest(workflow.nodes), digest(nodes));
    const project = db.prepare("SELECT projectId FROM shared_workflow WHERE workflowId=? AND role='workflow:owner'").get(id)?.projectId; assert(project);
    workflow.nodes.find(node => node.id === build.id).parameters.jsCode = prepareMailDraft;
    workflow.nodes.find(node => node.id === claim.id).parameters.jsonBody = body;
    workflow.versionId = randomUUID(); delete workflow.activeVersionId; delete workflow.activeVersion;
    for (const node of workflow.nodes) if (node.type === "n8n-nodes-base.code") new Function(node.parameters.jsCode);
    for (const original of nodes) { const after = workflow.nodes.find(node => node.id === original.id); assert(after); assert.deepEqual(after.credentials, original.credentials); if (![build.id, claim.id].includes(original.id)) assert.deepEqual(after, original); }
    const file = path.join(backup, "after.json"); fs.writeFileSync(file, JSON.stringify([workflow]), { mode: 0o600 });
    try {
      cli(["import:workflow", `--input=${file}`, `--projectId=${project}`]); cli(["publish:workflow", `--id=${id}`]);
      const saved = db.prepare("SELECT nodes,connections,active FROM workflow_entity WHERE id=?").get(id); assert(saved.active); assert.equal(digest(JSON.parse(saved.nodes)), digest(workflow.nodes)); assert.equal(digest(JSON.parse(saved.connections)), digest(connections));
      assert.equal(digest(other()), otherBefore); assert.equal(digest(credentials()), credentialBefore);
      console.log(JSON.stringify({ installed: true, changed: true, restartRequired: true, backup, nodes: nodes.length, credentialsPreserved: true, otherWorkflowsPreserved: true, liveEmailsRequested: 0 }));
    } catch { cli(["import:workflow", `--input=${originalFile}`, `--projectId=${project}`]); cli(["publish:workflow", `--id=${id}`]); throw Error("Update did not finish; original workflow restored. Engine reload required."); }
  }
} catch (error) { console.log(JSON.stringify({ error: error.message?.includes("Wait for") ? "Wait for running executions before applying." : "Report sender update could not finish. Private exports/CLI output withheld.", retryWhenIdle: /running executions/.test(error.message || "") })); process.exitCode = 1; }
finally { db.close(); }
