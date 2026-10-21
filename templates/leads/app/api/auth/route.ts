import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import { supabaseServer, workspaceAccess, sameOrigin } from "@/lib/auth/server";
import { safeReturnPath } from "@/lib/auth/config";
import { consumeSharedLimit } from "@/lib/auth/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return reply({ error: "Please use the sign-in form on this website." }, 403);
  const client = await supabaseServer();
  try {
    const raw = await request.text();
    if (raw.length > 4096) return reply({ error: "Request is too large." }, 413);
    const body = JSON.parse(raw);
    if (body.action === "logout") {
      try { await client?.auth.signOut({ scope: "local" }); } catch { /* Local sign-out must still work during an Auth outage. */ }
      const store = await cookies();
      for (const cookie of store.getAll()) if (/^sb-.*-auth-token(?:\..*|-code-verifier)?$/.test(cookie.name)) store.set(cookie.name, "", { path: "/", maxAge: 0 });
      return reply({ ok: true });
    }
    if (!client) return reply({ error: "Sign-in is not available yet. Contact your workspace administrator." }, 503);
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
    if (!(await consumeSharedLimit(`auth:${key}`, 8, 10 * 60_000)) || !(await consumeSharedLimit("auth:global", 120, 10 * 60_000))) return reply({ error: "Too many attempts. Please wait a few minutes and try again." }, 429);
    if (body.action === "reset") {
      await client.auth.resetPasswordForEmail(email, { redirectTo: new URL("/auth/callback?next=/update-password", request.headers.get("origin")!).href });
      return reply({ ok: true, message: "If this email has an account, check your inbox for a password reset link." });
    }
    if (body.action !== "login" || typeof body.password !== "string" || !body.password || body.password.length > 128) return reply({ error: "Enter your email and password." }, 400);
    const result = await client.auth.signInWithPassword({ email, password: body.password });
    if (result.error) return reply({ error: "We couldn’t sign you in. Check your email and password." }, 401);
    const access = await workspaceAccess();
    if (access.status !== "authorized") {
      await client.auth.signOut({ scope: "local" });
      return reply({ error: access.status === "forbidden" ? "Your account hasn’t been given workspace access. Contact your administrator." : "Workspace access could not be checked. Please try again." }, access.status === "forbidden" ? 403 : 503);
    }
    return reply({ ok: true, next: safeReturnPath(body.next) });
  } catch { return reply({ error: "Sign-in could not finish. Please try again." }, 503); }
}
