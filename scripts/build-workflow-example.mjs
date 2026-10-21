// Produce a public, unconfigured example from the specifically reviewed private export.
// Usage: node scripts/build-workflow-example.mjs "C:/private/workflow.json"
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const reviewedHash = "13c6167752c025c00971a1c34c24976ddebd2ece0baede8a153bb5c1de2d2773";
const input = process.argv[2];
if (!input) throw new Error("Supply the private, reviewed workflow file path. It will not be copied into Git.");
const bytes = fs.readFileSync(input);
assert.equal(createHash("sha256").update(bytes).digest("hex"), reviewedHash,
  "This is a different export. Review it before changing this guard.");
const parsed = JSON.parse(bytes.toString("utf8"));
const source = Array.isArray(parsed) ? parsed[0] : parsed;
assert.equal(source.nodes.length, 128);
const assignments = source.nodes.find(node => node.name === "Bridge settings").parameters.assignments.assignments;
const sheetId = assignments.find(item => item.name === "spreadsheetId").value;
const crmOrigin = assignments.find(item => item.name === "crmBaseUrl").value;
assert(sheetId && crmOrigin);
const exampleUuid = label => {
  const hex = createHash("sha256").update("customerlead-public-example:" + label).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
function clean(value) {
  if (typeof value === "string") return value
    .replaceAll(sheetId, "REPLACE_WITH_SPREADSHEET_ID")
    .replaceAll(crmOrigin, "https://crm.example.invalid")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "owner@example.com");
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !["credentials", "cachedResultName", "cachedResultUrl"].includes(key))
    .map(([key, child]) => [key, clean(child)]));
  return value;
}
const nodes = source.nodes.map(original => {
  const node = clean(original);
  node.id = exampleUuid(node.name);
  if (node.webhookId) node.webhookId = exampleUuid("form-webhook");
  if (node.type === "n8n-nodes-base.googleSheets") {
    if (node.parameters.documentId?.value === "REPLACE_WITH_SPREADSHEET_ID") node.parameters.documentId.mode = "id";
    if (node.parameters.sheetName?.mode === "list") node.parameters.sheetName = { __rl: true, mode: "name", value: "Leads" };
  }
  if (node.type === "n8n-nodes-base.scheduleTrigger") {
    for (const interval of node.parameters.rule.interval) {
      if (interval.field === "minutes") interval.minutesInterval ??= 5;
      if (interval.field === "hours") interval.hoursInterval ??= 1;
    }
  }
  return node;
});
const workflow = {
  name: "DEMO - CustomerLead combined (connect your own accounts)",
  nodes, pinData: {}, connections: clean(source.connections), active: false,
  settings: clean(source.settings), tags: [],
};
const names = new Set(nodes.map(node => node.name));
assert.equal(names.size, 128);
assert.equal(nodes.filter(node => node.type === "n8n-nodes-base.scheduleTrigger").length, 4);
for (const [from, groups] of Object.entries(workflow.connections)) {
  assert(names.has(from));
  for (const outputs of Object.values(groups)) for (const output of outputs) for (const edge of output) assert(names.has(edge.node));
}
const encoded = JSON.stringify(workflow, null, 2) + "\n";
assert(!encoded.includes(sheetId) && !encoded.includes(crmOrigin));
assert(!encoded.includes('"credentials"') && !encoded.includes('"instanceId"'));
const directory = path.join(root, "docs/workflows");
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(directory, "customerlead-combined.example.json"), encoded);
fs.writeFileSync(path.join(directory, "source-review.json"), JSON.stringify({
  reviewedOn: "2026-10-21",
  sourceFile: "ClearFlow \u2014 Customer support, leads & dashboard (Gemini only).json",
  sourceSha256: reviewedHash,
  sourceNodes: 128,
  exampleSha256: createHash("sha256").update(encoded).digest("hex"),
  exampleNodes: nodes.length,
  changes: ["Inactive; no pinned execution data", "Removed account/credential bindings and instance metadata",
    "Replaced spreadsheet IDs, cached tab references, CRM origin and literal email addresses",
    "New demo node/form IDs; original connection graph retained", "Made existing 5-minute/hourly schedule defaults explicit"],
}, null, 2) + "\n");
console.log("Wrote inactive 128-node example and review manifest. The private source was not modified.");
