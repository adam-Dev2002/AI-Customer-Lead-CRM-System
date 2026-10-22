import { NextResponse } from "next/server";
import { readConfiguration } from "@/lib/crm/storage";
import { withN8N, n8nError } from "@/lib/crm/n8n-auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return withN8N(request, async () => {
    try { return NextResponse.json(await readConfiguration(), { headers: { "Cache-Control": "no-store" } }); }
    catch (error) { return n8nError(error); }
  });
}
