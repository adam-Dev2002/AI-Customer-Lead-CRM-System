import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { CRMData } from "./types.ts";
import { currentWorkspaceId } from "./workspace-context.ts";

export function cloudConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const backend = env.CRM_STORAGE_BACKEND || "local";
  if (!["local", "supabase"].includes(backend)) throw new Error("Choose local or supabase CRM storage.");
  if (backend === "local") {
    if (env.VERCEL) throw new Error("Configure Supabase CRM storage before deploying to Vercel.");
    return null;
  }
  const key = env.SUPABASE_SECRET_KEY?.trim(), rawURL = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  let privileged = key?.startsWith("sb_secret_") || false;
  try { if (key?.split(".").length === 3) privileged = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role === "service_role"; } catch {}
  if (!key || !privileged || !rawURL) throw new Error("Configure the server-only Supabase secret key and project URL.");
  const url = new URL(rawURL);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("Use an HTTPS Supabase project URL.");
  return { url: url.origin, key };
}

export async function cloudRequest(resource: string, init: RequestInit = {}, request: typeof fetch = fetch) {
  const config = cloudConfiguration();
  if (!config) throw new Error("Supabase storage is not selected.");
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const headers = new Headers(init.headers);
      headers.set("apikey", config.key);
      if (!config.key.startsWith("sb_secret_")) headers.set("Authorization", `Bearer ${config.key}`);
      const response = await request(config.url + resource, { ...init, headers, cache: "no-store", signal: AbortSignal.timeout(20000) });
      if (response.status >= 500 && attempt < 2) continue;
      return response;
    } catch { if (attempt === 2) throw new Error("Cloud storage could not be reached. No local fallback was used."); }
  }
  throw new Error("Cloud storage is temporarily unavailable.");
}

export async function cloudRPC(name: string, body: Record<string, unknown> = {}) {
  const response = await cloudRequest(`/rest/v1/rpc/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error("Cloud workspace is unavailable. Verify the storage SQL migration, server key and imported workspace.");
  return response.json();
}

type Transaction = { data: CRMData; dirty: boolean; workspaceId?: string };
const transaction = new AsyncLocalStorage<Transaction>();
export function cloudWorkspace() {
  const context = transaction.getStore();
  if (!context || context.workspaceId !== currentWorkspaceId()) throw new Error("Cloud workspace reads require an authorized transaction.");
  return context.data;
}
export function stageCloudWorkspace(data: CRMData) {
  const context = transaction.getStore();
  if (!context || context.workspaceId !== currentWorkspaceId()) throw new Error("Cloud workspace writes require an authorized transaction.");
  context.data = data; context.dirty = true;
}

// Domain changes are computed in JS, then committed with a database revision check.
// A conflict recomputes against the latest state. Uncertain HTTP retries reuse the
// same commit receipt, so a committed mutation cannot be applied twice.
export async function cloudTransaction<T>(work: () => Promise<T>): Promise<T> {
  const scope = currentWorkspaceId();
  const tenant = scope && scope !== "clearflow" ? scope : undefined;
  if (!cloudConfiguration()) {
    if (scope && scope !== "clearflow") throw new Error("Private business workspaces require cloud storage.");
    return work();
  }
  for (let attempt = 0; attempt < 12; attempt++) {
    // Unscoped calls exist only for the original ClearFlow maintenance scripts.
    // Authenticated requests always supply their verified workspace explicitly.
    const stored = await cloudRPC(tenant ? "crm_tenant_read" : "crm_store_read", tenant ? { p_workspace_id: tenant } : {});
    if (!Number.isSafeInteger(stored.revision) || stored.data?.version !== 1) throw new Error("Import the existing CRM workspace before starting cloud storage.");
    const context: Transaction = { data: stored.data, dirty: false, workspaceId: scope };
    const result = await transaction.run(context, work);
    if (!context.dirty) return result;
    const input = { p_revision: stored.revision, p_data: context.data, p_request_id: randomUUID(), ...(tenant ? { p_workspace_id: tenant } : {}) };
    let committed;
    // Retry the exact request, including its receipt ID, after a lost/invalid response.
    for (let retry = 0; retry < 3; retry++) {
      try { committed = await cloudRPC(tenant ? "crm_tenant_commit" : "crm_store_commit", input); break; }
      catch { if (retry === 2) throw new Error("The cloud save could not be confirmed. Refresh before trying the action again."); }
    }
    if (committed?.applied === true) return result;
    if (committed?.applied !== false) throw new Error("Cloud save returned an invalid confirmation.");
    await new Promise(resolve => setTimeout(resolve, Math.min(25 * (attempt + 1), 300)));
  }
  throw new Error("The workspace is busy. Refresh and try again.");
}
