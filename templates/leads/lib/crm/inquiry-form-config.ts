import { inquiryFormLink } from "./inquiry-form.ts";
import { readPrivateFile } from "./private-files.ts";
import { currentWorkspaceId } from "./workspace-context.ts";

// Deployment configuration is separate from customer records and business preferences.
export async function configuredInquiryForm() {
  if ((!currentWorkspaceId() || currentWorkspaceId() === "clearflow") && process.env.CRM_CUSTOMER_FORM_URL?.trim()) return inquiryFormLink(process.env.CRM_CUSTOMER_FORM_URL);
  try {
    const config = JSON.parse((await readPrivateFile("config/customer-form.json")).toString("utf8"));
    return config.version === 1 ? inquiryFormLink(config.url) : null;
  } catch { return null; }
}
