import { NextResponse } from "next/server";
import { authenticateN8N } from "@/lib/crm/n8n-auth";
import { cloudConfiguration, cloudRPC } from "@/lib/crm/cloud-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const denied = authenticateN8N(request);
  if (denied) return denied;
  try {
    const cloud = cloudConfiguration();
    if (cloud) await cloudRPC("crm_store_read");
    return NextResponse.json({ service: "customerlead", ready: true, storage: cloud ? "supabase" : "local", version: 1, capabilities: { atomicFollowUpClaim: true, approvedFollowUps: true } }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ service: "customerlead", ready: false, error: "Workspace storage is unavailable. Verify the cloud migration and private configuration." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
