import { cache } from "react";
import { workspaceSnapshot } from "./server-snapshot";
import { businessLogo } from "./business-logo";

// Only public visual identity crosses the sign-in boundary; never return CRM records.
export const publicBranding = cache(async () => {
  try {
    const data = await workspaceSnapshot();
    return { businessName: data.settings.businessName, businessLogo: businessLogo(data.settings.businessLogo) };
  } catch { return { businessName: "ClearFlow Plumbing", businessLogo: "" }; }
});
