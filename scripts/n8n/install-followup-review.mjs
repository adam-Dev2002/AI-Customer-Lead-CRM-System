// Runs privately inside n8n. No exports or credential values reach stdout.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { installFollowUpReview, approvedFollowUpClaim, approvedFollowUpFields } from "./followup-review.mjs";

process.umask(0o077);
const stage = path.dirname(fileURLToPath(import.meta.url));
const id = "63a8178b-64a0-4360-8ff3-d150fe201cf9";
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
if (process.argv.includes("--cleanup")) {
  assert(/^\/tmp\/customerlead-followup-[a-f0-9]{32}$/.test(stage));
  fs.rmSync(stage, { recursive: true, force: true }); process.exit(0);
}
const db = new DatabaseSync("/home/node/.n8n/database.sqlite", { readOnly: true });
try {
  const row = db.prepare("SELECT * FROM workflow_entity WHERE id=? AND isArchived=0").get(id);
  assert(row?.active, "The consolidated workflow must be active.");
  const nodes = JSON.parse(row.nodes), connections = JSON.parse(row.connections);
  const proposed = installFollowUpReview({ nodes: structuredClone(nodes), connections });
  const changed = nodes.filter((node, index) => digest(node) !== digest(proposed.nodes[index]));
  assert(changed.length <= 2 && changed.every(node => ["Claim consented follow-up", "GMAIL — Send Consented Follow-Up"].includes(node.name)));
  for (let index = 0; index < nodes.length; index++) assert.deepEqual(proposed.nodes[index].credentials, nodes[index].credentials);
  const claim = nodes.find(node => node.name === "Claim consented follow-up");
  assert([approvedFollowUpClaim, "={{ {action:'claim',leadId:$json.Lead_ID,email:$json.Email,followUpDue:$json.Follow_Up_Due_UTC,executionId:$execution.id} }}"].includes(claim.parameters.jsonBody), "Review the changed claim before installing.");
  const published = db.prepare("SELECT nodes,connections FROM workflow_history WHERE versionId=? AND workflowId=?").get(row.activeVersionId, id);
  assert(published && digest({ nodes: JSON.parse(published.nodes), connections: JSON.parse(published.connections) }) === digest({ nodes, connections }), "Saved and published graphs differ.");
  const running = db.prepare("SELECT count(*) n FROM execution_entity WHERE status='running'").get().n;
  const before = digest({ nodes, connections, versionId: row.versionId, updatedAt: row.updatedAt, activeVersionId: row.activeVersionId });
  if (!process.argv.includes("--apply")) {
    fs.writeFileSync(path.join(stage, "plan.json"), JSON.stringify({ before }), { mode: 0o600 });
    console.log(JSON.stringify({ installed: !changed.length, nodes: nodes.length, active: true, running, changes: changed.map(node => node.name), sendsRequested: 0 }));
  } else if (!changed.length) console.log(JSON.stringify({ installed: true, changed: false, restartRequired: false }));
  else {
    assert.equal(JSON.parse(fs.readFileSync(path.join(stage, "plan.json"), "utf8")).before, before, "Workflow changed after review.");
    assert.equal(running, 0, "Wait for running executions.");
    const others = () => db.prepare("SELECT id,nodes,connections,active,activeVersionId FROM workflow_entity WHERE id<>? ORDER BY id").all(id);
    const credentials = () => db.prepare("SELECT id,type,data FROM credentials_entity ORDER BY id").all();
    const otherBefore = digest(others()), credentialBefore = digest(credentials());
    const backup = "/home/node/.n8n/customerlead-backups/followup-review-" + new Date().toISOString().replace(/[:.]/g, "-");
    fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
    const cli = args => {
      const result = spawnSync("n8n", args, { encoding: "utf8", maxBuffer: 8e6, env: { ...process.env, N8N_LOG_LEVEL: "info", N8N_DIAGNOSTICS_ENABLED: "false", N8N_RUNNERS_ENABLED: "false" } });
      assert.equal(result.status, 0, "Private n8n CLI operation failed.");
    };
    const original = path.join(backup, "before.json");
    cli(["export:workflow", `--id=${id}`, `--output=${original}`]); fs.chmodSync(original, 0o600);
    const workflow = JSON.parse(fs.readFileSync(original, "utf8"))[0];
    assert.equal(digest(workflow.nodes), digest(nodes));
    const project = db.prepare("SELECT projectId FROM shared_workflow WHERE workflowId=? AND role='workflow:owner'").get(id)?.projectId; assert(project);
    installFollowUpReview(workflow);
    workflow.versionId = randomUUID(); delete workflow.activeVersionId; delete workflow.activeVersion;
    const file = path.join(backup, "after.json"); fs.writeFileSync(file, JSON.stringify([workflow]), { mode: 0o600 });
    try {
      cli(["import:workflow", `--input=${file}`, `--projectId=${project}`]); cli(["publish:workflow", `--id=${id}`]);
      const saved = db.prepare("SELECT nodes,connections,active FROM workflow_entity WHERE id=?").get(id);
      assert(saved.active); assert.equal(digest(JSON.parse(saved.nodes)), digest(workflow.nodes));
      assert.equal(digest(JSON.parse(saved.connections)), digest(connections));
      assert.equal(digest(others()), otherBefore); assert.equal(digest(credentials()), credentialBefore);
      console.log(JSON.stringify({ installed: true, changed: true, restartRequired: true, backup, nodes: nodes.length, credentialsPreserved: true, otherWorkflowsPreserved: true, sendsRequested: 0 }));
    } catch {
      cli(["import:workflow", `--input=${original}`, `--projectId=${project}`]); cli(["publish:workflow", `--id=${id}`]);
      throw Error("Update failed; original workflow restored. Reload the engine.");
    }
  }
} catch (error) {
  console.log(JSON.stringify({ error: /Wait for/.test(error.message) ? "Wait for running executions." : "Follow-up review update did not finish. Private exports and CLI output withheld." }));
  process.exitCode = 1;
} finally { db.close(); }
