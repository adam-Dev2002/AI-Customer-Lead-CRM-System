import { reportSummaryCards, type LeadReport } from "./report-model.ts";
export const escapeHTML = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );
// Inline styles survive email apps that discard stylesheet blocks.
export function emailStyles(html: string) {
  const wrap =
    "white-space:normal;word-wrap:break-word;overflow-wrap:anywhere;word-break:break-word;";
  const styles: Record<string, string> = {
    body: "margin:0;padding:16px;color:#182234;font:13px Arial,sans-serif;line-height:1.6;",
    table: "width:100%;border-collapse:collapse;table-layout:fixed;",
    th:
      "background:#6e3ff3;color:#ffffff;text-align:left;padding:9px;font-size:11px;vertical-align:top;" +
      wrap,
    td:
      "border-bottom:1px solid #e5e7eb;padding:9px;vertical-align:top;font-size:11px;line-height:1.6;" +
      wrap,
    img: "max-width:100%;height:auto;display:block;",
  };
  for (const [tag, style] of Object.entries(styles))
    html = html.replace(new RegExp(`<${tag}\\b([^>]*)>`, "g"), (_, attributes: string) => {
      const current = attributes.match(/style="([^"]*)"/)?.[1] || "";
      return `<${tag}${attributes.replace(/\sstyle="[^"]*"/, "")} style="${style}${current}">`;
    });
  return html;
}
export function reportChartSVG(report: LeadReport) {
  const { statuses, priority, trend } = report;
  const max = Math.max(4, Math.ceil(Math.max(0, ...trend.map((day) => day.count)) / 4) * 4);
  const points = trend
    .map((day, index) => `${62 + index * 28.2},${194 - (day.count / max) * 112}`)
    .join(" ");
  const bars = (
    items: { name: string; count: number; color: string }[],
    x: number,
    y: number,
    width: number,
  ) =>
    items
      .map(
        (item, index) =>
          /* HTML */ `<text x="${x}" y="${y + index * 29}" font-size="12" fill="#4b5563"
              >${escapeHTML(item.name)}</text
            ><rect
              x="${x + 83}"
              y="${y - 12 + index * 29}"
              width="${width}"
              height="15"
              rx="4"
              fill="#f1effa"
            /><rect
              x="${x + 83}"
              y="${y - 12 + index * 29}"
              width="${(item.count / Math.max(1, report.summary.total)) * width}"
              height="15"
              rx="4"
              fill="${item.color}"
            /><text x="${x + 92 + width}" y="${y + index * 29}" font-size="12" fill="#334155"
              >${item.count}</text
            >`,
      )
      .join("");
  return /* HTML */ `<svg
    xmlns="http://www.w3.org/2000/svg"
    width="960"
    height="530"
    viewBox="0 0 960 530"
  >
    <rect width="960" height="530" rx="16" fill="white" />
    <g font-family="Arial,sans-serif">
      <text x="28" y="32" fill="#182234" font-size="17" font-weight="700">Inquiry growth</text>
      <text x="28" y="53" fill="#667085" font-size="11">
        Last 30 days · selected records · ${escapeHTML(report.timezone)}
      </text>
      ${[0, 1, 2, 3, 4]
        .map(
          (i) =>
            /* HTML */ `<line
                x1="62"
                y1="${194 - i * 28}"
                x2="900"
                y2="${194 - i * 28}"
                stroke="#e8eaf0"
              /><text x="30" y="${198 - i * 28}" font-size="10" fill="#667085"
                >${Math.round((max * i) / 4)}</text
              >`,
        )
        .join("")}
      <polygon points="62,194 ${points} 880,194" fill="#6e3ff3" fill-opacity=".08" />
      <polyline points="${points}" fill="none" stroke="#6e3ff3" stroke-width="3" />
      ${[0, 7, 14, 21, 29]
        .map(
          (i) =>
            /* HTML */ `<text
              x="${62 + i * 28.2}"
              y="217"
              text-anchor="middle"
              font-size="10"
              fill="#667085"
              >${escapeHTML(trend[i].label)}</text
            >`,
        )
        .join("")}
      <line x1="28" y1="240" x2="930" y2="240" stroke="#e8eaf0" />
      <text x="28" y="274" font-size="17" fill="#182234" font-weight="700">Lead status</text>
      <text x="515" y="274" font-size="17" fill="#182234" font-weight="700">Priority</text>
      ${bars(statuses, 28, 307, 275)}${bars(priority, 515, 307, 250)}
      <text x="515" y="455" font-size="11" fill="#667085">
        Counts use the same saved report snapshot.
      </text>
      <text x="515" y="475" font-size="11" fill="#667085">
        Approving a reply does not mean it was sent.
      </text>
    </g>
  </svg>`;
}
export function reportHTML(report: LeadReport, chart: string, logo: string, email = false) {
  if (email) return reportEmailHTML(report, chart);
  const e = escapeHTML;
  const cards = reportSummaryCards(report.summary);
  const rows = report.leads
    .map(
      (lead) =>
        /* HTML */ `<tr>
          <td><strong>${e(lead.name)}</strong><br /><span class="muted">${e(lead.email)}</span></td>
          <td>${e(lead.service)}</td>
          <td>${e(lead.status)}</td>
          <td>
            <span
              style="color:${lead.priority === "Urgent"
                ? "#be2349"
                : lead.priority === "High"
                  ? "#9b5800"
                  : "#375dfb"}"
              >${e(lead.priority)}</span
            >
          </td>
          <td>${e(lead.owner || "Unassigned")}</td>
          <td>${e(report.date(lead.createdAt))}</td>
        </tr>`,
    )
    .join("");
  return /* HTML */ `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Leads report</title>
        <style>
          @page {
            size: A4 landscape;
            margin: 13mm;
          }
          * {
            box-sizing: border-box;
          }
          body {
            margin: 0;
            color: #182234;
            background: #fff;
            font:
              12px Arial,
              sans-serif;
            line-height: 1.5;
          }
          .header {
            display: flex;
            align-items: center;
            gap: 15px;
            border-bottom: 3px solid #6e3ff3;
            padding-bottom: 18px;
            margin-bottom: 18px;
          }
          .header img {
            width: 54px;
            height: 54px;
            object-fit: contain;
          }
          h1 {
            font-size: 25px;
            margin: 0;
          }
          h2 {
            font-size: 17px;
            margin: 20px 0 10px;
          }
          .muted {
            color: #667085;
            font-size: 10px;
          }
          .cards {
            display: table;
            width: 100%;
            border-spacing: 8px 0;
            margin: 16px -8px;
          }
          .card {
            display: table-cell;
            width: 16.6%;
            padding: 12px;
            background: #f5f2ff;
            border: 1px solid #e9e2fc;
            border-radius: 9px;
          }
          .card strong {
            font-size: 25px;
            color: #6e3ff3;
            display: block;
          }
          .card span {
            font-size: 10px;
            color: #576078;
          }
          .chart {
            width: 100%;
            max-height: 410px;
            object-fit: contain;
            display: block;
            margin: 18px 0 10px;
          }
          .table-heading {
            break-before: page;
          }
          table {
            border-collapse: collapse;
            width: 100%;
            table-layout: fixed;
          }
          thead {
            display: table-header-group;
          }
          th {
            background: #6e3ff3;
            color: white;
            font-size: 10px;
            text-align: left;
            padding: 9px;
          }
          td {
            border-bottom: 1px solid #e5e7eb;
            padding: 9px;
            font-size: 10px;
            vertical-align: top;
            overflow-wrap: anywhere;
          }
          tr:nth-child(even)td {
            background: #f7f5ff;
          }
          tr {
            break-inside: avoid;
          }
          .note {
            margin-top: 14px;
            color: #667085;
            font-size: 10px;
          }
          img {
            max-width: 100%;
          }
        </style>
      </head>
      <body>
        <div class="header">
          ${logo ? `<img src="${e(logo)}"/>` : ""}
          <div>
            <h1>${e(report.businessName)}</h1>
            <div>Leads summary &amp; performance report</div>
            <div class="muted">
              ${e(report.label)} · ${report.leads.length} leads · Generated ${e(report.generated)}
              (${e(report.timezone)})
            </div>
          </div>
        </div>
        <div class="cards">
          ${cards
            .map(
              ({ label: title, value: count }) =>
                /* HTML */ `<div class="card"><span>${title}</span><strong>${count}</strong></div>`,
            )
            .join("")}
        </div>
        <img class="chart" src="${e(chart)}" alt="Inquiry growth, status and priority charts" />
        <p class="note">
          This is a saved snapshot of the selected leads. Follow-ups due use current eligibility.
          Sent counts require Gmail-confirmed results.
          ${report.leads.some((lead) => lead.isSample)
            ? "Includes clearly marked sample records."
            : ""}
        </p>
        <h2 class="table-heading">Lead table</h2>
        <table>
          <thead>
            <tr>
              <th style="width:22%">Customer / email</th>
              <th style="width:28%">Service / subject</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Owner</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="6">No leads in this selection.</td></tr>'}
          </tbody>
        </table>
        <p class="note">
          The Excel workbook includes every selected lead with full contact details, inquiry text,
          summaries, notes and follow-up fields. Dates use ${e(report.timezone)}.
        </p>
      </body>
    </html>`;
}

