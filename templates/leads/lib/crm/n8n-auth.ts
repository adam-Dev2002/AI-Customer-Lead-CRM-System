import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { ValidationError } from "./domain";

export function authenticateN8N(request: Request) {
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "n8n integration is not configured." }, { status: 503 });
  const given = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
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
