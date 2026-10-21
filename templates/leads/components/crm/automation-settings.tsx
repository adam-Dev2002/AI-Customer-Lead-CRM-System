"use client";
import type { Settings } from "@/lib/crm/types";
import { Input } from "@/components/ui/input";
import { Field, Panel, textareaClass } from "./shared";
import { MessageSquareText } from "lucide-react";

export function AutomationSettings({ settings, update }: {
  settings: Settings;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}) {
  return <Panel title="Reply & email preferences" icon={MessageSquareText} tone="emerald">
    <div className="space-y-5 p-5">
      <p className="text-xs leading-6 text-muted-foreground">Choose how your business communicates with customers. You can review every suggested reply before sending it.</p>
      <Field label="Response expectation" hint="Use a response time your business can keep, such as within one business day."><Input value={settings.responsePromise} maxLength={250} onChange={e => update("responsePromise", e.target.value)} /></Field>
      <Field label="Reply signature"><textarea className={textareaClass} value={settings.replySignature} maxLength={1000} placeholder={settings.businessName} onChange={e => update("replySignature", e.target.value)} /></Field>
      <label className="crm-preference flex cursor-pointer items-center justify-between gap-5 rounded-lg border p-4"><span><span className="block text-sm font-medium">Automatic confirmations & follow-ups</span><span className="mt-1 block text-xs leading-6 text-muted-foreground">Allow inquiry confirmations, owner alerts and agreed follow-ups according to your preferences above. Suggested replies still need your review and send confirmation.</span></span><input className="crm-switch shrink-0" type="checkbox" role="switch" aria-label="Automatic confirmations & follow-ups" checked={settings.automaticEmailsEnabled} onChange={e => update("automaticEmailsEnabled", e.target.checked)} /></label>
    </div>
  </Panel>;
}
