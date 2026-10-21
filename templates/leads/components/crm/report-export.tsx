"use client";

import { useState, type ReactNode } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import type { Lead } from "@/lib/crm/types";
import { prepareLeadReport } from "@/lib/crm/report-client";
import { reportSummaryCards, type PreparedReport } from "@/lib/crm/report-model";
import { ActionIcon } from "./action-icon";
import { ReportEmail } from "./report-email";
import { Modal } from "./shared";
import { useCRM } from "./provider";

type Props = { leads: Lead[]; label?: string; children?: ReactNode };

export function ReportExport({ leads, label = "Current lead view", children }: Props) {
  const { refresh } = useCRM();
  const [open, setOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [sending, setSending] = useState(false);
  const [prepared, setPrepared] = useState<PreparedReport | null>(null);
  const [error, setError] = useState("");

  async function prepare() {
    setOpen(true);
    setPreparing(true);
    setError("");
    setPrepared(null);
    try {
      const result = await prepareLeadReport(leads.map((lead) => lead.id), label);
      await refresh();
      setPrepared(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create your report.");
    } finally {
      setPreparing(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => void prepare()}>
        <ActionIcon action="report" />
        {children || "Report & email"}
      </Button>
      <Modal
        open={open}
        onOpenChange={(value) => {
          if (!preparing && !sending) setOpen(value);
        }}
        title="Export your leads"
        description="A dashboard report and a ready-to-use Excel workbook from the same saved snapshot."
        wide
      >
        <div className="space-y-5">
          {preparing && (
            <p role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <ActionIcon action="loading" />
              Preparing charts and your Excel workbook…
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          {prepared && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  {prepared.report.label} · {prepared.report.count}{" "}
                  {prepared.report.count === 1 ? "lead" : "leads"}
                </span>
                <span>
                  Snapshot:{" "}
                  {new Date(prepared.report.createdAt).toLocaleString(undefined, {
                    timeZone: prepared.report.timezone,
                  })}{" "}
                  ({prepared.report.timezone})
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {reportSummaryCards(prepared.report.summary).map((card) => (
                  <div
                    key={card.label}
                    className="rounded-lg border border-primary/10 bg-primary/5 p-3"
                  >
                    <p className="text-[11px] text-muted-foreground">{card.label}</p>
                    <p className="mt-1 text-xl font-semibold text-primary">{card.value}</p>
                  </div>
                ))}
              </div>
              <Image
                src={prepared.report.chart}
                alt="Lead growth, status and priority report charts"
                width={960}
                height={530}
                unoptimized
                className="h-auto w-full rounded-lg border bg-white"
              />
              <div className="flex flex-wrap gap-2">
                {[
                  { format: "pdf", label: "Download dashboard PDF" },
                  { format: "xlsx", label: "Download Excel workbook" },
                ].map((file) => (
                  <Button
                    key={file.format}
                    asChild
                    variant={file.format === "pdf" ? "default" : "outline"}
                  >
                    <a href={`/api/crm/reports/${prepared.report.id}?format=${file.format}`}>
                      <ActionIcon action="download" />
                      {file.label}
                    </a>
                  </Button>
                ))}
              </div>
              <p className="text-xs leading-6 text-muted-foreground">
                The PDF includes summary cards, graphs and a lead table. Excel is ready to open with
                colored headers, wrapped text, adjusted row heights and filters. Very long messages
                have a Read full text link to numbered parts in Message details. Both files keep
                this snapshot after records change.
              </p>
              <ReportEmail
                key={prepared.report.id}
                report={prepared.report}
                senderEmail={prepared.senderEmail}
                isOwner={prepared.isOwner}
                onBusyChange={setSending}
              />
            </>
          )}
          {!preparing && !prepared && (
            <Button variant="outline" onClick={() => void prepare()}>
              <ActionIcon action="retry" />
              Try again
            </Button>
          )}
        </div>
      </Modal>
    </>
  );
}
