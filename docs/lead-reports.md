# Lead reports and email summaries

On **Dashboard** or **Leads**, choose **Report & email**. The report uses the
current filtered view. On Leads you can select rows and choose **Report selected**
to report only those records. Creating a report does not send an email.

The preview is a fixed snapshot. It includes total leads, open inquiries, open
high/urgent inquiries, drafts waiting for review, eligible follow-ups due and
Gmail-confirmed customer reply counts. The charts show selected inquiries over
the last 30 business-local days, plus status and priority. Older selected records
remain in the totals and tables even when outside that chart's 30-day window.

- **Download dashboard PDF**: branded summary cards, colored charts and a
  paginated lead table with repeated headers.
- **Download Excel workbook**: a real `.xlsx` workbook with Summary, Leads and
  Chart data sheets. It includes a graph image, colored headers, striped/filterable
  records, frozen header/customer columns, typed dates, preserved phone numbers,
  summaries, full inquiry text, internal notes and follow-up information. Workbook
  dates use the business timezone shown at the top. Text is stored as text, not
  executable spreadsheet formulas.
- Long messages, notes and other fields wrap within their columns. Row heights
  adapt to content, with consistent top alignment, colored headers and alternating
  row colors. Very long fields also have a **Read full text** link to a
  **Message details** sheet, split into numbered, readable continuation parts.
  The main sheet keeps the original field value within Excel's cell capacity;
  the continuation sheet preserves the entire text, including text beyond that
  capacity. Excel normalizes Windows line endings while retaining paragraph breaks.
- Existing CSV export remains available for importing into other systems.

In **Settings → Report email preferences**, choose a default destination:
**Connected sending account**, **Business email**, or **Another email address**.
Business email is the **Owner email** in Settings. Enter a custom address when
using Another email address, then choose **Save settings**.

New report previews start with that saved default. Owners can override it for
one report, review the exact address with **Email summary & attachments**, then
choose **Confirm and queue report**. To keep the new choice, check **Use this
choice as the default for future reports**; it is saved together with the confirmed
email request. Selecting an address or cancelling the confirmation sends nothing
and does not save a new default. Only one delivery address is accepted.

These choices change where reports are delivered. The connected Gmail account
still sends them; business and custom delivery addresses do not reconnect Gmail
or change the account that receives customer inquiries.

The message includes a summary, an inline graph and a condensed table of the
newest 20 records, plus both PDF and Excel attachments containing all selected
records. The email's compact table includes an inquiry excerpt and uses inline
colored headers, alternating row colors and wrapping for long names, email
addresses and references. Its summary uses two rows of three cards for a cleaner
mobile layout. The Excel attachment includes customer details and internal notes;
review the recipient before confirming. Samples and empty reports can be
downloaded, but cannot be emailed. Members can export; only owners can request
report emails.

Track delivery in the preview or **Inbox → Outgoing emails**. Queued waits for
the sender's regular minute poll. Only a confirmed Gmail result shows Sent.
Cancel while queued if needed. An uncertain result stays on hold for review in
Gmail and never retries automatically. Emailing a report does not contact the
selected leads, change their statuses, or cancel their follow-ups.

## Maintainer details

Protected report endpoints are `POST /api/crm/reports`, authenticated PDF/Excel
downloads at `/api/crm/reports/:id?format=pdf|xlsx`, and owner-confirmed emailing
at `POST /api/crm/reports/:id/email`. Input IDs select canonical saved records;
the browser cannot supply replacement lead values. All generated HTML is escaped,
charts render locally, and PDF generation does not load remote resources.

Files/snapshot metadata are retained privately in `.data/reports/:id`. Report
mail MIME is saved there with a digest referenced by the durable mail job. Keep
this folder in private deployment backups. It is never a public/static download
directory, and reports are excluded from production build traces. An exported
snapshot retains its contents even if a lead is later edited or removed.

PDF rendering uses `playwright-core` and installed Chrome on this Windows
computer. A hosted runtime needs Chromium and can set
`CRM_REPORT_BROWSER_EXECUTABLE` to its executable. Excel uses ExcelJS. Reports
are limited to 5,000 selected records and 10 MB for the two attachments together;
use narrower filters for large datasets. Report creation is serialized per process
and limited to six per user per minute; hosted replicas need shared limits.

The existing consolidated Gmail workflow is extended, rather than replaced:
`scripts/setup-report-sender.mjs` reviews its live saved/published graph;
`--apply` backs it up, adds only multipart report support and capability
registration to the existing two sender nodes, publishes that version and reloads
the engine while idle. Existing nodes, schedules, bindings, workflow identity and
other workflows are preserved. Do not import or activate extra sender workflows.
The live update has already been applied for this workspace.

The sender advertises `lead-reports-v1` in its regular authenticated claim poll.
Older senders skip report jobs, so they cannot accidentally strip attachments.
Queueing rechecks the recipient and sending account inside the storage transaction;
claiming rechecks them again. A changed business/sending address puts a queued
report on hold. A custom destination stays exactly as confirmed, even if a future
default changes. Input rejects multiple recipients and email header injection.
The sender validates the MIME envelope before Gmail
draft creation and preserves its PDF, Excel and inline image parts. Existing
prepared-draft recording and uncertain-delivery safeguards apply. Report jobs
never perform lead/review sync, never infer a customer reply, and do not affect
customer follow-up eligibility.

Tests: `templates/leads/tests/reports.test.mjs` and
`scripts/check-lead-reports.mjs` cover totals, timezone boundaries, workbook
formatting/text safety, MIME attachments, authorization, recipient changes,
default persistence in Settings/report previews, custom destinations, confirmation
invalidation, duplicate/uncertain deliveries and isolated desktop/mobile flows. Browser tests
simulate Gmail callbacks; no live email was sent to validate this feature.
