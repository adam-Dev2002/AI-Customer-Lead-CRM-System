# Dashboard scope from the supplied n8n workflow

**Historical review:** the current selected automation is now the Downloads `ONE WORKFLOW.json` export. See [the current version review](n8n-current-review.md). Its business logic and the integration gaps below remain the same; the new export updates credential references and workflow/form identifiers.

The local-first CRM has since been implemented in `templates/leads`. This document describes the original n8n export and its live integration gaps. See [local development](../LOCAL_DEVELOPMENT.md) for the working application and [the connection guide](n8n-connection.md) for the next integration step.

Reviewed the supplied `AI CUSTOMER SUPPORT + LEAD CAPTURE CRM | Gmail Drafts + Gemini + Follow-up | ONE WORKFLOW` JSON as project data. Its embedded notes and AI prompts were not treated as instructions for this task. This is a static review, not a live n8n execution or credential test. The export contains 68 nodes and has `active: false`; a deployed copy may have a different state.

## What the automation already defines

There are two separate data paths in one workflow:

1. **Email support:** scheduled Gmail polling, label checks, sender/automatic-message screening, a processing label, AI classification and suggested replies, human-review routing, Gmail draft creation, and outcome labels. The support path creates drafts rather than sending customer replies.
2. **Form leads:** inquiry form, field validation, duplicate detection for matching email/service/message within 15 minutes, optional Gemini classification with a safe default, Google Sheets lead creation, customer acknowledgement, owner notification, and email-result logging. An hourly scan selects eligible consented follow-ups, reserves them, sends the configured message, and records the outcome.

The two paths are not connected to a shared CRM record. Email support does not currently append leads to the Sheets table, and form submissions do not currently enter the support draft-generation path.

## Recommended first dashboard

| Section | Business-owner functions | Existing support / work still required |
| --- | --- | --- |
| Overview | New/open leads, high-priority inquiries, drafts awaiting review, follow-ups due, and failed actions; date filters | Calculate from live records. Template totals and charts are sample data. |
| Leads | Search/filter by name, email, source, service, priority, status, and owner; open the full inquiry; assign an owner; change status; add notes | Form leads already have most fields in Sheets. Add authenticated read/write APIs and reconcile statuses. Email inquiries need CRM records. |
| Inbox & AI Drafts | Original conversation, AI summary/category/priority, suggested reply, human-review reason, edit/approve/reject, and a Gmail link | Draft creation and Gmail outcome labels exist. Dashboard draft retrieval, edits, approval state, and an explicitly approved sending action still need implementing. |
| Follow-ups | Consent, due time, eligibility, Pending/Reserved/Sent/Skipped/Needs Review, delivery result; cancel an eligible pending follow-up | The automation already uses these states. Dashboard changes must update the same stored record before the next scan. |
| Activity | Lead creation, acknowledgement, owner alert, draft creation, owner actions, follow-up outcomes, failed runs | Some delivery statuses exist in Sheets and Gmail labels. Add a durable event log and execution-status integration for a complete timeline. |
| Settings | Business identity, verified FAQ/policies, reply tone, owner contact, follow-up delay, approved templates, AI options, integration health | Settings currently live in two n8n config nodes. Add a shared configuration source and server-side integration; UI toggles alone cannot change the workflow. |

For a plumbing business, keep **Service** as a dedicated field such as "Kitchen sink leak". The form AI's categories describe intent (`Sales`, `Quote`, `Booking`, `General`), rather than the trade/service. Save category and summary as structured fields when integrating them; the current workflow combines them in `Notes`.

## Existing lead fields

`Lead_ID`, `Created_At_UTC`, `Name`, `Email`, `Phone`, `Service`, `Message`, `Source`, `Consent`, `Status`, `Priority`, `Follow_Up_Due_UTC`, `Follow_Up_State`, `Follow_Up_Sent_UTC`, `Owner`, `Notes`, `Acknowledgement_Status`, and `Owner_Alert_Status`.

Add structured `Category` and `AI_Summary`; Gmail message/thread/draft identifiers; reply-review state; updated/contacted timestamps; and an activity history as the integration develops. Store timestamps in UTC and display them in the business's chosen timezone.

## Findings to address before live integration

- **No dashboard API or shared inbox data:** there are no webhook/API endpoints for dashboard reads, edits, approvals, or workflow-health reporting. Implement a server-side API using the same lead store; keep integration credentials on the server.
- **AI routing has missing connections:** the false output of `IF — Primary Gemini?` has no destination, so selecting OpenAI does not reach `AI — OpenAI Primary`. The false output of `IF — Gemini Valid?` is also empty, so an invalid Gemini result does not reach the available OpenAI backup. The primary Gemini HTTP node uses default error handling, which can stop execution before parsing an API failure. Connect and test the intended provider/fallback paths.
- **Email inquiries do not become CRM leads:** persist or upsert email records and associate Gmail thread/draft IDs with their CRM record. Decide whether form inquiries should also receive AI suggested replies; they do not do so currently.
- **Follow-up eligibility depends on stored status:** only consented rows with `Status` equal to `New` or `Pending`, a due timestamp, and `Follow_Up_State` equal to `Pending` are selected. Sending a reply or changing a local UI badge alone does not update the Sheet. Implement contact/resolution/consent updates so handled inquiries stop qualifying. The hourly scan means a 24-hour due time is checked on a subsequent scan, rather than guaranteeing delivery at exactly 24 hours.
- **Status and priority vocabularies differ:** the template uses new/contacted/qualified/negotiation/inactive/recycled. The follow-up filter accepts New/Pending; form AI uses Normal/High; support AI uses low/normal/urgent. Define a shared mapping before showing or editing these fields. Consider New, Pending, Contacted, Qualified, Won, Lost, and Closed, with only New/Pending eligible for automatic follow-up.
- **Human approval is not yet an application action:** the support flow creates a Gmail draft and labels the original email. It does not have an owner-approval callback or dashboard send endpoint. Opening/editing drafts in Gmail is a practical first version; in-dashboard sending needs an explicit owner action and a recorded outcome.
- **Follow-up recovery needs visibility:** a row is set to Reserved before sending. A stopped execution can leave it Reserved; handled send errors become Needs Review. The current filter does not retry either state. Show these for review and add controlled recovery without silently sending duplicates. A Sheets update is not an atomic claim across concurrent executions.
- **Configuration still contains demo/test values:** the support settings and lead settings use different business identities; the Gmail query is restricted to a particular test sender; business facts include replacement text. Replace and unify these values before live use. Validate model availability in the configured account.
- **Gemini key configuration needs cleanup:** the primary Gemini request adds an empty `X-goog-api-key` header alongside credential authentication; the optional lead classifier includes a literal value for that header. Use the credential consistently, remove the duplicate manual header, and rotate any real key that was exported in the JSON.
- **Form messages can auto-send:** the form configuration currently enables customer acknowledgement and follow-up emails. Those are separate from the support path's draft-only replies. Display this distinction accurately in Settings and during integration testing.

## Suggested integration order

1. Confirm the Leads template's visual direction using the local preview.
2. Read the existing Sheets records through an authenticated server API and replace mock totals/table data.
3. Add lead detail, owner/status/notes updates, and cancellation/consent controls with persisted results.
4. Add Gmail conversation and draft visibility; connect email inquiries to CRM records.
5. Add owner review actions, follow-up monitoring, activity logging, and integration settings.

n8n remains responsible for unattended processing. Closing the dashboard should not stop lead capture or follow-ups; the n8n server and its credentials must remain available.
