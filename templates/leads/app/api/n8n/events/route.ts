import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { receiveEvent } from "@/lib/crm/storage";
import { ValidationError } from "@/lib/crm/domain";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (!secret)
    return NextResponse.json(
      { error: "n8n event ingestion is not configured." },
      { status: 503 },
    );
  const given = Buffer.from(request.headers.get("authorization") || ""),
    expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const raw = await request.text();
    if (raw.length > 100_000)
      throw new ValidationError("Event is too large.", 413);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new ValidationError("Invalid JSON event.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new ValidationError("An event object is required.");
    return NextResponse.json({ accepted: true, ...(await receiveEvent(body)) });
  } catch (error) {
    if (error instanceof ValidationError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    console.error("n8n event failed:", error);
    return NextResponse.json(
      { error: "Could not persist the event. Retry using the same eventId." },
      { status: 500 },
    );
  }
}
