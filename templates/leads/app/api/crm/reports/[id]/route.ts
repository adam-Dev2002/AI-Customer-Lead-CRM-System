import { withWorkspace } from "@/lib/crm/workspace-context";
import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceAccess } from "@/lib/auth/server";
import { readReport, readReportFile } from "@/lib/crm/report-files";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireWorkspaceAccess();
  if (access.response) return access.response;
  return withWorkspace(access.user.workspaceId, async () => {
    const { id } = await params, format = request.nextUrl.searchParams.get("format");
    if (format !== "pdf" && format !== "xlsx") return NextResponse.json({ error: "Choose PDF or Excel." }, { status: 400 });
    try {
      const meta = await readReport(id), bytes = await readReportFile(id, format);
      return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${meta.filename}.${format}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    } catch { return NextResponse.json({ error: "This report is unavailable. Create a new export." }, { status: 404 }); }
  });
}
