"use client";
import { Link2 } from "lucide-react";
import { ActionIcon } from "./action-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { InquiryFormLink } from "@/lib/crm/inquiry-form";
import { useCRM } from "./provider";
import { Field, Panel } from "./shared";

export function InquiryFormSettings({ link }: { link: InquiryFormLink | null }) {
  const { notify } = useCRM();
  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      notify("Customer form link copied.");
    } catch { notify("Select the form link and copy it manually.", true); }
  }
  return (
    <section id="customer-form" className="scroll-mt-5">
      <Panel title="Customer inquiry form" icon={Link2} tone="blue">
        <div className="space-y-4 p-5">
          <p className="text-xs leading-6 text-muted-foreground">
            Add this link to your website&apos;s contact button, emails or another app so customers can send an inquiry.
          </p>
          {link ? <>
            <Field label="Customer form link">
              <Input value={link.url} readOnly onFocus={event => event.currentTarget.select()} className="text-xs" />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void copy()}><ActionIcon action="copy" />Copy link</Button>
              <Button type="button" variant="outline" asChild>
                <a href={link.url} target="_blank" rel="noopener noreferrer"><ActionIcon action="external" />Open form</a>
              </Button>
            </div>
            {link.access !== "public" && <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs leading-6 text-amber-800 dark:text-amber-300">
              {link.access === "local" ? "This link works only on this computer." : "This link is available only on your local network."} A public form address is needed for customers outside your network. Contact support to enable public sharing.
            </p>}
            <p className="text-xs leading-6 text-muted-foreground">Customers can enter their contact details, inquiry and follow-up permission. They do not need access to this dashboard.</p>
          </> : <p className="text-xs leading-6 text-muted-foreground">Your customer form link is not available yet. Contact support to connect your inquiry form.</p>}
        </div>
      </Panel>
    </section>
  );
}
