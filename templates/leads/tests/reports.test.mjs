import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import sharp from "sharp";
import { createSeed } from "../lib/crm/seed.ts";
import { leadReport, excelLocalDate } from "../lib/crm/report-model.ts";
import { reportChartSVG, reportHTML, emailStyles } from "../lib/crm/report-render.ts";
import { reportWorkbook } from "../lib/crm/report-files.ts";
import { queueReportDelivery, reportMime, reportCapability } from "../lib/crm/report-mail.ts";
import { claimMail, prepareMail, finishMail } from "../lib/crm/mail.ts";
import { prepareMailDraft } from "../../../scripts/n8n/mail-code.mjs";
import { applyMutation } from "../lib/crm/domain.ts";
import { defaultReportRecipient, resolveReportRecipient } from "../lib/crm/email-preferences.ts";

const now = "2026-10-20T00:30:00.000Z";
function fixture() {
  const data = createSeed(new Date(now));
  data.leads = data.leads.slice(0, 3).map((lead, index) => ({ ...lead, id: `report-lead-${index}`, isSample: false, createdAt: "2026-10-19T16:30:00.000Z", gmailThreadId: "PRIVATE_GMAIL_ID" }));
  data.mailJobs = []; data.syncChanges = []; data.drafts = [];
  data.mailSenderEmail = "sender@example.com"; data.settings.ownerEmail = "business@example.com";
  data.lastMailPollAt = now; data.mailSenderCapabilities = [reportCapability];
  data.connection = { lastEventAt: now, pendingChanges: 0, failedChanges: 0 };
  return data;
}
function meta(data) { const model = leadReport(data, data.leads.map(lead => lead.id), "Current view", new Date(now)); return { id: "a1111111-1111-4111-8111-111111111111", createdAt: now, label: model.label, businessName: model.businessName, count: model.summary.total, hasSamples: false, summary: model.summary, filename: "leads-report-2026-10-20" }; }
const sendInput = { id: "b1111111-1111-4111-8111-111111111111", confirmed: true, to: "business@example.com", senderEmail: "sender@example.com", digest: "digest" };

test("reports use exact selected records and business-local chart days", () => {
  const data = fixture(), selected = data.leads.slice(0, 1).map(lead => lead.id), model = leadReport(data, selected, "Filtered", new Date(now));
  assert.equal(model.summary.total, 1); assert.equal(model.leads.length, 1);
  assert.equal(model.trend.at(-1).day, "2026-10-20"); assert.equal(model.trend.at(-1).count, 1);
  assert.equal(model.statuses.reduce((total, item) => total + item.count, 0), 1);
  assert.equal(model.priority.reduce((total, item) => total + item.count, 0), 1);
  assert.throws(() => leadReport(data, ["removed"], "Filtered"), /changed or were removed/);
  assert.equal(leadReport(data, [], "Empty").summary.total, 0);
  assert.equal(excelLocalDate("2026-10-19T16:30:00Z", "Asia/Singapore").toISOString(), "2026-10-20T00:30:00.000Z");
});

test("rendered reports escape customer text and do not expose internal Gmail identifiers", () => {
  const data = fixture(); data.leads[0].name = '<script>alert("x")</script>'; data.leads[0].service = '<img src="https://external.test/">';
  const model = leadReport(data, [data.leads[0].id], "<unsafe>", new Date(now));
  const html = reportHTML(model, "cid:report-chart", "");
  assert(!html.includes("<script>")); assert(html.includes("&lt;script&gt;")); assert(!html.includes("PRIVATE_GMAIL_ID"));
  assert(!html.includes('<img src="https://external.test/">')); assert(reportChartSVG(model).includes("Lead status"));
});

test("Excel contains formatted full records, actual date cells, charts and safe text cells", async () => {
  const data = fixture(); data.leads[0].name = '=HYPERLINK("https://external.test")'; data.leads[0].phone = "+6300123456";
  const model = leadReport(data, data.leads.map(lead => lead.id), "Filtered", new Date(now));
  const chart = await sharp(Buffer.from(reportChartSVG(model))).png().toBuffer();
  const bytes = await reportWorkbook(model, chart), workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes);
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ["Summary", "Leads", "Chart data"]);
  const sheet = workbook.getWorksheet("Leads");
  assert.equal(sheet.getCell("A4").fill.fgColor.argb, "FF6E3FF3");
  assert.equal(sheet.views[0].state, "frozen"); assert.equal(sheet.views[0].ySplit, 4);
  assert.equal(sheet.getCell("B5").value, data.leads[0].name); assert.equal(sheet.getCell("B5").type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell("D5").value, "+6300123456");
  assert(sheet.getCell("K5").value instanceof Date); assert.equal(sheet.getCell("K5").numFmt, "dd mmm yyyy hh:mm");
  assert.equal(workbook.getWorksheet("Summary").getImages().length, 1);
});

