"use client";
import { ActionIcon } from "./action-icon";
import { useState } from "react";
import { Mail, Database, Building2, Sparkles, Zap } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Settings } from "@/lib/crm/types";
import { useCRM } from "./provider";
import {
  PageHeading,
  Panel,
  Field,
  NativeSelect,
  textareaClass,
  Confirm,
  useFormat,
  download,
} from "./shared";
import { AutomationSettings } from "./automation-settings";
import { LogoSettings } from "./logo-settings";
import { ReportRecipientField } from "./report-recipient-field";
import { defaultReportRecipient, readReportEmailPreferences } from "@/lib/crm/email-preferences";
import { normalizeEmail } from "@/lib/crm/email-address";
import { InquiryFormSettings } from "./inquiry-form-settings";
import type { InquiryFormLink } from "@/lib/crm/inquiry-form";
import { PublicLinks } from "@/components/public/public-links";

export function SettingsPage({ canManageLogo = false, customerForm = null, accountEmail = "" }: { canManageLogo?: boolean; customerForm?: InquiryFormLink | null; accountEmail?: string }) {
  const { data, run, busy } = useCRM(),
    format = useFormat();
  const [settings, setSettings] = useState<Settings>({ ...data.settings }),
    [clear, setClear] = useState(false);
  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((s) => ({ ...s, [key]: value }));
  }
  const dirty =
      JSON.stringify({ ...settings, businessLogo: undefined }) !==
      JSON.stringify({ ...data.settings, businessLogo: undefined }),
    samples = data.leads.filter((l) => l.isSample).length;
  return (
    <div className="space-y-6">
      <PageHeading
        title="Workspace settings"
        description="Make this workspace fit the way you run your business."
      />
      {accountEmail && <Panel title="Your account" icon={Mail} tone="blue"><div className="space-y-2 p-5 text-sm"><p className="break-all">Signed in as <strong>{accountEmail}</strong></p><p className="text-xs leading-6 text-muted-foreground">Your account opens this business workspace. Your business contact email below is a separate preference.</p>{data.settings.brandPreset === "generic" && !data.mailSenderEmail && <p role="status" className="text-sm leading-6">Your private workspace is ready. <Link className="text-primary underline underline-offset-4" href="/connections">Connect your business inbox</Link> to set up email processing.</p>}</div></Panel>}
      <LogoSettings canManage={canManageLogo} />
      <InquiryFormSettings link={customerForm} />
      <form
        className="space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run("settings.update", { ...settings }, "Your preferences were saved.")) {
            setSettings((current) => {
              const ownerEmail = normalizeEmail(current.ownerEmail);
              const preferences = readReportEmailPreferences({ ...current, ownerEmail }, current);
              return { ...current, ownerEmail, ...(preferences.ok ? preferences.value : {}) };
            });
          }
        }}
      >
        <Panel title="Business & owner" icon={Building2} tone="blue">
          <div className="grid gap-5 p-5 sm:grid-cols-2">
            <Field label="Business name">
              <Input
                value={settings.businessName}
                onChange={(e) => update("businessName", e.target.value)}
                required
                minLength={2}
                maxLength={100}
              />
            </Field>
            <Field label="Owner name">
              <Input
                value={settings.ownerName}
                onChange={(e) => update("ownerName", e.target.value)}
                required
                minLength={2}
                maxLength={100}
              />
            </Field>
            <Field
              label="Owner email"
              hint="Your business address for owner alerts and report delivery."
            >
              <Input
                type="email"
                value={settings.ownerEmail}
                onChange={(e) => update("ownerEmail", e.target.value)}
                maxLength={150}
                placeholder="you@yourbusiness.com"
              />
            </Field>
            <Field label="Contact phone">
              <Input
                value={settings.phone}
                onChange={(e) => update("phone", e.target.value)}
                maxLength={50}
              />
            </Field>
            <Field label="Website">
              <Input
                value={settings.website}
                onChange={(e) => update("website", e.target.value)}
                maxLength={250}
                placeholder="https://yourbusiness.com"
              />
            </Field>
            <Field label="Business timezone">
              <NativeSelect
                value={settings.timezone}
                onChange={(e) => update("timezone", e.target.value)}
              >
                {Array.from(
                  new Set([
                    settings.timezone,
                    "Asia/Singapore",
                    "Asia/Manila",
                    "Asia/Kuala_Lumpur",
                    "Asia/Bangkok",
                    "Asia/Kolkata",
                    "Australia/Sydney",
                    "Europe/London",
                    "America/New_York",
                    "America/Los_Angeles",
                    "UTC",
                  ]),
                ).map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </NativeSelect>
            </Field>
          </div>
        </Panel>
        <section id="report-email" className="scroll-mt-5">
          <Panel title="Report email preferences" icon={Mail} tone="blue">
            <div className="space-y-4 p-5">
              <p className="text-xs leading-6 text-muted-foreground">
                Choose where new reports are delivered by default. You can change the recipient when
                reviewing a report before sending.
              </p>
              <ReportRecipientField
                label="Default report recipient"
                settings={settings}
                senderEmail={data.mailSenderEmail}
                value={defaultReportRecipient(settings)}
                onChange={(value) =>
                  setSettings((current) => ({
                    ...current,
                    reportEmailRecipient: value.kind,
                    reportEmailAddress: value.address,
                  }))
                }
                disabled={busy}
              />
              <p className="text-xs text-muted-foreground">
                Business email uses Owner email above. Choose Save settings to keep your default.
              </p>
            </div>
          </Panel>
        </section>
        <Panel title="AI reply guidelines" icon={Sparkles}>
          <div className="space-y-5 p-5">
            <Field
              label="Verified business facts"
              hint="Add accurate opening hours, service areas, policies and contact details. The AI uses these facts when preparing replies."
            >
              <textarea
                value={settings.businessFacts}
                onChange={(e) => update("businessFacts", e.target.value)}
                className={`${textareaClass} min-h-36`}
                maxLength={10000}
              />
            </Field>
            <Field label="Reply tone & instructions">
              <textarea
                value={settings.replyTone}
                onChange={(e) => update("replyTone", e.target.value)}
                className={textareaClass}
                maxLength={1000}
              />
            </Field>
          </div>
        </Panel>
        <Panel title="Automatic actions" icon={Zap} tone="amber">
          <div className="p-5">
            <p className="mb-5 rounded-lg bg-muted/50 p-3 text-xs leading-6 text-muted-foreground">
              Choose what happens automatically. Suggested replies always need your review and
              confirmation before sending.
            </p>
            <Field
              label="Follow-up delay (hours)"
              className="mb-6 max-w-xs"
              hint="New inquiries use this delay. Existing follow-up times stay as scheduled."
            >
              <Input
                type="number"
                min={1}
                max={720}
                required
                value={settings.followUpHours}
                onChange={(e) => update("followUpHours", Number(e.target.value))}
              />
            </Field>
            <div className="divide-y">
              {[
                {
                  key: "customerAcknowledgements" as const,
                  title: "Customer acknowledgements",
                  detail: "Confirm that a form inquiry was received.",
                },
                {
                  key: "customerFollowUps" as const,
                  title: "One consented follow-up",
                  detail:
                    "Follow up only when the customer permitted it and the inquiry remains open.",
                },
                {
                  key: "aiClassification" as const,
                  title: "AI summaries & suggested replies",
                  detail:
                    "Use AI to identify what customers need and prepare replies for relevant emails. When switched off, you can write replies yourself.",
                },
                {
                  key: "ownerNotifications" as const,
                  title: "Owner notifications",
                  detail: "Notify the business owner about new customer inquiries.",
                },
              ].map((t) => (
                <label
                  key={t.key}
                  className="crm-preference -mx-2 flex cursor-pointer items-center justify-between gap-5 px-3 py-4"
                >
                  <span>
                    <span className="block text-sm font-medium">{t.title}</span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      {t.detail}
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    className="crm-switch shrink-0"
                    aria-label={t.title}
                    checked={settings[t.key]}
                    onChange={(e) => update(t.key, e.target.checked)}
                  />
                </label>
              ))}
            </div>
          </div>
        </Panel>
        <AutomationSettings settings={settings} update={update} />
        <div className="crm-panel flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-5 py-4 shadow-sm">
          <span
            className={`flex items-center gap-2 text-xs ${dirty ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}`}
          >
            <span
              className={`size-1.5 rounded-full ${dirty ? "bg-amber-500" : "bg-emerald-500"}`}
              aria-hidden="true"
            />
            {dirty ? "You have unsaved changes." : "Your preferences are saved."}
          </span>
          <Button type="submit" disabled={busy || !dirty}>
            <ActionIcon action={busy ? "loading" : "save"} />
            {busy ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </form>
      <div id="integrations" className="scroll-mt-5">
        <Panel title="Sending account" icon={Mail} tone="emerald">
          <div className="space-y-4 p-5">
            <div className="flex items-start gap-3">
              <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="break-all text-sm font-medium">
                  {data.connection.mailSenderEmail || "No sending account available"}
                </p>
                <p className="mt-2 text-xs leading-6 text-muted-foreground">
                  {data.connection.lastMailPollAt
                    ? "Last checked " +
                      format(data.connection.lastMailPollAt, true) +
                      ". Approved replies send from this account after you confirm them."
                    : "Contact support if you need help with email sending. You can still save and review replies."}
                </p>
              </div>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/automation#manual-email">
                <ActionIcon action="help" />
                Sending help & status
              </Link>
            </Button>
          </div>
        </Panel>
      </div>
      <Panel title="Your records" icon={Database} tone="blue">
        <div className="space-y-4 p-5">
          <div className="flex items-start gap-3">
            <Database className="mt-0.5 size-4 text-muted-foreground" />
            <p className="text-xs leading-6 text-muted-foreground">
              Records are saved on this computer and remain after you refresh or restart the
              dashboard.{" "}
              {samples > 0
                ? `${samples} sample inquiries are included to help you explore.`
                : "Your workspace contains your own records."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                download(
                  "customerlead-records.json",
                  JSON.stringify(
                    {
                      exportedAt: new Date().toISOString(),
                      leads: data.leads,
                      drafts: data.drafts,
                      tasks: data.tasks,
                      activities: data.activities,
                      settings: data.settings,
                    },
                    null,
                    2,
                  ),
                  "application/json",
                )
              }
            >
              <ActionIcon action="download" />
              Download backup
            </Button>
            {samples > 0 && (
              <Button variant="outline" className="text-destructive" onClick={() => setClear(true)}>
                <ActionIcon action="delete" />
                Remove sample data
              </Button>
            )}
          </div>
        </div>
      </Panel>
      <PublicLinks className="border-t pt-5" />
      <Confirm
        open={clear}
        onOpenChange={setClear}
        title="Remove the sample inquiries?"
        description="Sample leads and their associated drafts, tasks, and activity will be removed. Your own leads and settings will be kept."
        destructive
        label="Remove sample data"
        onConfirm={() =>
          run("samples.clear", {}, "Sample data removed. Your own records were kept.")
        }
      />
    </div>
  );
}
