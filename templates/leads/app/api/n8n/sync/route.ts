import { NextResponse } from "next/server";
import { pollChanges, acknowledgeChange } from "@/lib/crm/storage";
import { authenticateN8N, readN8NBody, n8nError } from "@/lib/crm/n8n-auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const denied = authenticateN8N(request);
  if (denied) return denied;
  try { return NextResponse.json(await pollChanges(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return n8nError(error); }
}
export async function POST(request: Request) {
  const denied = authenticateN8N(request);
  if (denied) return denied;
  try { return NextResponse.json(await acknowledgeChange(await readN8NBody(request))); }
  catch (error) { return n8nError(error); }
}