test("long multiline inquiries remain complete, have readable row heights and linked continuation parts", async () => {
  const data = fixture();
  for (const lead of data.leads) { lead.summary = ""; lead.notes = ""; lead.message = "Short inquiry."; }
  data.leads[0].message = Array.from({ length: 65 }, (_, index) => `Line ${index + 1}: Please inspect the leaking tap. 水管 🚰`).join("\r\n") + "\nEND OF INQUIRY";
  data.leads[1].message = "Please inspect the kitchen tap and the water line. ".repeat(7);
  const model = leadReport(data, data.leads.map(lead => lead.id), "Long text", new Date(now));
  const chart = await sharp(Buffer.from(reportChartSVG(model))).png().toBuffer();
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await reportWorkbook(model, chart));
  const leads = workbook.getWorksheet("Leads"), details = workbook.getWorksheet("Message details");
  assert(details, "Tall messages need a readable continuation worksheet.");
  assert.equal(leads.getCell("Q5").value, data.leads[0].message.replace(/\r\n/g, "\n"));
  assert(leads.getRow(5).height > leads.getRow(6).height);
  assert(leads.getRow(6).height > leads.getRow(7).height);
  assert.match(leads.getCell("T5").value.hyperlink, /^#'Message details'!A5$/);
  const parts = [];
  for (let row = 5; row <= details.rowCount; row++) {
    if (details.getCell(row, 1).value === data.leads[0].id && details.getCell(row, 3).value === "Original inquiry") parts.push(details.getCell(row, 5).value);
    assert(details.getRow(row).height <= 409);
  }
  assert(parts.length > 1);
  assert.equal(parts.join(""), data.leads[0].message.replace(/\r\n/g, "\n"), "Continuation boundaries cannot lose line breaks or Unicode.");
  for (const sheet of [leads, details]) {
    sheet.getRow(4).eachCell(cell => { assert.equal(cell.fill.fgColor.argb, "FF6E3FF3"); assert.equal(cell.alignment.wrapText, true); });
    sheet.getRow(5).eachCell(cell => assert.equal(cell.alignment.wrapText, true));
    assert.equal(sheet.views[0].ySplit, 4);
  }
});

test("text beyond Excel's cell capacity is preserved in continuation parts instead of silently discarded", async () => {
  const data = fixture(); data.leads = data.leads.slice(0, 1); data.leads[0].notes = "Detailed notes 水管 🚰 and a long reference. ".repeat(1000);
  const model = leadReport(data, [data.leads[0].id], "Long notes", new Date(now));
  const chart = await sharp(Buffer.from(reportChartSVG(model))).png().toBuffer();
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await reportWorkbook(model, chart));
  const sheet = workbook.getWorksheet("Message details"), parts = [];
  for (let row = 5; row <= sheet.rowCount; row++) if (sheet.getCell(row, 3).value === "Internal notes") parts.push(sheet.getCell(row, 5).value);
  assert.equal(parts.join(""), data.leads[0].notes);
  assert(parts.every(part => part.length <= 32767));
  assert.match(workbook.getWorksheet("Leads").getCell("R5").value, /Full text continues/);
});

test("email tables wrap long values with inline styles and keep inquiry line breaks safely", () => {
  const data = fixture(); data.leads[0].summary = ""; data.leads[0].message = 'First line\nSecond line <script>alert("x")</script>';
  const model = leadReport(data, [data.leads[0].id], "Email", new Date(now));
  const html = emailStyles(reportHTML(model, "cid:report-chart", "", true)).replace(/<style>[\s\S]*?<\/style>/g, "");
  assert(html.includes("First line<br/>Second line &lt;script&gt;")); assert(!html.includes("<script>"));
  assert.match(html, /<th[^>]*style="[^"]*background:#6e3ff3[^\"]*overflow-wrap:anywhere/);
  assert.match(html, /<td[^>]*style="[^"]*word-break:break-word/);
  assert.match(html, /<table aria-label="Lead summary table"[^>]*style="[^"]*table-layout:fixed/);
  assert(html.includes("formatted Excel workbook (.xlsx)"));
});

test("report email requires confirmation, real records, registered support and a reviewed recipient choice", () => {
  const data = fixture(), report = meta(data);
  assert.throws(() => queueReportDelivery(data, report, { ...sendInput, confirmed: false }, now), /confirm/);
  assert.throws(() => queueReportDelivery(data, report, { ...sendInput, to: "stranger@example.com" }, now), /Choose a report recipient/);
  assert.throws(() => queueReportDelivery(data, { ...report, hasSamples: true }, sendInput, now), /Sample/);
  delete data.mailSenderCapabilities;
  assert.throws(() => queueReportDelivery(data, report, sendInput, now), /not available/);
  data.mailSenderCapabilities = [reportCapability];
  const before = JSON.stringify(data.leads); queueReportDelivery(data, report, sendInput, now);
  assert.equal(JSON.stringify(data.leads), before); assert.equal(data.mailJobs[0].kind, "lead-report");
  assert.throws(() => queueReportDelivery(data, report, sendInput, now), /already has/);
});

