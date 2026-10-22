import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createHash, randomUUID } from "node:crypto";
import { supabaseServer, workspaceAccess, sameOrigin } from "@/lib/auth/server";
import { safeReturnPath } from "@/lib/auth/config";
import { sharedLimitResult } from "@/lib/auth/rate-limit";
import { cloudConfiguration, cloudRPC } from "@/lib/crm/cloud-store";
import { authFailureMessage, authProviderFailure, type AuthAction, type AuthFailureCode } from "@/lib/auth/failures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
function failure(action: AuthAction, code: AuthFailureCode, phase: string) {
  const requestId = randomUUID();
  // Keep passwords, emails, cookies, keys and raw provider errors out of logs.
  console.error("Authentication request failed", { requestId, action, code, phase });
  return reply({ error: authFailureMessage(action, code), code, requestId }, code === "AUTH_RATE_LIMIT" ? 429 : code === "AUTH_WEAK_PASSWORD" ? 400 : 503);
}
async function signOutLocally(client: Awaited<ReturnType<typeof supabaseServer>>) {
  try { await client?.auth.signOut({ scope: "local" }); } catch { /* Clear local cookies even when Auth is unavailable. */ }
  const store = await cookies();
  for (const cookie of store.getAll()) if (/^sb-.*-auth-token(?:\..*|-code-verifier)?$/.test(cookie.name)) store.set(cookie.name, "", { path: "/", maxAge: 0 });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return reply({ error: "Please use the sign-in form on this website." }, 403);
  let action: AuthAction = "login", phase = "request";
  try {
    const raw = await request.text();
    if (raw.length > 4096) return reply({ error: "Request is too large." }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return reply({ error: "Provide a valid sign-in request." }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ error: "Choose a sign-in action." }, 400);
    if (!["login", "signup", "reset", "password", "logout"].includes(body.action)) return reply({ error: "Choose a sign-in action." }, 400);
    action = body.action;
    phase = "auth-client";
    const client = await supabaseServer();
    if (body.action === "logout") {
      await signOutLocally(client);
      return reply({ ok: true });
    }
    if (!client) return failure(action, "AUTH_CONFIGURATION", phase);
    if (body.action === "password") {
      const access = await workspaceAccess();
      if (access.status !== "authorized") return reply({ error: "Please sign in with an authorized workspace account." }, 401);
      if (typeof body.password !== "string" || body.password.length < 10 || body.password.length > 128) return reply({ error: "Use a password with 10 to 128 characters." }, 400);
      const result = await client.auth.updateUser({ password: body.password });
      return result.error ? reply({ error: "Could not update your password. Try a different password or request a fresh reset link." }, 400) : reply({ ok: true });
    }
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return reply({ error: "Enter a valid email address." }, 400);
    const key = createHash("sha256").update(email).digest("hex");
    phase = "shared-rate-limit";
    for (const [limitKey, limit] of [[`auth:${key}`, 8], ["auth:global", 120]] as const) {
      const result = await sharedLimitResult(limitKey, limit, 10 * 60_000);
      if (result !== "allowed") return failure(action, result === "limited" ? "AUTH_RATE_LIMIT" : "AUTH_CONFIGURATION", phase);
    }
    if (body.action === "reset") {
      phase = "password-reset";
      const result = await client.auth.resetPasswordForEmail(email, { redirectTo: new URL("/auth/callback?next=/update-password", request.headers.get("origin")!).href });
      if (result.error) return failure(action, authProviderFailure(result.error), phase);
      return reply({ ok: true, message: "If this email has an account, check your inbox for a password reset link." });
    }
    if (body.action === "signup") {
      const businessName = typeof body.businessName === "string" ? body.businessName.trim() : "";
      if (businessName.length < 2 || businessName.length > 100 || /[\u0000-\u001f\u007f]/.test(businessName)) return reply({ error: "Enter a business name with 2 to 100 characters." }, 400);
      if (typeof body.password !== "string" || body.password.length < 10 || body.password.length > 128) return reply({ error: "Use a password with 10 to 128 characters." }, 400);
      if (body.password !== body.confirmPassword) return reply({ error: "Your passwords do not match." }, 400);
      phase = "workspace-setup";
      if (cloudConfiguration()) {
        try {
          // This read-only RPC ships atomically with private workspace creation.
          // An absent id reads no business data. Never create an Auth account
          // when its workspace migration or server database access is missing.
          const ready = await cloudRPC("crm_workspace_connection", { p_workspace_id: "" });
          if (typeof ready !== "boolean") return failure(action, "AUTH_WORKSPACE_SETUP", phase);
        } catch { return failure(action, "AUTH_WORKSPACE_SETUP", phase); }
      }
      phase = "signup-provider";
      const result = await client.auth.signUp({ email, password: body.password, options: { data: { business_name: businessName }, emailRedirectTo: new URL("/auth/confirm?type=signup", request.headers.get("origin")!).href } });
      // Registration never opens the CRM, including when email confirmation has
      // accidentally been disabled in the project's provider configuration.
      if (result.data?.session) await signOutLocally(client);
      if (result.error && !["user_already_exists", "email_exists"].includes(result.error.code || "")) {
        const code = authProviderFailure(result.error);
        if (code !== "AUTH_UNAVAILABLE" || !result.error.status || result.error.status >= 500) return failure(action, code, phase);
        return reply({ error: "Could not create your account. Check your details or try again shortly." }, result.error.status && result.error.status < 500 ? 400 : 503);
      }
      return reply({ ok: true, message: "Check your inbox for an account confirmation email. If you already have an account, sign in or reset your password. Your business workspace opens after you confirm your email and sign in." });
    }
    if (body.action !== "login" || typeof body.password !== "string" || !body.password || body.password.length > 128) return reply({ error: "Enter your email and password." }, 400);
    phase = "login-provider";
    const result = await client.auth.signInWithPassword({ email, password: body.password });
    if (result.error && (!result.error.status || result.error.status >= 500)) return failure(action, "AUTH_UNAVAILABLE", phase);
    if (result.error) return reply({ error: "We couldn’t sign you in. Check your email and password." }, 401);
    const access = await workspaceAccess();
    if (access.status !== "authorized") {
      await signOutLocally(client);
      return reply({ error: access.status === "forbidden" ? "Confirm your email before opening your workspace. Contact support if you still need help." : "Workspace access could not be checked. Please try again." }, access.status === "forbidden" ? 403 : 503);
    }
    return reply({ ok: true, next: safeReturnPath(body.next) });
  } catch { return failure(action, "AUTH_UNAVAILABLE", phase); }
}
