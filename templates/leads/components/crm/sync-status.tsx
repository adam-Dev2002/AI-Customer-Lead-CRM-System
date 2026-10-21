"use client";
import Link from "next/link";
import { useCRM } from "./provider";

export function SyncStatus({ leadId }: { leadId: string }) {
  const { data } = useCRM();
  const changes = data.syncChanges.filter(c => c.leadId === leadId);
  const failed = changes.filter(c => c.status === "Failed").length;
  const pending = changes.filter(c => c.status === "Pending").length;
  if (!changes.length) return null;
  return <Link href="/automation#sync" className={`block rounded-lg border p-3 text-xs leading-6 ${failed ? "text-destructive" : "text-muted-foreground"}`}>
    {failed ? `${failed} update${failed === 1 ? "" : "s"} need${failed === 1 ? "s" : ""} attention. Review saved changes in How it works.` : pending ? `${pending} saved change${pending === 1 ? " is" : "s are"} still updating.` : "The saved changes for this inquiry are up to date."}
  </Link>;
}