test("settings save and resolve report defaults without changing the sending Gmail account", () => {
  const data = fixture(), sender = data.mailSenderEmail;
  const save = payload => applyMutation(data, { action: "settings.update", payload: { ...data.settings, ...payload } }, now, () => "preference-activity");
  save({ reportEmailRecipient: "custom", reportEmailAddress: " Reports+Owner@Example.com " });
  assert.deepEqual(defaultReportRecipient(data.settings), { kind: "custom", address: "reports+owner@example.com" });
  assert.equal(resolveReportRecipient(data.settings, sender, defaultReportRecipient(data.settings)), "reports+owner@example.com");
  save({ reportEmailRecipient: "business", ownerEmail: "Updated@Example.com" });
  assert.equal(resolveReportRecipient(data.settings, sender, defaultReportRecipient(data.settings)), "updated@example.com");
  save({ reportEmailRecipient: "sender" });
  assert.equal(resolveReportRecipient(data.settings, sender, defaultReportRecipient(data.settings)), sender);
  assert.equal(data.mailSenderEmail, sender);
  assert.throws(() => save({ reportEmailRecipient: "custom", reportEmailAddress: "invalid" }), /valid custom report email/);
  assert.throws(() => save({ reportEmailRecipient: "business", ownerEmail: "" }), /Add an owner email/);
  assert.throws(() => save({ reportEmailRecipient: "unknown" }), /default report recipient/);
});

test("old settings retain the sending-account default and invalid inactive addresses are cleared", () => {
  const data = fixture(); delete data.settings.reportEmailRecipient; delete data.settings.reportEmailAddress;
  assert.deepEqual(defaultReportRecipient(data.settings), { kind: "sender", address: "" });
  applyMutation(data, { action: "settings.update", payload: { ...data.settings, reportEmailAddress: "unfinished" } }, now, () => "legacy-settings");
  assert.equal(data.settings.reportEmailRecipient, "sender");
  assert.equal(data.settings.reportEmailAddress, "");
});

test("custom report recipients require an explicit choice and keep their confirmed address through claim", () => {
  const data = fixture(), report = meta(data), original = structuredClone(data.leads);
  const job = queueReportDelivery(data, report, { ...sendInput, to: " Accountant+Reports@Example.com ", recipientKind: "custom" }, now);
  assert.equal(job.to, "accountant+reports@example.com");
  assert.equal(job.reportRecipientKind, "custom");
  assert.equal(data.settings.reportEmailRecipient, "sender", "A one-off address must not change the saved default.");
  data.settings.ownerEmail = "different@example.com";
  data.settings.reportEmailAddress = "another-default@example.com";
  const claim = claimMail(data, { executionId: "custom-report", senderEmail: data.mailSenderEmail, capabilities: [reportCapability] }, now);
  assert.equal(claim.job.to, "accountant+reports@example.com");
  assert.deepEqual(data.leads, original);
});

test("saving a report default is atomic with confirmation and cannot change business or sending addresses", () => {
  const data = fixture(), report = meta(data), before = structuredClone(data.settings);
  const input = { ...sendInput, to: "reports@example.com", recipientKind: "custom", saveAsDefault: true };
  assert.throws(() => queueReportDelivery(data, report, { ...input, confirmed: false }, now), /confirm/);
  assert.deepEqual(data.settings, before);
  queueReportDelivery(data, report, input, now);
  assert.equal(data.settings.reportEmailRecipient, "custom");
  assert.equal(data.settings.reportEmailAddress, "reports@example.com");
  assert.equal(data.settings.ownerEmail, before.ownerEmail);
  assert.equal(data.mailSenderEmail, "sender@example.com");
});

test("single-address validation rejects address lists and header injection before queueing", () => {
  for (const to of ["invalid", "first@example.com,second@example.com", "first@example.com;second@example.com", "first@example.com\r\nBcc: other@example.com", "Display Name <owner@example.com>", "a,b@example.com"]) {
    const data = fixture();
    assert.throws(() => queueReportDelivery(data, meta(data), { ...sendInput, to, recipientKind: "custom", saveAsDefault: true }, now), /valid report email/);
    assert.equal(data.mailJobs.length, 0);
    assert.equal(data.settings.reportEmailRecipient, "sender");
  }
});