function reportEmailHTML(report: LeadReport, chart: string) {
  const e = escapeHTML;
  const multiline = (value: string) => e(value).replace(/\r\n|\r|\n/g, "<br/>");
  const cards = reportSummaryCards(report.summary);
  const cardRows = [cards.slice(0, 3), cards.slice(3)]
    .map(
      (items) =>
        /* HTML */ `<tr>
          ${items
            .map(
              ({ label, value: count }) =>
                /* HTML */ `<td
                  style="width:33.33%;background:#f5f2ff;border:4px solid #ffffff;padding:12px;vertical-align:top;"
                >
                  <span style="display:block;font-size:11px;color:#576078;">${label}</span
                  ><strong style="display:block;font-size:24px;line-height:1.4;color:#6e3ff3;"
                    >${count}</strong
                  >
                </td>`,
            )
            .join("")}
        </tr>`,
    )
    .join("");
  const rows = report.leads
    .slice(0, 20)
    .map((lead, index) => {
      const text = lead.summary || lead.message,
        characters = Array.from(text),
        excerpt = characters.slice(0, 200).join("") + (characters.length > 200 ? "…" : "");
      const cellStyle = `background:${index % 2 ? "#f7f5ff" : "#ffffff"};`;
      return /* HTML */ `<tr>
        <td style="${cellStyle}font-size:12px;">
          <strong>${e(lead.name)}</strong><br /><span style="color:#667085;font-size:11px;"
            >${e(lead.email)}</span
          >
          <p style="margin:8px 0 0;color:#667085;font-size:11px;">
            ${e(report.date(lead.createdAt))}
          </p>
        </td>
        <td style="${cellStyle}font-size:12px;">
          <strong>${e(lead.service)}</strong>
          <p style="margin:5px 0 0;font-size:11px;">
            ${e(lead.status)} ·
            <span
              style="font-weight:bold;color:${lead.priority === "Urgent"
                ? "#be2349"
                : lead.priority === "High"
                  ? "#9b5800"
                  : "#375dfb"};"
              >${e(lead.priority)} priority</span
            >
          </p>
          <p style="margin:7px 0 0;color:#667085;font-size:12px;line-height:1.6;">
            ${multiline(excerpt)}
          </p>
          <p style="margin:8px 0 0;color:#667085;font-size:11px;">
            Owner: ${e(lead.owner || "Unassigned")}
          </p>
        </td>
      </tr>`;
    })
    .join("");
  return /* HTML */ `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>Leads report</title>
      </head>
      <body style="background:#f5f4f9;">
        <table
          role="presentation"
          style="max-width:840px;margin:0 auto;background:#ffffff;border:1px solid #e7e2f2;"
        >
          <tr>
            <td style="padding:22px;border:0;border-top:4px solid #6e3ff3;">
              <h1
                style="margin:0;font:700 24px Arial,sans-serif;line-height:1.4;color:#182234;word-break:break-word;overflow-wrap:anywhere;"
              >
                ${e(report.businessName)}
              </h1>
              <p style="margin:6px 0;color:#576078;font-size:13px;">
                Leads summary &amp; performance report
              </p>
              <p style="margin:4px 0 0;color:#667085;font-size:11px;">
                ${e(report.label)} · ${report.leads.length} leads<br />Generated
                ${e(report.generated)} (${e(report.timezone)})
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 18px 14px;border:0;">
              <table role="presentation" style="border-spacing:0;">
                ${cardRows}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 20px 18px;border:0;">
              <img
                src="${e(chart)}"
                width="800"
                alt="Inquiry growth, status and priority charts"
                style="width:100%;height:auto;"
              />
            </td>
          </tr>
          <tr>
            <td style="padding:0 20px 20px;border:0;">
              <h2 style="margin:0 0 10px;font:700 17px Arial,sans-serif;color:#182234;">
                Lead table
              </h2>
              <table aria-label="Lead summary table" style="table-layout:fixed;">
                <thead>
                  <tr>
                    <th scope="col" bgcolor="#6e3ff3" style="width:35%;">Customer / received</th>
                    <th scope="col" bgcolor="#6e3ff3" style="width:65%;">Inquiry / status</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows || '<tr><td colspan="2">No leads in this selection.</td></tr>'}
                </tbody>
              </table>
              <p style="margin:14px 0 0;font-size:11px;line-height:1.7;color:#667085;">
                ${report.leads.length > 20
                  ? `Showing the newest 20 of ${report.leads.length} leads. `
                  : ""}Inquiry
                text is condensed here. The attached Excel workbook includes every selected lead
                with full contact details, inquiry text and internal notes. Very long text has a
                linked Message details sheet with numbered parts. Dates use ${e(report.timezone)}.
              </p>
              <p style="margin:8px 0 0;font-size:11px;line-height:1.7;color:#667085;">
                Attached: dashboard report (PDF) and formatted Excel workbook (.xlsx). Counts use
                this saved snapshot; approval alone does not mean an email was sent.
              </p>
            </td>
          </tr>
        </table>
      </body>
    </html>`;
}
