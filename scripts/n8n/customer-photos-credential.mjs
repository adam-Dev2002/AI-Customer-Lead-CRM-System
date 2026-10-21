// Runs inside n8n. Raw credential exports stay in captured process memory.
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { createCipheriv, createHash, publicEncrypt, randomBytes } from "node:crypto";
import { createRequire } from "node:module";

const credentialId = "CRMContactPhotosReadOnly";
const credentialName = "Customer photos (Google read-only)";
const scopes = ["https://www.googleapis.com/auth/contacts.readonly", "https://www.googleapis.com/auth/contacts.other.readonly", "openid", "email", "profile"];
const action = process.argv[2] || "status";
const cliEnv = { ...process.env, N8N_LOG_LEVEL: "info", N8N_DIAGNOSTICS_ENABLED: "false", N8N_RUNNERS_ENABLED: "false" };
let phase = "preflight";
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
  throw new Error("Private export unavailable.");
}
function exportData(id) {
  const result = spawnSync("n8n", ["export:credentials", `--id=${id}`, "--decrypted"], { encoding: "utf8", maxBuffer: 4e6, env: cliEnv });
  if (result.status !== 0) throw new Error("Private export failed.");
  return exportedArray(result.stdout, id)[0].data;
}
const tokenData = data => typeof data.oauthTokenData === "string" ? JSON.parse(data.oauthTokenData) : data.oauthTokenData || {};
const fingerprint = rows => createHash("sha256").update(JSON.stringify(rows)).digest("hex");
try {
  if (!["status", "prepare", "install"].includes(action)) throw new Error("Unsupported setup action.");
  const db = new DatabaseSync("/home/node/.n8n/database.sqlite", { readOnly: true });
  const originals = db.prepare("SELECT id,name,type,data FROM credentials_entity WHERE id<>? ORDER BY id").all(credentialId);
  const workflowRows = db.prepare("SELECT id,nodes,connections,active,activeVersionId FROM workflow_entity ORDER BY id").all();
  const existing = db.prepare("SELECT id,name,type FROM credentials_entity WHERE id=?").get(credentialId);
  const workflow = workflowRows.find(row => row.id === "63a8178b-64a0-4360-8ff3-d150fe201cf9");
  const gmailId = JSON.parse(workflow.nodes).find(node => node.credentials?.gmailOAuth2)?.credentials.gmailOAuth2.id;
  const sharing = db.prepare("SELECT projectId FROM shared_credentials WHERE credentialsId=? AND role='credential:owner'").get(gmailId);
  if (!gmailId || !sharing) throw new Error("The existing CRM Gmail account could not be identified.");
  let output = { credentialId, credentialName, exists: !!existing, connected: false, n8nCredentialsUrl: "http://localhost:5678/home/credentials" };
  if (action === "prepare" && !existing) {
    phase = "prepare-credential";
    const source = exportData(gmailId);
    if (!source.clientId || !source.clientSecret) throw new Error("Existing Google client settings are unavailable.");
    const backup = "/home/node/.n8n/customerlead-backups/contact-photos-" + new Date().toISOString().replace(/[:.]/g, "-");
    fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
    fs.writeFileSync(backup + "/encrypted-credential-rows.json", JSON.stringify(originals), { mode: 0o600 });
    const row = { id: credentialId, name: credentialName, type: "googleContactsOAuth2Api", description: "Read-only contact and email-sender photos for the customer dashboard. No contact edits or email sending.", data: { clientId: source.clientId, clientSecret: source.clientSecret, customScopes: true, enabledScopes: scopes.join(" ") } };
    const require = createRequire("/usr/local/lib/node_modules/n8n/package.json");
    const { Cipher } = require("n8n-core");
    const encryptionKey = process.env.N8N_ENCRYPTION_KEY || JSON.parse(fs.readFileSync("/home/node/.n8n/config", "utf8")).encryptionKey;
    if (!encryptionKey) throw new Error("The n8n credential encryption key is unavailable.");
    const cipher = new Cipher({ encryptionKey }, null);
    const inputPath = backup + "/new-photo-credential.encrypted.json";
    fs.writeFileSync(inputPath, JSON.stringify([{ ...row, data: cipher.encryptWithInstanceKey(row.data) }]), { mode: 0o600 });
    const imported = spawnSync("n8n", ["import:credentials", `--input=${inputPath}`, `--projectId=${sharing.projectId}`], { encoding: "utf8", maxBuffer: 4e6, env: cliEnv });
    if (imported.status !== 0 || !db.prepare("SELECT id FROM credentials_entity WHERE id=?").get(credentialId)) throw new Error("Credential preparation failed.");
    output = { ...output, exists: true, created: true, backupDirectory: backup };
  }
  if (existing || output.created) {
    phase = "check-consent";
    const data = exportData(credentialId), token = tokenData(data);
    output.connected = !!token.refresh_token;
    output.requestedScopes = String(data.enabledScopes || "").split(/\s+/).filter(Boolean);
    output.cloudPeopleApiUrl = "https://console.cloud.google.com/apis/library/people.googleapis.com?project=" + encodeURIComponent(String(data.clientId).split("-")[0]);
    if (action === "install") {
      if (!token.refresh_token) { output.needsConsent = true; }
      else {
        phase = "verify-google";
        const refresh = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: data.clientId, client_secret: data.clientSecret, refresh_token: token.refresh_token, grant_type: "refresh_token" }), signal: AbortSignal.timeout(15000) });
        const fresh = await refresh.json();
        if (!refresh.ok) throw new Error("Google authorization could not be refreshed.");
        const granted = new Set(String(fresh.scope || token.scope || "").split(/\s+/));
        if (!scopes.slice(0, 2).every(scope => granted.has(scope))) { output.needsConsent = true; output.missingReadOnlyScope = true; }
        else {
          const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${fresh.access_token}` }, signal: AbortSignal.timeout(15000) });
          const profile = await profileResponse.json();
          const expectedEmail = process.argv[3]?.trim().toLowerCase();
          if (!profileResponse.ok || !profile.email_verified || !expectedEmail || profile.email?.toLowerCase() !== expectedEmail) throw new Error("Connect the same business Google account as the CRM sender.");
          const probe = await fetch("https://people.googleapis.com/v1/people/me/connections?personFields=emailAddresses,photos&pageSize=1", { headers: { Authorization: `Bearer ${fresh.access_token}` }, signal: AbortSignal.timeout(15000) });
          if (!probe.ok) {
            const body = await probe.json();
            output.peopleApiAvailable = false;
            output.peopleReason = body.error?.details?.find(item => item.reason)?.reason || "READ_UNAVAILABLE";
          } else output.peopleApiAvailable = true;
          const publicKey = fs.readFileSync(0, "utf8");
          const key = randomBytes(32), iv = randomBytes(12);
          const cipher = createCipheriv("aes-256-gcm", key, iv);
          const config = JSON.stringify({ version: 1, clientId: data.clientId, clientSecret: data.clientSecret, refreshToken: token.refresh_token, accountEmail: expectedEmail, connectedAt: new Date().toISOString() });
          const encrypted = Buffer.concat([cipher.update(config, "utf8"), cipher.final()]);
          output.accountEmail = expectedEmail;
          output.envelope = { key: publicEncrypt(publicKey, key).toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: encrypted.toString("base64") };
        }
      }
    }
  }
  const afterCredentials = db.prepare("SELECT id,name,type,data FROM credentials_entity WHERE id<>? ORDER BY id").all(credentialId);
  const afterWorkflows = db.prepare("SELECT id,nodes,connections,active,activeVersionId FROM workflow_entity ORDER BY id").all();
  if (fingerprint(originals) !== fingerprint(afterCredentials) || fingerprint(workflowRows) !== fingerprint(afterWorkflows)) throw new Error("Existing workflow or credential content changed during setup; review required.");
  output.existingWorkflowsAndCredentialsUnchanged = true;
  db.close();
  console.log(JSON.stringify(output));
} catch {
  console.log(JSON.stringify({ error: "Customer photo setup could not finish. Credential and CLI output were withheld.", phase }));
  process.exitCode = 1;
}
