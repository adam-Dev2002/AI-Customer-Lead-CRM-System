import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { cloudConfiguration, cloudRequest } from "./cloud-store.ts";
import { currentWorkspaceId } from "./workspace-context.ts";

export function privateFileKey(key: string) {
  if (/^config\/(assistant-gemini|google-contact-photos|customer-form)\.json$/.test(key) || /^reports\/[a-f0-9-]{36}\/(report\.(pdf|xlsx|json)|chart\.png|email\.html|mail(?:-[a-f0-9]{64})?\.mime)$/.test(key)) return key;
  throw new Error("Invalid private workspace file.");
}
export function privateFileStorageKey(key: string) {
  const validated = privateFileKey(key), scope = currentWorkspaceId();
  // Existing ClearFlow files retain their original names. Other businesses never
  // read that namespace, including when their own file has not been configured.
  return scope && scope !== "clearflow" ? `workspaces/${scope}/${validated}` : validated;
}
function localPath(key: string, directory?: string) {
  privateFileKey(key);
  const scope = currentWorkspaceId();
  if (scope && scope !== "clearflow") throw new Error("Private business files require cloud storage.");
  const root = directory || process.env.CRM_DATA_DIR || path.join(process.cwd(), ".data");
  // Local config predates the cloud bucket's config/ prefix.
  return path.join(/* turbopackIgnore: true */ root, key.startsWith("config/") ? key.slice(7) : key);
}
function objectPath(key: string) { return "/storage/v1/object/crm-private/" + privateFileStorageKey(key).split("/").map(encodeURIComponent).join("/"); }
export async function readPrivateFile(key: string, localDirectory?: string): Promise<Buffer> {
  if (!cloudConfiguration()) return readFile(/* turbopackIgnore: true */ localPath(key, localDirectory));
  const response = await cloudRequest(objectPath(key));
  if (!response.ok) {
    // Storage returns both 400/404 for absent objects. Neither authorizes a local fallback.
    if ([400, 404].includes(response.status)) throw Object.assign(new Error("Private file is unavailable."), { code: "ENOENT" });
    throw new Error("Private cloud file could not be opened.");
  }
  return Buffer.from(await response.arrayBuffer());
}
export async function writePrivateFile(key: string, bytes: Buffer | string) {
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (!cloudConfiguration()) {
    const filename = localPath(key), temporary = filename + "." + randomUUID() + ".tmp";
    await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
    try { await writeFile(temporary, body, { mode: 0o600 }); await rename(temporary, filename); }
    finally { await rm(temporary, { force: true }); }
    return;
  }
  const type = key.endsWith(".pdf") ? "application/pdf" : key.endsWith(".json") ? "application/json" : key.endsWith(".png") ? "image/png" : key.endsWith(".html") ? "text/html" : key.endsWith(".mime") ? "message/rfc822" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const response = await cloudRequest(objectPath(key), { method: "POST", headers: { "Content-Type": type, "x-upsert": "false" }, body: new Uint8Array(body) });
  if (response.ok) return;
  // Retrying an upload is safe only when the existing bytes are identical.
  if ([400, 409].includes(response.status)) {
    const existing = await readPrivateFile(key);
    if (existing.equals(body)) return;
  }
  throw new Error("Private cloud file could not be saved. Existing files were not overwritten.");
}
export async function removePrivateFiles(keys: string[]) {
  keys.forEach(privateFileKey);
  if (!cloudConfiguration()) { await Promise.all(keys.map(key => rm(localPath(key), { force: true }))); return; }
  const response = await cloudRequest("/storage/v1/object/crm-private", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: keys.map(privateFileStorageKey) }) });
  if (!response.ok) throw new Error("Temporary cloud report files could not be removed.");
}
