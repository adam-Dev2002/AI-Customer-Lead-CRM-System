import { withWorkspace } from "@/lib/crm/workspace-context";
import { requireWorkspaceAccess } from "@/lib/auth/server";
import { getSnapshot } from "@/lib/crm/storage";
import { companyLogoDomain, senderCompanyDomain } from "@/lib/crm/sender-logo";
import { readCompanyLogo } from "@/lib/crm/company-logos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await requireWorkspaceAccess();
  if (access.response) return access.response;
  return withWorkspace(access.user.workspaceId, async () => {
    const domain = companyLogoDomain(new URL(request.url).searchParams.get("domain") || "");
    const missing = () =>
      new Response(null, {
        status: 404,
        headers: { "Cache-Control": "private, no-store" },
      });
    if (!domain) return missing();
    try {
      const data = await getSnapshot();
      // This endpoint can resolve only senders already captured in this workspace.
      if (!data.leads.some((lead) => senderCompanyDomain(lead.email) === domain)) return missing();
      const image = await readCompanyLogo(domain);
      if (!image) return missing();
      return new Response(new Uint8Array(image), {
        headers: {
          "Content-Type": "image/webp",
          "Cache-Control": "private, max-age=3600",
          "X-Content-Type-Options": "nosniff",
          "Cross-Origin-Resource-Policy": "same-origin",
        },
      });
    } catch {
      return missing();
    }
  });
}
