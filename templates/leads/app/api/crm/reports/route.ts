import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceAccess, sameOrigin } from "@/lib/auth/server";
import { consumeSharedLimit } from "@/lib/auth/rate-limit";
import { getSnapshot } from "@/lib/crm/storage";
import { createReportFiles } from "@/lib/crm/report-files";
import { reportCapability, reportRecipients } from "@/lib/crm/report-mail";
import { ValidationError } from "@/lib/crm/domain";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const processState = globalThis as typeof globalThis & { __reportBuilding?: boolean };
export async function POST(request: NextRequest) {
  const access = await requireWorkspaceAccess();
  if (access.response) return access.response;
  if (!sameOrigin(request))
    return NextResponse.json({ error: "Open exports from your workspace." }, { status: 403 });
  if (!(await consumeSharedLimit(`reports:${access.user.id}`, 6, 60_000)) || processState.__reportBuilding)
    return NextResponse.json(
      { error: "A report is being prepared. Please try again in a moment." },
      { status: 429 },
    );
  let acquired = false;
  try {
    const raw = await request.text();
    if (raw.length > 250000) throw new ValidationError("Choose fewer leads for this report.", 413);
    const body = JSON.parse(raw),
      data = await getSnapshot();
    if (processState.__reportBuilding)
      return NextResponse.json(
        { error: "Another report is being prepared. Please try again in a moment." },
        { status: 429 },
      );
    processState.__reportBuilding = true;
    acquired = true;
    const report = await createReportFiles(
      data,
      body.leadIds,
      typeof body.label === "string" ? body.label : "Current lead view",
    );
    return NextResponse.json(
      {
        report,
        recipients: reportRecipients(data),
        senderEmail: data.mailSenderEmail,
        canEmail:
          access.user.role === "owner" && !!data.mailSenderCapabilities?.includes(reportCapability),
        isOwner: access.user.role === "owner",
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof ValidationError
            ? error.message
            : "The report could not be prepared. Try fewer leads or contact support.",
      },
      { status: error instanceof ValidationError ? error.status : 503 },
    );
  } finally {
    if (acquired) processState.__reportBuilding = false;
  }
}
