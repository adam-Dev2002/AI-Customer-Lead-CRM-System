import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { supabaseConfiguration } from "./config";
import { cloudConfiguration, cloudRPC } from "../crm/cloud-store.ts";
import { createEmptyWorkspace } from "../crm/new-workspace.ts";

export async function supabaseServer() {
  const config = supabaseConfiguration();
  if (!config) return null;
  const store = await cookies();
  return createServerClient(config.url, config.key, {
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal: init?.signal || AbortSignal.timeout(12000) }) },
    cookies: {
      getAll: () => store.getAll(),
      setAll: values => {
        try { values.forEach(({ name, value, options }) => store.set(name, value, options)); }
        catch { /* Server components refresh cookies through proxy.ts. */ }
      },
    },
  });
}

export async function workspaceAccess() {
  const client = await supabaseServer();
  if (!client) return { status: "unconfigured" as const, user: null };
  try {
    // getUser validates the token with Supabase Auth. A cookie alone grants no access.
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return { status: "unauthenticated" as const, user: null };
    if (!data.user.email_confirmed_at) return { status: "forbidden" as const, user: null };
    let membership = await client.from("crm_workspace_members").select("user_id, workspace_id, role, display_name")
      .eq("user_id", data.user.id).maybeSingle();
    if (membership.error) return { status: "unavailable" as const, user: null };
    if (!membership.data) {
      if (!cloudConfiguration()) return { status: "forbidden" as const, user: null };
      const suppliedName = data.user.user_metadata?.business_name;
      const businessName = typeof suppliedName === "string" ? suppliedName.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 100) : "";
      const name = businessName.length >= 2 ? businessName : "My business";
      // Only the server can provision a new, empty workspace. A new account is
      // never inserted into the existing business's membership or records.
      const provisioned = await cloudRPC("crm_provision_workspace", { p_user_id: data.user.id, p_name: name, p_data: createEmptyWorkspace(name) });
      if (!provisioned || typeof provisioned.workspace_id !== "string") return { status: "unavailable" as const, user: null };
      membership = await client.from("crm_workspace_members").select("user_id, workspace_id, role, display_name")
        .eq("user_id", data.user.id).maybeSingle();
      if (membership.error || !membership.data || membership.data.workspace_id !== provisioned.workspace_id) return { status: "unavailable" as const, user: null };
    }
    if (typeof membership.data.workspace_id !== "string" || !membership.data.workspace_id) return { status: "unavailable" as const, user: null };
    return { status: "authorized" as const, user: {
      id: data.user.id, email: data.user.email || "", role: membership.data.role as string,
      name: (membership.data.display_name || data.user.email || "Workspace member") as string,
      workspaceId: membership.data.workspace_id,
    } };
  } catch { return { status: "unavailable" as const, user: null }; }
}

export async function requireWorkspaceAccess() {
  const access = await workspaceAccess();
  if (access.status === "authorized") return { user: access.user, response: null };
  const status = access.status === "unauthenticated" ? 401 : access.status === "forbidden" ? 403 : 503;
  const error = status === 401 ? "Please sign in to continue." : status === 403 ? "Your account does not have access to this workspace." : "Workspace sign-in is unavailable. Contact your administrator.";
  return { user: null, response: NextResponse.json({ error }, { status, headers: { "Cache-Control": "private, no-store" } }) };
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  try {
    const parsed = origin ? new URL(origin) : null;
    // Next.js can normalize request.url to localhost on a 127.0.0.1 binding.
    return !!parsed && ["http:", "https:"].includes(parsed.protocol) && parsed.host === (request.headers.get("host") || new URL(request.url).host) && request.headers.get("sec-fetch-site") !== "cross-site";
  }
  catch { return false; }
}
