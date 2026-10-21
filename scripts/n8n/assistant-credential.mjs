// Executes inside n8n. Exports are captured in memory; output contains only an encrypted envelope.
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { createCipheriv, createHash, publicEncrypt, randomBytes } from "node:crypto";
function exportedArray(raw, expectedId) {
  for (let start = raw.indexOf("["); start >= 0; start = raw.indexOf("[", start + 1)) {
    let depth = 0, quoted = false, escaped = false;
    for (let end = start; end < raw.length; end++) {
      const c = raw[end];
      if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; }
      else if (c === '"') quoted = true;
      else if (c === "[") depth++;
      else if (c === "]" && !--depth) {
        try { const value = JSON.parse(raw.slice(start, end + 1)); if (Array.isArray(value) && value[0]?.id === expectedId) return value; } catch {}
        break;
      }
    }
  }
  throw new Error();
}
try {
  const db = new DatabaseSync("/home/node/.n8n/database.sqlite", { readOnly: true });
  const rows = () => db.prepare("SELECT id,nodes,connections,active,activeVersionId FROM workflow_entity ORDER BY id").all();
  const before = JSON.stringify(rows());
  const workflow = rows().find(row => row.id === "63a8178b-64a0-4360-8ff3-d150fe201cf9");
  const node = JSON.parse(workflow.nodes).find(node => /Gemini Primary/.test(node.name));
  const credentialId = node?.credentials?.httpHeaderAuth?.id;
  const model = String(node?.parameters?.url || "").match(/models\/([a-z0-9.-]+):generateContent/)?.[1];
  if (!credentialId || !model) throw new Error();
  const beforeCredential = db.prepare("SELECT data FROM credentials_entity WHERE id=?").get(credentialId)?.data;
  const result = spawnSync("n8n", ["export:credentials", `--id=${credentialId}`, "--decrypted"], { encoding: "utf8", maxBuffer: 4e6, env: { ...process.env, N8N_LOG_LEVEL: "info", N8N_DIAGNOSTICS_ENABLED: "false", N8N_RUNNERS_ENABLED: "false" } });
  if (result.status !== 0) throw new Error();
  const data = exportedArray(result.stdout, credentialId)[0].data;
  if (String(data.name).toLowerCase() !== "x-goog-api-key" || typeof data.value !== "string" || !data.value.trim()) throw new Error();
  const apiKey = data.value.trim();
  const probe = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model, { headers: { "x-goog-api-key": apiKey }, signal: AbortSignal.timeout(15000) });
  if (!probe.ok) throw new Error();
  const metadata = await probe.json();
  if (!metadata.supportedGenerationMethods?.includes("generateContent")) throw new Error();
  const publicKey = fs.readFileSync(0, "utf8"), key = randomBytes(32), iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const config = JSON.stringify({ version: 1, apiKey, model, credentialId, installedAt: new Date().toISOString() });
  const encrypted = Buffer.concat([cipher.update(config, "utf8"), cipher.final()]);
  if (JSON.stringify(rows()) !== before || db.prepare("SELECT data FROM credentials_entity WHERE id=?").get(credentialId)?.data !== beforeCredential) throw new Error();
  db.close();
  console.log(JSON.stringify({ model, credentialId, verified: true, workflowUnchanged: true, keyFingerprint: createHash("sha256").update(apiKey).digest("hex").slice(0, 12), envelope: { key: publicEncrypt(publicKey, key).toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: encrypted.toString("base64") } }));
} catch { console.log(JSON.stringify({ error: "Gemini credential could not be verified. Private credential output withheld." })); process.exitCode = 1; }
