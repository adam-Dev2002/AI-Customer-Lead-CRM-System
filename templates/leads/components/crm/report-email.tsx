"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isEmailAddress } from "@/lib/crm/email-address";
import { defaultReportRecipient, resolveReportRecipient } from "@/lib/crm/email-preferences";
import { sendLeadReport, type ReportEmailConfirmation } from "@/lib/crm/report-client";
import type { ReportMeta } from "@/lib/crm/report-model";
import { ActionIcon } from "./action-icon";
import { MailDelivery } from "./mail-controls";
import { useCRM } from "./provider";
import { ReportRecipientField } from "./report-recipient-field";

type Props = {
  report: ReportMeta;
  senderEmail: string;
  isOwner: boolean;
  onBusyChange: (busy: boolean) => void;
};

export function ReportEmail({ report, senderEmail, isOwner, onBusyChange }: Props) {
  const { data, refresh } = useCRM();
  const checkboxId = useId();
  const [selection, setSelection] = useState(() => defaultReportRecipient(data.settings));
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [confirmation, setConfirmation] = useState<ReportEmailConfirmation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [jobId, setJobId] = useState("");

  const to = resolveReportRecipient(data.settings, senderEmail, selection);
  const job = data.mailJobs.find((item) => item.id === jobId);
  const emailReady =
    isOwner &&
    data.mailSenderCapabilities?.includes("lead-reports-v1") &&
    senderEmail === data.mailSenderEmail;
  const canSend = emailReady && isEmailAddress(to) && !report.hasSamples && report.count > 0;
  // Keep the final confirmation tied to the exact address and account reviewed.
  const reviewed =
    confirmation?.to === to &&
    confirmation.senderEmail === senderEmail &&
    confirmation.recipientKind === selection.kind &&
    confirmation.saveAsDefault === saveAsDefault;

  async function send() {
    if (!confirmation || !reviewed || !canSend || busy) return;
    setBusy(true);
    onBusyChange(true);
    setError("");
    try {
      const result = await sendLeadReport(report.id, confirmation);
      setJobId(result.jobId);
      setConfirmation(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not queue your report.");
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }

  return (
    <section className="space-y-4 rounded-xl border bg-muted/20 p-4">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <Mail className="size-4 text-primary" />
        Email this report
      </h3>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {job ? (
        <>
          <MailDelivery job={job} />
          <Link className="text-xs text-primary underline" href="/inbox">
            View outgoing emails in Inbox
          </Link>
        </>
      ) : (
        <>
          <p className="text-xs leading-6 text-muted-foreground">
            Send a summary, graphs and a table, with the PDF and Excel workbook attached. Choose an
            account below or enter another delivery address.
          </p>
          <p className="break-words text-xs text-muted-foreground">
            From:{" "}
            <strong className="break-all text-foreground">
              {senderEmail || "No sending account connected"}
            </strong>
          </p>
          <ReportRecipientField
            settings={data.settings}
            senderEmail={senderEmail}
            value={selection}
            onChange={(value) => {
              setSelection(value);
              setConfirmation(null);
              setError("");
            }}
            disabled={busy || !isOwner}
          />
          <label htmlFor={checkboxId} className="flex items-start gap-2 text-xs leading-5">
            <input
              id={checkboxId}
              type="checkbox"
              checked={saveAsDefault}
              onChange={(event) => {
                setSaveAsDefault(event.target.checked);
                setConfirmation(null);
              }}
              disabled={busy || !isOwner}
              className="mt-0.5 size-4 shrink-0 accent-primary"
            />
            Use this choice as the default for future reports
          </label>
          <p className="text-xs leading-6 text-muted-foreground">
            Business email uses Owner email in{" "}
            <Link href="/settings#report-email" className="text-primary underline">
              Settings
            </Link>
            . Your default is saved when you confirm the report email.
          </p>
          {!emailReady && (
            <p className="text-xs text-muted-foreground">
              {!isOwner
                ? "A workspace owner can email reports."
                : senderEmail !== data.mailSenderEmail
                  ? "The sending account changed. Prepare a new report to review it again."
                  : "Report emailing is being connected. You can download both files now."}
            </p>
          )}
          {report.hasSamples && (
            <p className="text-xs text-muted-foreground">
              Reports containing sample records can be downloaded. Select your own leads to email a
              report.
            </p>
          )}
          {reviewed && confirmation ? (
            <div className="space-y-3 rounded-lg border border-primary/20 bg-card p-3">
              <p className="break-words text-sm">
                Send {report.count} leads to{" "}
                <strong className="break-all">{confirmation.to}</strong> from{" "}
                <strong className="break-all">{confirmation.senderEmail}</strong>?
              </p>
              <p className="text-xs leading-6 text-muted-foreground">
                Includes customer contact details, inquiry text and internal notes in the Excel
                attachment.
                {saveAsDefault &&
                  " This delivery choice will also become your default for future reports."}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy || !canSend} onClick={() => void send()}>
                  <ActionIcon action={busy ? "loading" : "send"} />
                  {busy ? "Queueing report…" : "Confirm and queue report"}
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => setConfirmation(null)}>
                  <ActionIcon action="cancel" />
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              disabled={busy || !canSend}
              onClick={() =>
                setConfirmation({ to, senderEmail, recipientKind: selection.kind, saveAsDefault })
              }
            >
              <ActionIcon action="send" />
              Email summary &amp; attachments
            </Button>
          )}
        </>
      )}
    </section>
  );
}
