import { NextResponse } from "next/server";
import { receiveEvent } from "@/lib/crm/storage";
import { withN8N, readN8NBody } from "@/lib/crm/n8n-auth";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return withN8N(request, async () => NextResponse.json({ accepted: true, ...(await receiveEvent(await readN8NBody(request))) }, { headers: { "Cache-Control": "no-store" } }));
}
