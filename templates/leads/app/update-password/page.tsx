import { redirect } from "next/navigation";
import { workspaceAccess } from "@/lib/auth/server";
import { PasswordForm } from "@/components/auth/password-form";
import { publicBranding } from "@/lib/crm/public-branding";
export const dynamic = "force-dynamic";
export default async function UpdatePassword() {
  const access = await workspaceAccess();
  if (access.status !== "authorized") redirect("/login?reason=access");
  return <PasswordForm logo={(await publicBranding()).businessLogo} />;
}
