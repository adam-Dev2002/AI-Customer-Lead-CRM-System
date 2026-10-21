import ExcelJS from "exceljs";
import {
  excelLocalDate,
  reportColumns,
  reportSummaryCards,
  type LeadReport,
} from "./report-model.ts";

const purple = "FF6E3FF3",
  ink = "FF182234",
  muted = "FF667085";
const lineHeight = 16,
  rowPadding = 12,
  maxLeadLines = 18,
  detailLines = 20;
const fill = (color: string): ExcelJS.Fill => ({
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: color },
});
const font: Partial<ExcelJS.Font> = { name: "Calibri", size: 11, color: { argb: ink } };

// Conservative Calibri-width estimates include explicit newlines, wide characters
// and long words. Keep the original characters when making continuation parts.
function characterWidth(char: string) {
  if (/\p{Mark}|\u200d|\ufe0f/u.test(char)) return 0;
  if (/[\u2e80-\u9fff\uac00-\ud7af\uff00-\uffef]|\p{Extended_Pictographic}/u.test(char)) return 2;
  if (/[ilI.,'`:;!| ]/.test(char)) return 0.55;
  if (/[MW@%#]/.test(char)) return 1.4;
  return 1;
}
function wrappedLines(value: string, width: number) {
  const capacity = Math.max(8, width - 4),
    result: string[] = [];
  let current: string[] = [],
    units = 0;
  const characters = Array.from(value);
  for (let index = 0; index < characters.length; index++) {
    const char = characters[index];
    if (char === "\n" || char === "\r") {
      const newline =
        char === "\r" && characters[index + 1] === "\n" ? char + characters[++index] : char;
      result.push(current.join("") + newline);
      current = [];
      units = 0;
      continue;
    }
    const size = char === "\t" ? 4 : characterWidth(char);
    if (current.length && units + size > capacity) {
      let split = -1;
      for (let index = current.length - 1; index >= 0; index--)
        if (/\s/u.test(current[index])) {
          split = index + 1;
          break;
        }
      if (split < 1) split = current.length;
      result.push(current.slice(0, split).join(""));
      current = current.slice(split);
      units = current.reduce((sum, item) => sum + characterWidth(item), 0);
    }
    current.push(char);
    units += size;
  }
  result.push(current.join(""));
  return result;
}
function rowHeight(values: { text: string; width: number }[], maxLines = maxLeadLines) {
  return (
    rowPadding +
    lineHeight *
      Math.max(
        2,
        Math.min(
          maxLines,
          Math.max(1, ...values.map((value) => wrappedLines(value.text, value.width).length)),
        ),
      )
  );
}
function textParts(value: string, width: number) {
  // Preserve text, paragraph breaks, whitespace and Unicode while splitting;
  // bound each piece by display height and Excel's per-cell character capacity.
  const parts: string[] = [];
  let current = "",
    lines = 0;
  for (const line of wrappedLines(value, width)) {
    if (current && (current.length + line.length > 30000 || lines >= detailLines)) {
      parts.push(current);
      current = "";
      lines = 0;
    }
    for (const char of line) {
      if (current.length + char.length > 30000) {
        parts.push(current);
        current = "";
        lines = 0;
      }
      current += char;
    }
    lines++;
  }
  if (current || !parts.length) parts.push(current);
  return parts;
}
function header(sheet: ExcelJS.Worksheet, row: number, count: number) {
  const record = sheet.getRow(row);
  record.height = 36;
  for (let col = 1; col <= count; col++) {
    const cell = record.getCell(col);
    cell.fill = fill(purple);
    cell.font = { ...font, bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: "FF5426C4" } } };
  }
}
function dataRow(
  sheet: ExcelJS.Worksheet,
  row: number,
  values: { text: string; width: number }[],
  stripe: number,
) {
  const record = sheet.getRow(row);
  record.height = rowHeight(values);
  for (let col = 1; col <= values.length; col++) {
    const cell = record.getCell(col);
    cell.font = { ...font };
    cell.fill = fill(stripe % 2 ? "FFF6F3FF" : "FFFFFFFF");
    cell.alignment = { vertical: "top", horizontal: "left", wrapText: true };
    cell.border = { bottom: { style: "hair", color: { argb: "FFE6E1F0" } } };
  }
}
function title(
  sheet: ExcelJS.Worksheet,
  columns: number,
  heading: string,
  subtitle: string,
  note: string,
) {
  for (const row of [1, 2, 3]) sheet.mergeCells(row, 1, row, columns);
  const head = sheet.getCell("A1");
  head.value = heading;
  head.fill = fill(purple);
  head.font = { ...font, size: 18, bold: true, color: { argb: "FFFFFFFF" } };
  head.alignment = { vertical: "middle", wrapText: true, indent: 1 };
  sheet.getRow(1).height = 38;
  sheet.getCell("A2").value = subtitle;
  sheet.getCell("A3").value = note;
  for (const row of [2, 3]) {
    sheet.getRow(row).height = row === 2 ? 30 : 32;
    sheet.getCell(row, 1).font = { ...font, size: 10, color: { argb: muted } };
    sheet.getCell(row, 1).alignment = { vertical: "middle", wrapText: true };
  }
}

export async function reportWorkbook(report: LeadReport, chart: Buffer) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = report.businessName;
  workbook.created = new Date(report.createdAt);
  const pageSetup: Partial<ExcelJS.PageSetup> = {
    paperSize: 9,
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
  };
  const summary = workbook.addWorksheet("Summary", {
    views: [{ showGridLines: false }],
    pageSetup,
  });
  summary.columns = Array.from({ length: 12 }, () => ({ width: 13 }));
  summary.properties.defaultRowHeight = 20;
  summary.mergeCells("A1:L2");
  summary.getCell("A1").value = `${report.businessName} — Leads report`;
  summary.getCell("A1").font = { ...font, size: 23, bold: true, color: { argb: "FFFFFFFF" } };
  summary.getCell("A1").fill = fill(purple);
  summary.getCell("A1").alignment = { vertical: "middle", wrapText: true, indent: 1 };
  summary.getRow(1).height = 26;
  summary.getRow(2).height = 26;
  summary.mergeCells("A3:L3");
  summary.getCell("A3").value = `${report.label} · ${report.generated} (${report.timezone})`;
  summary.getCell("A3").font = { ...font, size: 10, color: { argb: muted } };
  summary.getCell("A3").alignment = { vertical: "middle", wrapText: true };
  summary.getRow(3).height = 30;
  const cards = reportSummaryCards(report.summary);
  summary.getRow(5).height = 32;
  summary.getRow(6).height = 24;
  summary.getRow(7).height = 24;
  cards.forEach(({ label, value }, index) => {
    const column = index * 2 + 1;
    summary.mergeCells(5, column, 5, column + 1);
    summary.mergeCells(6, column, 7, column + 1);
    const head = summary.getCell(5, column),
      count = summary.getCell(6, column);
    head.value = label;
    count.value = value;
    head.font = { ...font, size: 10, color: { argb: muted } };
    count.font = { ...font, size: 24, bold: true, color: { argb: purple } };
    for (const cell of [head, count]) {
      cell.fill = fill("FFF4F0FF");
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    }
  });
  for (let row = 9; row <= 35; row++) summary.getRow(row).height = 15;
  const image = workbook.addImage({ buffer: chart as unknown as ExcelJS.Buffer, extension: "png" });
  summary.addImage(image, { tl: { col: 0, row: 8 }, ext: { width: 960, height: 530 } });
  let row = 39;
  for (const [label, items] of [
    ["Lead status", report.statuses],
    ["Priority", report.priority],
    ["Source", report.sources],
  ] as const) {
    summary.mergeCells(row, 1, row, 4);
    summary.mergeCells(row, 5, row, 6);
    summary.getCell(row, 1).value = label;
    summary.getCell(row, 5).value = "Count";
    header(summary, row++, 6);
    items.forEach((item, index) => {
      summary.mergeCells(row, 1, row, 4);
      summary.mergeCells(row, 5, row, 6);
      summary.getCell(row, 1).value = item.name;
      summary.getCell(row, 5).value = item.count;
      dataRow(
        summary,
        row,
        [
          { text: item.name, width: 52 },
          ...Array.from({ length: 5 }, () => ({ text: "", width: 13 })),
        ],
        index,
      );
      row++;
    });
    row += 2;
  }
  summary.mergeCells(`A${row}:L${row + 1}`);
  summary.getCell(row, 1).value =
    "Every figure uses this selected snapshot. Approval is not delivery. See Leads for complete records; dates use the business timezone.";
  summary.getCell(row, 1).font = { ...font, size: 10, color: { argb: muted } };
  summary.getCell(row, 1).alignment = { vertical: "middle", wrapText: true };
  summary.pageSetup.printArea = `A1:L${row + 1}`;

  const values = report.leads.map((lead) =>
    reportColumns.map((column) => {
      const value = lead[column.key];
      return column.date
        ? excelLocalDate(String(value || ""), report.timezone)
        : typeof value === "boolean"
          ? value
            ? "Yes"
            : "No"
          : String(value || "");
    }),
  );
  const details = values.flatMap((cells, index) =>
    cells.flatMap((value, col) =>
      typeof value === "string" &&
      (value.length > 32767 || wrappedLines(value, reportColumns[col].width).length > maxLeadLines)
        ? [{ lead: report.leads[index], column: reportColumns[col], value }]
        : [],
    ),
  );
  const detailLinks = new Map<string, number>();
  // Only add this worksheet when a field is taller than the readable main row.
  const sheet = workbook.addWorksheet("Leads", {
    views: [{ state: "frozen", xSplit: 2, ySplit: 4 }],
    pageSetup: { ...pageSetup, printTitlesRow: "1:4" },
  });
  const trend = workbook.addWorksheet("Chart data", {
    views: [{ state: "frozen", ySplit: 1 }],
    pageSetup: { ...pageSetup, printTitlesRow: "1:1" },
  });
  const detailSheet = details.length
    ? workbook.addWorksheet("Message details", {
        views: [{ state: "frozen", xSplit: 2, ySplit: 4 }],
        pageSetup: { ...pageSetup, printTitlesRow: "1:4" },
      })
    : null;
  const columns = [
    ...reportColumns.map((column) => ({ name: column.name, width: column.width })),
    ...(details.length ? [{ name: "Full text", width: 23 }] : []),
  ];
  sheet.columns = columns.map((column) => ({ width: column.width }));
  title(
    sheet,
    columns.length,
    report.businessName + " — Complete lead records",
    `${report.leads.length} leads · ${report.label} · Dates: ${report.timezone} · Snapshot: ${report.generated}`,
    details.length
      ? "Text is wrapped and rows are sized to fit. For very long fields, use the Full text link to read every part in Message details."
      : "Text is wrapped and rows are sized to fit. Headers stay visible while scrolling; use their filter arrows to find records.",
  );
  if (detailSheet) {
    detailSheet.columns = [
      { width: 30 },
      { width: 24 },
      { width: 23 },
      { width: 12 },
      { width: 110 },
    ];
    title(
      detailSheet,
      5,
      report.businessName + " — Full message details",
      `${report.label} · Snapshot: ${report.generated} · ${report.timezone}`,
      "Long fields continue in numbered parts. All text, paragraph breaks and whitespace are retained; no text is omitted between parts.",
    );
    detailSheet.getRow(4).values = [
      "Lead ID",
      "Customer",
      "Field",
      "Part",
      "Full text (continued)",
    ];
    header(detailSheet, 4, 5);
    for (const [index, item] of details.entries()) {
      if (!detailLinks.has(item.lead.id)) detailLinks.set(item.lead.id, detailSheet.rowCount + 1);
      const parts = textParts(item.value, 110);
      parts.forEach((part, partIndex) => {
        const added = detailSheet.addRow([
          item.lead.id,
          item.lead.name,
          item.column.name,
          `${partIndex + 1} / ${parts.length}`,
          part,
        ]);
        dataRow(
          detailSheet,
          added.number,
          [
            item.lead.id,
            item.lead.name,
            item.column.name,
            `${partIndex + 1} / ${parts.length}`,
            part,
          ].map((text, col) => ({ text, width: detailSheet.getColumn(col + 1).width! })),
          index,
        );
        added.height = rowHeight(
          [
            item.lead.id,
            item.lead.name,
            item.column.name,
            `${partIndex + 1} / ${parts.length}`,
            part,
          ].map((text, col) => ({ text, width: detailSheet.getColumn(col + 1).width! })),
          detailLines,
        );
        added.eachCell((cell) => {
          cell.numFmt = "@";
        });
      });
    }
    detailSheet.autoFilter = { from: "A4", to: `E${detailSheet.rowCount}` };
    detailSheet.pageSetup.printArea = `A1:E${detailSheet.rowCount}`;
  }
  const rows: ExcelJS.CellValue[][] = values.map((cells, index) => [
    ...cells.map((value) =>
      typeof value === "string" && value.length > 32767
        ? value.slice(0, 32680) + "\n[Full text continues in Message details]"
        : value,
    ),
    ...(details.length
      ? [
          detailLinks.has(report.leads[index].id)
            ? {
                text: "Read full text",
                hyperlink: `#'Message details'!A${detailLinks.get(report.leads[index].id)}`,
                tooltip: "Open all continuation parts for this lead",
              }
            : "Included in this row",
        ]
      : []),
  ]);
  if (rows.length)
    sheet.addTable({
      name: "LeadRecords",
      ref: "A4",
      headerRow: true,
      totalsRow: false,
      style: { theme: "TableStyleLight1", showRowStripes: false },
      columns: columns.map((column) => ({ name: column.name, filterButton: true })),
      rows,
    });
  else {
    sheet.getRow(4).values = columns.map((column) => column.name);
    sheet.getCell("A5").value = "No leads in this selection.";
    dataRow(
      sheet,
      5,
      columns.map((column, index) => ({
        text: index ? "" : "No leads in this selection.",
        width: column.width,
      })),
      0,
    );
  }
  header(sheet, 4, columns.length);
  values.forEach((cells, index) => {
    const row = index + 5,
      record = sheet.getRow(row),
      lead = report.leads[index];
    dataRow(
      sheet,
      row,
      columns.map((column, col) => ({
        text: cells[col] instanceof Date ? "20 Oct 2026 12:00" : String(cells[col] || ""),
        width: column.width,
      })),
      index,
    );
    reportColumns.forEach((column, col) => {
      record.getCell(col + 1).numFmt = column.date ? "dd mmm yyyy hh:mm" : "@";
    });
    if (detailLinks.has(lead.id))
      record.getCell(columns.length).font = { ...font, color: { argb: purple }, underline: true };
    for (const [col, color] of [
      [6, report.statuses.find((item) => item.name === lead.status)?.color],
      [7, report.priority.find((item) => item.name === lead.priority)?.color],
    ] as const)
      if (color)
        record.getCell(col).font = {
          ...font,
          bold: true,
          color: { argb: "FF" + color.slice(1).toUpperCase() },
        };
  });
  sheet.pageSetup.printArea = `A1:${sheet.getColumn(columns.length).letter}${Math.max(5, sheet.rowCount)}`;

  trend.columns = [{ width: 29 }, { width: 23 }];
  trend.addRow(["Date (business timezone)", "Selected inquiries"]);
  header(trend, 1, 2);
  report.trend.forEach((day, index) => {
    const record = trend.addRow([day.day, day.count]);
    dataRow(
      trend,
      record.number,
      [
        { text: day.day, width: 29 },
        { text: String(day.count), width: 23 },
      ],
      index,
    );
    record.getCell(1).numFmt = "@";
    record.getCell(2).numFmt = "0";
  });
  trend.autoFilter = "A1:B31";
  trend.pageSetup.printArea = "A1:B31";
  workbook.calcProperties.fullCalcOnLoad = false;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
