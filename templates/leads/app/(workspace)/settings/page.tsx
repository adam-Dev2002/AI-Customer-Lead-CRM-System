import { SettingsPage } from "@/components/crm/settings-page";
import { workspaceAccess } from "@/lib/auth/server";
import { configuredInquiryForm } from "@/lib/crm/inquiry-form-config";
import { withWorkspace } from "@/lib/crm/workspace-context";

export default async function Settings() {
  const access = await workspaceAccess();
  const customerForm = access.user ? await withWorkspace(access.user.workspaceId, configuredInquiryForm) : null;
  return <SettingsPage canManageLogo={access.user?.role === "owner"} customerForm={customerForm} accountEmail={access.user?.email} />;
}
