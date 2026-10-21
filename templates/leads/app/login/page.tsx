import { redirect } from "next/navigation";
import { workspaceAccess } from "@/lib/auth/server";
import { safeReturnPath } from "@/lib/auth/config";
import { LoginForm } from "@/components/auth/login-form";
import { publicBranding } from "@/lib/crm/public-branding";

export const dynamic = "force-dynamic";
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query = await searchParams;
  const access = await workspaceAccess();
  if (access.status === "authorized") redirect(safeReturnPath(query.next));
  return <LoginForm configured={access.status !== "unconfigured"} next={safeReturnPath(query.next)} reason={query.reason} brand={await publicBranding()} />;
}
