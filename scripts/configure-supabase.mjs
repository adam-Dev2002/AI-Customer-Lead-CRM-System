// Only the public project URL and publishable/anon key belong here. No admin key.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
try {
  const url = new URL(process.argv[2]);
  const key = process.argv[3]?.trim();
  if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co") || !key || key.startsWith("sb_secret_")) throw new Error();
  if (!key.startsWith("sb_publishable_")) {
    const claims = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString());
    if (claims.role !== "anon") throw new Error();
  }
  const check = await fetch(url.origin + "/auth/v1/settings", { headers: { apikey: key }, signal: AbortSignal.timeout(15000) });
  if (!check.ok) throw new Error();
  const settings = await check.json();
  const filename = path.join(root, "templates/leads/.env.local");
  let content = fs.existsSync(filename) ? fs.readFileSync(filename, "utf8") : "";
  const original = content;
  for (const [name, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: url.origin, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key })) {
    const pattern = new RegExp(`^${name}=.*$`, "m");
    content = pattern.test(content) ? content.replace(pattern, `${name}=${value}`) : content.trimEnd() + `\n${name}=${value}\n`;
  }
  if (original !== content) {
    if (original) {
      const backups = path.join(root, "private-integrations/auth-backups"); fs.mkdirSync(backups, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(backups, `before-supabase-${Date.now()}.env`), original, { mode: 0o600 });
    }
    fs.writeFileSync(filename, content, { mode: 0o600 });
  }
  const table = await fetch(url.origin + "/rest/v1/crm_workspace_members?select=user_id&limit=1", { headers: { apikey: key }, signal: AbortSignal.timeout(10000) });
  console.log(JSON.stringify({ configured: true, project: url.hostname, authAvailable: true, publicSignupsDisabled: settings.disable_signup === true, membershipTableStatus: table.status, next: "Run the supplied migration, create the application user, then grant workspace access. No password or service-role key is stored in the app." }, null, 2));
} catch { console.error("Supabase configuration could not be verified. Use the project URL and public publishable/anon key; do not use an admin secret."); process.exitCode = 1; }
