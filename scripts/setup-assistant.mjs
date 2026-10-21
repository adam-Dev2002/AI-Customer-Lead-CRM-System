import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createDecipheriv, generateKeyPairSync, privateDecrypt, randomUUID } from "node:crypto";
const root = fileURLToPath(new URL("../", import.meta.url));
const container = process.env.CUSTOMERLEAD_N8N_CONTAINER || "n8n";
const stage = `/tmp/customerlead-assistant-${randomUUID()}.mjs`;
let staged = false;
try {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  execFileSync("docker", ["cp", path.join(root, "scripts/n8n/assistant-credential.mjs"), `${container}:${stage}`], { stdio: "pipe", windowsHide: true }); staged = true;
  const raw = execFileSync("docker", ["exec", "-i", container, "node", "--no-warnings", stage], { input: publicKey.export({ type: "spki", format: "pem" }), encoding: "utf8", maxBuffer: 4e6, windowsHide: true });
  const result = JSON.parse(raw);
  if (!result.envelope || result.error) throw new Error();
  const envelope = result.envelope;
  const key = privateDecrypt(privateKey, Buffer.from(envelope.key, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64")); decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const config = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]);
  const parsed = JSON.parse(config.toString("utf8"));
  if (!parsed.apiKey || parsed.model !== result.model) throw new Error();
  const filename = path.join(root, "templates/leads/.data/assistant-gemini.json");
  if (fs.existsSync(filename)) {
    const backups = path.join(root, "private-integrations/assistant-backups"); fs.mkdirSync(backups, { recursive: true, mode: 0o700 }); fs.copyFileSync(filename, path.join(backups, `before-${Date.now()}.json`));
  }
  const temporary = filename + `.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, config, { mode: 0o600 }); fs.renameSync(temporary, filename); } finally { fs.rmSync(temporary, { force: true }); }
  delete result.envelope;
  console.log(JSON.stringify({ ...result, installed: true, restartRequired: false, note: "Server-only credential installed. No workflow execution or email send requested." }, null, 2));
} catch { console.error("Assistant setup could not finish. Private credential output was withheld."); process.exitCode = 1; }
finally { if (staged) try { execFileSync("docker", ["exec", "--user", "root", container, "rm", "--", stage], { stdio: "pipe", windowsHide: true }); } catch { console.error("Remove the temporary assistant setup helper from the n8n container."); } }
