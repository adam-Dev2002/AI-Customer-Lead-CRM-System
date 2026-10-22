import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import { launchReportBrowser } from "./report-browser.ts";
import type { CRMSnapshot } from "./types.ts";
import { leadReport, type ReportMeta } from "./report-model.ts";
import { reportChartSVG, reportHTML, emailStyles } from "./report-render.ts";
import { businessLogo } from "./business-logo.ts";
import { reportWorkbook } from "./report-workbook.ts";
import { readPrivateFile, writePrivateFile, removePrivateFiles, privateFileKey } from "./private-files.ts";
export { reportWorkbook } from "./report-workbook.ts";

function reportPath(id: string, filename: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid report ID.");
  return privateFileKey(`reports/${id}/${filename}`);
}

export async function createReportFiles(data: CRMSnapshot, ids: unknown, label: string) {
  const report = leadReport(data, ids, label), id = randomUUID();
  const chart = await sharp(Buffer.from(reportChartSVG(report))).png().toBuffer();
  let logo = businessLogo(report.logo);
  if (!logo && data.settings.brandPreset !== "generic") { try { logo = "data:image/png;base64," + (await readFile(path.join(process.cwd(), "public/brand/clearflow-plumbing.png"))).toString("base64"); } catch {} }
  const chartUrl = "data:image/png;base64," + chart.toString("base64");
  const html = reportHTML(report, chartUrl, logo);
  const browser = await launchReportBrowser();
  let pdf: Buffer;
  try { const page = await browser.newPage(); await page.route("**/*", route => route.abort()); await page.setContent(html, { waitUntil: "load", timeout: 15000 }); pdf = await page.pdf({ format: "A4", landscape: true, printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: "<div></div>", footerTemplate: '<div style="font:8px Arial;color:#667085;width:100%;text-align:right;padding-right:13mm"><span class="pageNumber"></span> / <span class="totalPages"></span></div>' }); } finally { await browser.close(); }
  const xlsx = await reportWorkbook(report, chart);
  if (pdf.length + xlsx.length > 10_000_000) throw new Error("This report is too large. Choose fewer leads.");
  const meta: ReportMeta = { id, createdAt: report.createdAt, timezone: report.timezone, label: report.label, businessName: report.businessName, count: report.leads.length, hasSamples: report.leads.some(lead => lead.isSample), summary: report.summary, filename: `leads-report-${report.trend[29].day}` };
  const files = { "report.pdf": pdf, "report.xlsx": xlsx, "chart.png": chart, "email.html": emailStyles(reportHTML(report, "cid:report-chart", "", true)), "report.json": JSON.stringify(meta) };
  const writes = await Promise.allSettled(Object.entries(files).map(([name, body]) => writePrivateFile(reportPath(id, name), body)));
  if (writes.some(result => result.status === "rejected")) { await removePrivateFiles(Object.keys(files).map(name => reportPath(id, name))); throw new Error("The report could not be saved."); }
  return { ...meta, chart: chartUrl };
}
export async function readReport(id: string) { return JSON.parse((await readPrivateFile(reportPath(id, "report.json"))).toString("utf8")) as ReportMeta; }
export const readReportFile = (id: string, format: "pdf" | "xlsx" | "png" | "html") => readPrivateFile(reportPath(id, format === "png" ? "chart.png" : format === "html" ? "email.html" : `report.${format}`));
export async function readReportMime(id: string, digest?: string) {
  if (digest && /^[a-f0-9]{64}$/.test(digest)) {
    try { return (await readPrivateFile(reportPath(id, `mail-${digest}.mime`))).toString("utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return (await readPrivateFile(reportPath(id, "mail.mime"))).toString("utf8");
}
export async function saveReportMime(id: string, raw: string) {
  // Content-addressed attachments cannot be overwritten by a competing transaction.
  const digest = createHash("sha256").update(raw).digest("hex");
  await writePrivateFile(reportPath(id, `mail-${digest}.mime`), raw);
}
