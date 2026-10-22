import { cache } from "react";
import { workspaceSnapshot } from "./server-snapshot";
import { workspaceAccess } from "../auth/server";
import { withWorkspace } from "./workspace-context";
import { businessLogo } from "./business-logo";

// A shared login page cannot identify a business by an unverified email address.
export const publicBranding = cache(async () => {
  try {
    const access = await workspaceAccess();
    if (!access.user) return { businessName: "CustomerLead", businessLogo: "", generic: true };
    const data = await withWorkspace(access.user.workspaceId, workspaceSnapshot);
    return { businessName: data.settings.businessName, businessLogo: businessLogo(data.settings.businessLogo), generic: data.settings.brandPreset === "generic" };
  } catch { return { businessName: "CustomerLead", businessLogo: "", generic: true }; }
});
