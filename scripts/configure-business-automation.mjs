// Maintainer tool. Plan by default; never prints a connection token.
import { randomBytes, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { cloudConfiguration, cloudRPC } from "../templates/leads/lib/crm/cloud-store.ts";
const args = process.argv.slice(2), allowed = new Set(["--workspace", "--apply", "--rotate"]);
if (args.some(value => value.startsWith("--") && !allowed.has(value))) throw new Error("Use --workspace <id> [--apply] [--rotate].");
const id = args[args.indexOf("--workspace") + 1];
if (!args.includes("--workspace") || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id || "")) throw new Error("Choose the new business's workspace UUID from crm_workspace_members. ClearFlow keeps its existing secret.");
if (!cloudConfiguration()) throw new Error("Use the matching Supabase server environment.");
await cloudRPC("crm_tenant_read", { p_workspace_id: id });
const exists = await cloudRPC("crm_workspace_connection", { p_workspace_id: id });
if (!args.includes("--apply")) {
  console.log(JSON.stringify({ workspaceId: id, existingConnection: exists, plan: "Create a private per-business n8n Bearer credential. No changes made." }));
} else {
  if (exists && !args.includes("--rotate")) throw new Error("This business already has a connection. Use --rotate only during a coordinated credential change; old workflows will lose access.");
  const token = "clw_" + randomBytes(32).toString("base64url");
  const directory = new URL("../private-integrations/business-connections/", import.meta.url);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = new URL(`${id}-${Date.now()}.json`, directory);
  await writeFile(file, JSON.stringify({ workspaceId: id, authorization: `Bearer ${token}`, instructions: "Private. Use only in this business's n8n Header Auth credential. Configure its own Gmail, Sheet, Gemini and form separately." }, null, 2), { mode: 0o600, flag: "wx" });
  await cloudRPC("crm_set_workspace_token", { p_workspace_id: id, p_token_hash: createHash("sha256").update(token).digest("hex") });
  console.log(JSON.stringify({ savedPrivateCredential: fileURLToPath(file), workspaceId: id, rotated: exists, note: "Token was saved privately; no workflow was activated or email sent." }));
}
