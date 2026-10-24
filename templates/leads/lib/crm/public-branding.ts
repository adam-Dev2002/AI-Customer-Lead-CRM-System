import { cache } from "react";
import { workspaceSnapshot } from "./server-snapshot";
import { workspaceAccess } from "../auth/server";
import { withWorkspace } from "./workspace-context";
import { businessLogo, defaultBusinessLogo } from "./business-logo";
import type { Metadata } from "next";

export async function workspaceBrandMetadata(): Promise<Metadata> {
  const brand = await publicBranding();
  return {
    title: `${brand.businessName} — Support & CRM`,
    description: "Customer inquiries, reply reviews, and follow-ups in one workspace.",
    icons: {
      icon: [{ url: brand.businessLogo || (brand.generic ? "/brand/customerlead.svg" : defaultBusinessLogo), type: brand.businessLogo ? "image/webp" : brand.generic ? "image/svg+xml" : "image/png" }],
    },
  };
}

// A shared login page cannot identify a business by an unverified email address.
export const publicBranding = cache(async () => {
  try {
    const access = await workspaceAccess();
    if (!access.user) return { businessName: "CustomerLead", businessLogo: "", generic: true };
    const data = await withWorkspace(access.user.workspaceId, workspaceSnapshot);
    return { businessName: data.settings.businessName, businessLogo: businessLogo(data.settings.businessLogo), generic: data.settings.brandPreset === "generic" };
  } catch { return { businessName: "CustomerLead", businessLogo: "", generic: true }; }
});
