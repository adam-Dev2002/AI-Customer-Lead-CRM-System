import { withWorkspace } from "@/lib/crm/workspace-context";
import { NextRequest, NextResponse } from "next/server";
import { getSnapshot, mutate } from "@/lib/crm/storage";
import { ValidationError } from "@/lib/crm/domain";
import { requireWorkspaceAccess } from "@/lib/auth/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const access = await requireWorkspaceAccess();
  if (access.response) return access.response;
  return withWorkspace(access.user.workspaceId, async () => {
    try {
      return NextResponse.json(await getSnapshot(), {
        headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      console.error("CRM read failed:", error);
      return NextResponse.json(
        {
          error:
            "Could not load your workspace. Your saved data has not been reset.",
        },
        { status: 500 },
      );
    }
  });
}
export async function POST(request: NextRequest) {
  const access = await requireWorkspaceAccess();
  if (access.response) return access.response;
  return withWorkspace(access.user.workspaceId, async () => {
    const origin = request.headers.get("origin");
    if (origin) {
      let sameHost = false;
      try {
        const url = new URL(origin);
        sameHost =
          ["http:", "https:"].includes(url.protocol) &&
          url.host === (request.headers.get("host") || request.nextUrl.host);
      } catch {}
      if (!sameHost)
        return NextResponse.json(
          { error: "Cross-origin changes are not allowed." },
          { status: 403 },
        );
    }
    try {
      const raw = await request.text();
      if (raw.length > 2_000_000)
        throw new ValidationError("Request is too large.", 413);
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        throw new ValidationError("Invalid JSON request.");
      }
      if (
        !body ||
        typeof body.action !== "string" ||
        (body.payload !== undefined &&
          (!body.payload ||
            typeof body.payload !== "object" ||
            Array.isArray(body.payload)))
      )
        throw new ValidationError("Provide an action and a payload object.");
      return NextResponse.json(await mutate(body), {
        headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      if (error instanceof ValidationError)
        return NextResponse.json(
          { error: error.message },
          { status: error.status },
        );
      console.error("CRM update failed:", error);
      return NextResponse.json(
        { error: "Could not save your changes. Please try again." },
        { status: 500 },
      );
    }
  });
}
