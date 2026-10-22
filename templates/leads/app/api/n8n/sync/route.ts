import { NextResponse } from "next/server";
import { pollChanges, acknowledgeChange } from "@/lib/crm/storage";
import { withN8N, readN8NBody, n8nError } from "@/lib/crm/n8n-auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return withN8N(request, async () => {
    try { return NextResponse.json(await pollChanges(), { headers: { "Cache-Control": "no-store" } }); }
    catch (error) { return n8nError(error); }
  });
}
export async function POST(request: Request) {
  return withN8N(request, async () => {
    try { return NextResponse.json(await acknowledgeChange(await readN8NBody(request))); }
    catch (error) { return n8nError(error); }
  });
}
