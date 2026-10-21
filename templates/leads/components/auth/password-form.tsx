"use client";
import { useState, type FormEvent } from "react";
import { BrandLogo } from "@/components/crm/brand-logo";
import { ActionIcon } from "@/components/crm/action-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export function PasswordForm({ logo }: { logo?: string }) {
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    if (form.get("password") !== form.get("confirm")) { setError("Your passwords do not match."); return; }
    setError(""); setBusy(true);
    try {
      const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "password", password: form.get("password") }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      window.location.assign("/");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update your password."); }
    finally { setBusy(false); }
  }
  return <main className="flex min-h-svh items-center justify-center bg-sidebar p-5"><section className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-lg"><BrandLogo logo={logo} /><h1 className="mt-6 text-2xl font-semibold">Choose your password</h1><p className="mt-2 text-sm text-muted-foreground">Use at least 10 characters for your workspace account.</p><form onSubmit={submit} className="mt-6 space-y-5"><div className="space-y-2"><label htmlFor="password">New password</label><Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={128} /></div><div className="space-y-2"><label htmlFor="confirm">Confirm password</label><Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={10} maxLength={128} /></div>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button className="w-full" disabled={busy}><ActionIcon action={busy ? "loading" : "save"} />{busy ? "Saving…" : "Save password & open workspace"}</Button></form></section></main>;
}
