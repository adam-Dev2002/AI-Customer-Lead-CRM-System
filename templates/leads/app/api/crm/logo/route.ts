import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceAccess, sameOrigin } from "@/lib/auth/server";
import { consumeSharedLimit } from "@/lib/auth/rate-limit";
import { saveBusinessLogo } from "@/lib/crm/storage";
import { readLogoUpload, LogoUploadError } from "@/lib/crm/logo-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

async function update(request: NextRequest, restore: boolean) {
  const access = await requireWorkspaceAccess();
  if (access.response) return access.response;
  if (access.user.role !== "owner") return reply({ error: "Only a workspace owner can change the business logo." }, 403);
  if (!sameOrigin(request)) return reply({ error: "Please change the logo from your workspace settings." }, 403);
  if (!(await consumeSharedLimit(`logo:${access.user.id}`, 20, 60_000))) return reply({ error: "Please wait a minute before changing the logo again." }, 429);
  try {
    await saveBusinessLogo(restore ? "" : await readLogoUpload(request));
    return reply({ ok: true });
  } catch (error) {
    return reply({ error: error instanceof LogoUploadError ? error.message : "Could not save your logo. Please try again." }, error instanceof LogoUploadError ? error.status : 500);
  }
}
export const POST = (request: NextRequest) => update(request, false);
export const DELETE = (request: NextRequest) => update(request, true);
