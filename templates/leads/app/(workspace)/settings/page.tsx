import { SettingsPage } from "@/components/crm/settings-page";
import { workspaceAccess } from "@/lib/auth/server";
import { configuredInquiryForm } from "@/lib/crm/inquiry-form-config";

export default async function Settings() {
  const [access, customerForm] = await Promise.all([workspaceAccess(), configuredInquiryForm()]);
  return <SettingsPage canManageLogo={access.user?.role === "owner"} customerForm={customerForm} />;
}
