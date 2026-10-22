import { redirect } from "next/navigation";
import { workspaceAccess } from "@/lib/auth/server";
import { CRMProvider } from "@/components/crm/provider";
import { CRMShell } from "@/components/crm/shell";
import { workspaceSnapshot } from "@/lib/crm/server-snapshot";
import { withWorkspace } from "@/lib/crm/workspace-context";

export const dynamic = "force-dynamic";
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const access = await workspaceAccess();
  if (access.status !== "authorized") redirect(`/login?reason=${access.status === "forbidden" ? "access" : access.status === "unavailable" ? "unavailable" : "signin"}`);
  // Only send records after workspace access is verified. The provider continues
  // refreshing in the background and retains its existing read-error recovery.
  const initialData = await withWorkspace(access.user.workspaceId, workspaceSnapshot).catch(() => null);
  return <CRMProvider initialData={initialData}><CRMShell signedInUser={access.user}>{children}</CRMShell></CRMProvider>;
}
