import { timingSafeEqual, createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { ValidationError } from "./domain";
import { cloudConfiguration, cloudRPC } from "./cloud-store.ts";
import { withWorkspace } from "./workspace-context.ts";

export async function n8nWorkspace(request: Request): Promise<string | NextResponse> {
  const secret = process.env.N8N_WEBHOOK_SECRET;
  const given = Buffer.from(request.headers.get("authorization") || "");
  if (secret) {
    const expected = Buffer.from(`Bearer ${secret}`);
    // The existing integration secret always addresses ClearFlow only.
    if (given.length === expected.length && timingSafeEqual(given, expected)) return "clearflow";
  }
  const match = /^Bearer (clw_[A-Za-z0-9_-]{43})$/.exec(given.toString());
  if (!match) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    if (cloudConfiguration()) {
      const found = await cloudRPC("crm_resolve_workspace_token", { p_token_hash: createHash("sha256").update(match[1]).digest("hex") });
      if (found?.workspace_id && typeof found.workspace_id === "string") return found.workspace_id;
    }
  } catch { return NextResponse.json({ error: "The automation connection could not be checked." }, { status: 503 }); }
  return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
}

export async function withN8N(request: Request, work: () => Promise<Response>): Promise<Response> {
  const workspace = await n8nWorkspace(request);
  if (typeof workspace !== "string") return workspace;
  try { return await withWorkspace(workspace, work); }
  catch (error) { return n8nError(error); }
}

export async function readN8NBody(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.length > 100_000) throw new ValidationError("Request is too large.", 413);
  let body;
  try { body = JSON.parse(raw); } catch { throw new ValidationError("Invalid JSON request."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("A JSON object is required.");
  return body;
}

export function n8nError(error: unknown) {
  if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("n8n integration request failed:", error);
  return NextResponse.json({ error: "Could not persist the integration request. Retry with the same ID." }, { status: 500 });
}
