// Local maintainer setup. OAuth credentials are transferred encrypted and never logged.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createDecipheriv, generateKeyPairSync, privateDecrypt, randomUUID } from "node:crypto";

const root = fileURLToPath(new URL("../", import.meta.url));
const action = process.argv[2] || "status";
const container = process.env.CUSTOMERLEAD_N8N_CONTAINER || "n8n";
const stage = `/tmp/customerlead-photos-${randomUUID()}.mjs`;
let staged = false;
try {
  if (!["status", "prepare", "install"].includes(action)) throw new Error("Use status, prepare, or install.");
  const app = path.join(root, "templates/leads");
  const snapshot = JSON.parse(fs.readFileSync(path.join(app, ".data/crm.json"), "utf8"));
  const account = snapshot.mailSenderEmail || snapshot.settings.ownerEmail;
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  execFileSync("docker", ["cp", path.join(root, "scripts/n8n/customer-photos-credential.mjs"), `${container}:${stage}`], { stdio: "pipe", windowsHide: true });
  staged = true;
  const raw = execFileSync("docker", ["exec", "-i", container, "node", "--no-warnings", stage, action, account], {
    input: publicKey.export({ type: "spki", format: "pem" }), encoding: "utf8", maxBuffer: 4e6, windowsHide: true,
  });
  const result = JSON.parse(raw);
  if (result.error) throw new Error(result.error);
  if (result.envelope) {
    const envelope = result.envelope;
    const key = privateDecrypt(privateKey, Buffer.from(envelope.key, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const config = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]);
    const parsed = JSON.parse(config.toString("utf8"));
    if (parsed.accountEmail !== account || !parsed.clientId || !parsed.clientSecret || !parsed.refreshToken) throw new Error("Google connection validation failed.");
    const filename = path.join(app, ".data/google-contact-photos.json");
    if (fs.existsSync(filename)) {
      const backups = path.join(root, "private-integrations/customer-photo-backups");
      fs.mkdirSync(backups, { recursive: true, mode: 0o700 });
      fs.copyFileSync(filename, path.join(backups, `before-${Date.now()}.json`));
    }
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try { fs.writeFileSync(temporary, config, { mode: 0o600 }); fs.renameSync(temporary, filename); }
    finally { fs.rmSync(temporary, { force: true }); }
    delete result.envelope;
    result.installed = true;
    result.restartRequired = false;
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  let detail = "";
  try { const safe = JSON.parse(error.stdout?.toString() || "{}"); if (safe.phase) detail = ` Phase: ${safe.phase}.`; } catch {}
  console.error("Customer photo setup could not finish." + detail + " Private credential output was withheld; no Gmail send or workflow execution was requested.");
  process.exitCode = 1;
} finally {
  if (staged) {
    try { execFileSync("docker", ["exec", "--user", "root", container, "rm", "--", stage], { stdio: "pipe", windowsHide: true }); } catch { console.error("Remove the temporary photo setup helper from the n8n container."); }
  }
}
