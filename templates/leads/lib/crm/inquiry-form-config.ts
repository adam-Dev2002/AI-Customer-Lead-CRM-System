import { inquiryFormLink } from "./inquiry-form.ts";
import { readPrivateFile } from "./private-files.ts";
import { currentWorkspaceId } from "./workspace-context.ts";
import { connectionConfig } from "../connections/config.ts";
import { connectionRepository } from "../connections/store.ts";

// Deployment configuration is separate from customer records and business preferences.
export async function configuredInquiryForm() {
  if ((!currentWorkspaceId() || currentWorkspaceId() === "clearflow") && process.env.CRM_CUSTOMER_FORM_URL?.trim()) return inquiryFormLink(process.env.CRM_CUSTOMER_FORM_URL);
  try {
    const config = JSON.parse((await readPrivateFile("config/customer-form.json")).toString("utf8"));
    return config.version === 1 ? inquiryFormLink(config.url) : null;
  } catch {
    try {
      const workspace = currentWorkspaceId(), config = connectionConfig();
      if (!workspace || workspace === "clearflow" || !config || config.mode === "pull") return null;
      const record = await connectionRepository(workspace, config).read();
      return record.data?.phase === "active" && record.data.formId ? inquiryFormLink(config.n8nOrigin + "/form/" + record.data.formId) : null;
    } catch { return null; }
  }
}