test("business recipient changes and sending-account changes stop queued reports without redirecting them", () => {
  const data = fixture();
  queueReportDelivery(data, meta(data), { ...sendInput, recipientKind: "business" }, now);
  data.settings.ownerEmail = "changed@example.com";
  const claim = claimMail(data, { executionId: "changed-business", senderEmail: data.mailSenderEmail, capabilities: [reportCapability] }, now);
  assert.equal(claim.job, null);
  assert.equal(data.mailJobs[0].status, "Needs Review");
  assert.equal(data.mailJobs[0].to, "business@example.com");
  const custom = fixture();
  queueReportDelivery(custom, meta(custom), { ...sendInput, recipientKind: "custom", to: "reports@example.com" }, now);
  assert.equal(claimMail(custom, { executionId: "changed-sender", senderEmail: "other-sender@example.com", capabilities: [reportCapability] }, now).job, null);
  assert.equal(custom.mailJobs[0].status, "Needs Review");
});

test("report claims require capable sender and confirmed delivery never changes customer state", () => {
  const data = fixture(), report = meta(data); queueReportDelivery(data, report, sendInput, now);
  assert.equal(claimMail(data, { executionId: "old", senderEmail: "sender@example.com" }, now).job, null);
  const before = JSON.stringify(data.leads);
  const claim = claimMail(data, { executionId: "reports", senderEmail: "sender@example.com", capabilities: [reportCapability] }, now).job;
  assert.equal(claim.kind, "lead-report"); assert.equal(claimMail(data, { executionId: "reports", senderEmail: "sender@example.com", capabilities: [reportCapability] }, now).job, null);
  prepareMail(data, { jobId: claim.id, executionId: "reports", gmailDraftId: "simulated-draft" }, now);
  finishMail(data, { jobId: claim.id, executionId: "reports", status: "Sent", gmailMessageId: "simulated-message" }, now, () => "activity");
  assert.equal(data.mailJobs[0].status, "Sent"); assert.equal(JSON.stringify(data.leads), before); assert.equal(data.syncChanges.length, 0);
});

test("uncertain reports never re-enter the send queue", () => {
  const data = fixture(), report = meta(data); queueReportDelivery(data, report, sendInput, now);
  const job = claimMail(data, { executionId: "uncertain", senderEmail: "sender@example.com", capabilities: [reportCapability] }, now).job;
  finishMail(data, { jobId: job.id, executionId: "uncertain", status: "Needs Review" }, now, () => "activity");
  assert.equal(claimMail(data, { executionId: "retry", senderEmail: "sender@example.com", capabilities: [reportCapability] }, now).job, null);
});

test("MIME includes inline graph and both attachments; n8n preserves it and rejects changed recipients", () => {
  const raw = reportMime({ id: sendInput.id, from: sendInput.senderEmail, to: sendInput.to, subject: "Leads report", body: "Three leads", html: '<img src="cid:report-chart"><table><tr><td>Data</td></tr></table>', pdf: Buffer.from("PDF_BYTES"), xlsx: Buffer.from("XLSX_BYTES"), chart: Buffer.from("PNG_BYTES"), filename: "leads-report-2026-10-20", createdAt: now });
  const decoded = Buffer.from(raw, "base64url").toString("utf8");
  assert(decoded.includes('filename="leads-report-2026-10-20.pdf"')); assert(decoded.includes('filename="leads-report-2026-10-20.xlsx"')); assert(decoded.includes("Content-ID: <report-chart>"));
  assert(decoded.includes(Buffer.from("XLSX_BYTES").toString("base64"))); assert(decoded.split("\r\n").every(line => line.length <= 998));
  const job = { kind: "lead-report", to: sendInput.to, senderEmail: sendInput.senderEmail, reportRaw: raw };
  const run = record => new Function("$", "$json", "Buffer", prepareMailDraft)(name => ({ first: () => ({ json: name === "Claim approved reply" ? { job: record } : { emailAddress: sendInput.senderEmail } }) }), {}, Buffer);
  assert.equal(run(job).json.gmailBody.message.raw, raw);
  assert(run({ ...job, to: "stranger@example.com" }).json._mailError);
});

test("empty exports still have readable workbook headers and email colors survive stripped CSS", async () => {
  const model = leadReport(fixture(), [], "Empty", new Date(now));
  const chart = await sharp(Buffer.from(reportChartSVG(model))).png().toBuffer();
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await reportWorkbook(model, chart));
  assert.equal(workbook.getWorksheet("Leads").getCell("A4").value, "Lead ID");
  assert.equal(workbook.getWorksheet("Leads").getCell("A5").value, "No leads in this selection.");
  const html = emailStyles(reportHTML(model, "cid:report-chart", "", true)).replace(/<style>[\s\S]*?<\/style>/g, "");
  assert.match(html, /<th[^>]*style="[^"]*background:#6e3ff3/);
  assert(!html.includes("<script"));
});
