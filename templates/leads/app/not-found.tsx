import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState, Panel } from "@/components/crm/shared";

export default function NotFound() {
  return <Panel><EmptyState title="Page not found" description="This page isn't part of your workspace. Use the sidebar to find your inquiries and tasks." action={<Button asChild><Link href="/">Back to dashboard</Link></Button>} /></Panel>;
}
