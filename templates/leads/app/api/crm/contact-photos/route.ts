import { NextResponse } from "next/server";
import { getSnapshot } from "@/lib/crm/storage";
import { readGoogleContactPhotos } from "@/lib/crm/google-contact-photos";
import { requireWorkspaceAccess } from "@/lib/auth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const access = await requireWorkspaceAccess();
  if (access.response) return access.response;
  try {
    const data = await getSnapshot();
    // No arbitrary email lookup: only contacts already in this workspace are returned.
    const account = data.mailSenderEmail || data.settings.ownerEmail;
    const result = await readGoogleContactPhotos([...data.leads.map(lead => lead.email), data.settings.ownerEmail, account], account);
    return NextResponse.json(result,
      { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ status: "unavailable", photos: {} },
      { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
