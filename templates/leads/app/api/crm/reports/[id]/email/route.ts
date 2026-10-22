import { withWorkspace } from "@/lib/crm/workspace-context";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireWorkspaceAccess, sameOrigin } from "@/lib/auth/server";
import { consumeSharedLimit } from "@/lib/auth/rate-limit";
import { getSnapshot, queueReport } from "@/lib/crm/storage";
import { readReport, readReportFile } from "@/lib/crm/report-files";
import { reportMime, queueReportDelivery } from "@/lib/crm/report-mail";
import { ValidationError } from "@/lib/crm/domain";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireWorkspaceAccess();
  if (access.response) return access.response;
  return withWorkspace(access.user.workspaceId, async () => {
    if (access.user.role !== "owner" || !sameOrigin(request))
      return NextResponse.json(
        { error: "A workspace owner must confirm this report email." },
        { status: 403 },
      );
    if (!(await consumeSharedLimit(`report-mail:${access.user.id}`, 6, 60_000)))
      return NextResponse.json(
        { error: "Please wait a minute before sending another report." },
        { status: 429 },
      );
    try {
      const raw = await request.text();
      if (raw.length > 2000) throw new ValidationError("Invalid report email request.");
      const body = JSON.parse(raw),
        { id } = await params,
        report = await readReport(id),
        data = await getSnapshot();
      const input = {
        id: randomUUID(),
        confirmed: body.confirmed,
        to: typeof body.to === "string" ? body.to : "",
        senderEmail: typeof body.senderEmail === "string" ? body.senderEmail : "",
        recipientKind: body.recipientKind,
        saveAsDefault: body.saveAsDefault,
      };
      // Validate against a disposable snapshot before building MIME; the storage transaction validates again.
      const job = queueReportDelivery(
        structuredClone(data),
        report,
        { ...input, digest: "preview" },
        new Date().toISOString(),
      );
      const [pdf, xlsx, chart, html] = await Promise.all([
        readReportFile(id, "pdf"),
        readReportFile(id, "xlsx"),
        readReportFile(id, "png"),
        readReportFile(id, "html"),
      ]);
      const mime = reportMime({
        id: job.id,
        from: job.senderEmail,
        to: job.to,
        subject: job.subject,
        body: job.body,
        html: html.toString("utf8"),
        pdf,
        xlsx,
        chart,
        filename: report.filename,
        createdAt: job.createdAt,
      });
      return NextResponse.json(await queueReport(report, input, mime), {
        headers: { "Cache-Control": "private, no-store" },
      });
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof ValidationError
              ? error.message
              : "Could not queue this report. Please create a new export and try again.",
        },
        { status: error instanceof ValidationError ? error.status : 500 },
      );
    }
  });
}
