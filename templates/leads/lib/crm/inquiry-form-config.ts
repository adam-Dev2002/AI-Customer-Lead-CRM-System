import { inquiryFormLink } from "./inquiry-form";
import { readPrivateFile } from "./private-files.ts";

// Deployment configuration is separate from customer records and business preferences.
export async function configuredInquiryForm() {
  if (process.env.CRM_CUSTOMER_FORM_URL?.trim()) return inquiryFormLink(process.env.CRM_CUSTOMER_FORM_URL);
  try {
    const config = JSON.parse((await readPrivateFile("config/customer-form.json")).toString("utf8"));
    return config.version === 1 ? inquiryFormLink(config.url) : null;
  } catch { return null; }
}
