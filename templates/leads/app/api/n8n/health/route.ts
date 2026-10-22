import { NextResponse } from "next/server";
import { withN8N } from "@/lib/crm/n8n-auth";
import { cloudConfiguration, cloudRPC } from "@/lib/crm/cloud-store";
import { workspaceId } from "@/lib/crm/workspace-context";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return withN8N(request, async () => {
    try {
      const cloud = cloudConfiguration();
      const id = workspaceId();
      if (cloud) await cloudRPC(id === "clearflow" ? "crm_store_read" : "crm_tenant_read", id === "clearflow" ? {} : { p_workspace_id: id });
      return NextResponse.json({ service: "customerlead", ready: true, storage: cloud ? "supabase" : "local", version: 1, capabilities: { atomicFollowUpClaim: true, approvedFollowUps: true } }, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return NextResponse.json({ service: "customerlead", ready: false, error: "Workspace storage is unavailable. Verify the cloud migration and private configuration." }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  });
}
