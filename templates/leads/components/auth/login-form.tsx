"use client";
import { useState, type FormEvent } from "react";
import { Check, Inbox, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import { BrandLogo } from "@/components/crm/brand-logo";
import { ActionIcon } from "@/components/crm/action-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/theme-toggle";

export function LoginForm({ configured, next, reason, brand }: { configured: boolean; next: string; reason?: string; brand: { businessName: string; businessLogo: string; generic?: boolean } }) {
  const [mode, setMode] = useState<"login" | "signup" | "reset">("login"), [visible, setVisible] = useState(false), [busy, setBusy] = useState(false);
  const reset = mode === "reset", signup = mode === "signup";
  const [error, setError] = useState(reason === "access" ? "Confirm your email before opening your workspace. Contact support if you still need help." : reason === "link" ? "This link has expired or was already used. Sign in if you have confirmed your email, or request a new password reset link." : reason === "unavailable" ? "Workspace access could not be checked. Please try again shortly." : "");
  const [message, setMessage] = useState(reason === "confirmed" ? "Your email is confirmed. Sign in to open your business workspace." : "");
  function changeMode(value: "login" | "signup" | "reset") { setMode(value); setVisible(false); setError(""); setMessage(""); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage(""); setBusy(true);
    const formElement = event.currentTarget, form = new FormData(formElement);
    try {
      if (signup && form.get("password") !== form.get("confirmPassword")) throw new Error("Your passwords do not match.");
      const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: mode, businessName: form.get("businessName"), email: form.get("email"), password: form.get("password"), confirmPassword: form.get("confirmPassword"), next }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not sign in. Please try again.");
      if (reset || signup) { setMessage(result.message); if (signup) formElement.reset(); }
      else window.location.assign(result.next || "/");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not sign in."); }
    finally { setBusy(false); }
  }
  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-hidden bg-sidebar p-5 sm:p-10">
      <div className="pointer-events-none absolute -left-32 -top-40 size-[36rem] rounded-full bg-primary/10 blur-3xl" />
      <div className="absolute right-5 top-5"><ThemeToggle /></div>
      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-2xl border bg-card shadow-xl shadow-primary/5 md:grid-cols-[1fr_1.05fr]">
        <section className="relative hidden flex-col justify-between overflow-hidden border-r bg-gradient-to-br from-primary/10 via-card to-blue-500/10 p-10 md:flex">
          <div className="flex items-center gap-3"><BrandLogo logo={brand.businessLogo} generic={brand.generic} /><div><p className="text-sm font-semibold">{brand.businessName}</p><p className="text-xs text-muted-foreground">Support & leads</p></div></div>
          <div className="py-16"><span className="mb-6 inline-flex size-12 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10 text-primary"><Inbox className="size-6" /></span><h2 className="max-w-xs text-3xl font-semibold leading-tight tracking-tight">A clearer view of every customer conversation.</h2><p className="mt-4 max-w-xs text-sm leading-6 text-muted-foreground">Your inquiries, thoughtful replies and next steps, together in one workspace.</p>
            <div className="mt-8 space-y-3 text-sm">{["Keep up with new inquiries", "Review replies before sending", "Ask your workspace assistant"].map(text => <p key={text} className="flex items-center gap-2.5"><span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-primary"><Check className="size-3" /></span>{text}</p>)}</div>
          </div><p className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-4" /> A private space for your team.</p>
        </section>
        <section className="px-6 py-10 sm:px-12 sm:py-14">
          <div className="mb-9 flex items-center gap-3 md:hidden"><BrandLogo logo={brand.businessLogo} generic={brand.generic} /><span className="text-sm font-semibold">{brand.businessName}</span></div>
          <span className="mb-5 inline-flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><LockKeyhole className="size-5" /></span>
          <h1 className="text-2xl font-semibold tracking-tight">{reset ? "Reset your password" : signup ? "Create your account" : "Welcome back"}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{reset ? "We’ll email you a link to choose a new password." : signup ? "Start a private workspace for your business. Confirm your email before signing in." : "Sign in to open your customer workspace."}</p>
          {!configured && <p role="status" className="mt-6 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-sm leading-6">Sign-in is being set up. Please contact your workspace administrator.</p>}
          <form onSubmit={submit} className="mt-7 space-y-5">
            {signup && <div className="space-y-2"><label htmlFor="businessName" className="text-sm font-medium">Business name</label><Input id="businessName" name="businessName" autoComplete="organization" placeholder="Your business" required minLength={2} maxLength={100} disabled={busy || !configured} className="h-11" /></div>}
            <div className="space-y-2"><label htmlFor="email" className="text-sm font-medium">Email address</label><Input id="email" name="email" type="email" autoComplete="username" placeholder="you@yourbusiness.com" required maxLength={254} disabled={busy || !configured} className="h-11" /></div>
            {!reset && <div className="space-y-2"><label htmlFor="password" className="text-sm font-medium">Password</label><div className="relative"><Input id="password" name="password" type={visible ? "text" : "password"} autoComplete={signup ? "new-password" : "current-password"} required minLength={signup ? 10 : undefined} maxLength={128} disabled={busy || !configured} className="h-11 pr-11" /><button type="button" disabled={busy || !configured} aria-label={visible ? "Hide password" : "Show password"} aria-pressed={visible} onClick={() => setVisible(!visible)} className="absolute inset-y-0 right-0 rounded-r-md px-3 text-muted-foreground hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"><ActionIcon action={visible ? "hide" : "view"} /></button></div>{signup && <p className="text-xs text-muted-foreground">Use 10 to 128 characters.</p>}</div>}
            {signup && <div className="space-y-2"><label htmlFor="confirmPassword" className="text-sm font-medium">Confirm password</label><Input id="confirmPassword" name="confirmPassword" type={visible ? "text" : "password"} autoComplete="new-password" required minLength={10} maxLength={128} disabled={busy || !configured} className="h-11" /></div>}
            {error && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
            {message && <p role="status" className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm">{message}</p>}
            <Button type="submit" disabled={busy || !configured} className="h-11 w-full gap-2"><ActionIcon action={busy ? "loading" : reset || signup ? "send" : "signIn"} />{busy ? (reset ? "Requesting link…" : signup ? "Creating account…" : "Signing in…") : (reset ? "Send reset link" : signup ? "Create account" : "Sign in")}</Button>
          </form>
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
            <button type="button" disabled={busy} onClick={() => changeMode(reset || signup ? "login" : "reset")} className="inline-flex items-center gap-2 text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"><ActionIcon action={reset || signup ? "back" : "reset"} />{reset || signup ? "Back to sign in" : "Forgot your password?"}</button>
            {!reset && !signup && <button type="button" disabled={busy} onClick={() => changeMode("signup")} className="text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">Create an account</button>}
          </div>
          <p className="mt-10 border-t pt-5 text-xs leading-5 text-muted-foreground">Each business has its own private workspace. Email delivery and automation need to be connected for that business before use.</p>
          <p className="mt-4 flex items-center gap-1.5 text-[11px] text-muted-foreground"><Sparkles className="size-3" /> Your assistant is available after sign-in.</p>
        </section>
      </div>
    </main>
  );
}
