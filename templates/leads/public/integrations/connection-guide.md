# Connect CustomerLead to your Docker n8n

The current selected automation is the **19 October 2026 Downloads export** named `AI CUSTOMER SUPPORT + LEAD CAPTURE CRM _ Gmail Drafts + Gemini + Follow-up _ ONE WORKFLOW.json`. It supersedes the older `(1).json` file. See [the current version review](n8n-current-review.md) for the exact checksum and comparison. Existing adapter attachment points below match this current file.

CustomerLead is the owner interface for the existing **AI customer support + lead inquiry** automation. n8n runs in Docker on this Windows computer. The CRM runs at http://localhost:3001; the container reaches it at **http://host.docker.internal:3001**. This address was checked from the running `n8n` container on 19 October 2026. Docker documents this host name in its [container-to-host networking guide](https://docs.docker.com/desktop/features/networking/networking-how-tos/#i-want-to-connect-from-a-container-to-a-service-on-the-host).

The local receiver uses a private token in `templates/leads/.env.local`. The current live setup has three published workflows: the original capture/support automation, the Sheets/review bridge, and the owner-confirmed Gmail sender. The original 68-node reference export remains unchanged; its inactive flag describes that file, not the live setup. The live wiring and Sheet headers were repaired on 19 October 2026, with private backups and existing credential bindings preserved.

Use [the complete project, setup and operations PDF](../templates/leads/public/integrations/customerlead-project-guide.pdf) for the current setup and verification record. `scripts/repair-n8n.ps1` previews the bounded live repair; `-Apply` backs up and applies it. Gmail inquiry capture now queues the lead and available reply for automatic Sheet indexing. The bridge records Applied only after the external operation succeeds. Initial indexing does not edit the Gmail draft or send mail.

## 1. Add the CRM credential in n8n

From the project root in PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\configure-n8n.ps1 -CopyToken
```

This creates a token only if one is missing, and copies the full Authorization value to your clipboard without printing it. It preserves the existing token on subsequent runs. If needed, restart the CRM with `scripts/start-local.ps1 -Template leads` after creating the environment file.

In n8n create an **HTTP Header Auth** credential named **CustomerLead**:

| Field | Value |
| --- | --- |
| Name | `Authorization` |
| Value | Paste the copied `Bearer ...` value |

Select this credential on the kit's CRM HTTP Request nodes. Store Gemini, OpenAI, Gmail, and Sheets credentials in n8n as well; their keys do not belong in the CRM settings or workflow JSON. See n8n's [HTTP Request credential documentation](https://docs.n8n.io/integrations/builtin/credentials/httprequest/).

Test an authenticated GET to `http://host.docker.internal:3001/api/n8n/health` with an n8n HTTP Request node. Expect `{"service":"customerlead","ready":true,"version":1}`. A 401 means the credential is wrong; a 503 means the CRM has not loaded a token. A health check alone does not confirm Gmail, Gemini, or Sheets connectivity.

## 2. Import the owner-change bridge

The current setup uses the separate sync bridge and sender alongside the original automation. Keep these existing three workflows; no recreation is needed. For a new installation that prefers two workflows, `customerlead-sync-and-send-bridge.json` combines the two helpers. Run that alternative instead of both separate helpers. The older [two-workflow setup PDF](../templates/leads/public/integrations/customerlead-setup-and-testing.pdf) describes that alternative; the complete project PDF above describes the current live setup.

Download **customerlead-sync-bridge.json** from the CRM's Automation page, or use `templates/leads/public/integrations/customerlead-sync-bridge.json`. Import it as a new workflow. It is inactive and contains no credentials or customer data. Its generator is `scripts/build-n8n-kit.mjs`.

Configure `Bridge settings` with the existing spreadsheet ID, `Leads` tab, and a new `ReplyReviews` tab. Select the appropriate Google Sheets credential on the Sheets nodes and the Gmail OAuth2 credential on the two Gmail HTTP Request nodes. Select CustomerLead on the CRM HTTP nodes.

Use these headers on `Leads` (the first 18 already exist in the supplied workflow):

```text
Lead_ID,Created_At_UTC,Name,Email,Phone,Service,Message,Source,Consent,Status,Priority,Follow_Up_Due_UTC,Follow_Up_State,Follow_Up_Sent_UTC,Owner,Notes,Acknowledgement_Status,Owner_Alert_Status,Category,AI_Summary,Gmail_Thread_ID
```

Use these headers on `ReplyReviews`:

```text
Draft_ID,Lead_ID,Gmail_Draft_ID,Gmail_Thread_ID,Email,Subject,Body,Review_Status,Updated_At_UTC
```

The bridge uses n8n's [Append or Update Row](https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.googlesheets/sheet-operations/#append-or-update-row), matching stable `Lead_ID` / `Draft_ID` values. It writes cells as RAW values so customer text is not executed as a spreadsheet formula.

Run the bridge manually with one test lead before enabling its one-minute schedule. Run one bridge execution at a time. It:

1. Pulls pending owner changes from `GET /api/n8n/sync`, one oldest change per entity.
2. Reads the current Sheets lead before merging only the fields the owner edited. It preserves automation-owned delivery results. Duplicate Lead_ID rows fail visibly. Follow-up cancellation/rescheduling fails if Sheets already says Reserved or Sent.
3. Saves reply text and review decisions in ReplyReviews. If a Gmail draft ID is linked, it updates that existing plain-text draft after validating the recipient/thread. Drafts with attachments or copied recipients require editing in Gmail to preserve them. Rejected drafts remain in Gmail for owner review.
4. Confirms each change as Applied or Failed through `POST /api/n8n/sync`. Failed changes are visible in Automation and can be queued for retry. Newer changes to the same record wait behind an earlier failure.

**There is no email-send operation in the bridge.** Manual CRM drafts without a Gmail draft ID are saved to ReplyReviews. Send them through the separate manual sender below, or copy the reply into Gmail. An Applied result describes the target named in its detail; it is not an email delivery receipt. The original support workflow also creates drafts rather than sending support replies.

The separate **manual Gmail sender** described below can send an owner-confirmed reply from the dashboard, including manual drafts without a linked Gmail draft ID. Importing that sender does not add a send operation to the review bridge.

Deleting a real lead queues a Closed/No-consent archive update to Sheets, removes local linked tasks/drafts, and remembers the deleted Lead_ID so a later inbound snapshot does not recreate it. Sample inquiries never queue external writes.

## 3. Publish results from the existing automation

For the first form-inquiry connection, use **Copy form nodes** on the CRM's Automation page. It copies the prepared `Form captured` Code node and `Publish Form captured` HTTP Request node, already connected. Click an empty area of your existing n8n canvas and press Ctrl+V. Select the existing CustomerLead Header Auth credential in the HTTP Request node, then add a connection from `SHEETS — Append Customer Lead` to `Form captured`. The Sheets node keeps its existing outgoing connection to the email gate as well.

The same two nodes are available as `customerlead-form-nodes.json`. To paste from that file, open it as text, copy its JSON contents, and paste onto the existing canvas. For a file import, use a separate temporary workflow and copy the two nodes from there into the main automation. This package adds the first form event publisher; the later Gmail, follow-up, configuration, and write-back steps still follow below. No token or credential binding is embedded in the package.

Import **customerlead-event-adapters.json** into a temporary workflow, then copy each required adapter/publisher pair into the existing workflow. Select CustomerLead on every publisher. The adapter code uses the exact source node names in the supplied export; preserve those names or update the references when copying.

| Attach after this source/output | Adapter | Result in the CRM |
| --- | --- | --- |
| `SHEETS — Append Customer Lead` | Form captured | Creates the lead, including free-mode form submissions and submissions with emails disabled |
| `SHEETS — Save Initial Email Results` | Initial email results | Updates only acknowledgement and owner-alert outcomes on existing leads; carries the original full row if the lead has not arrived yet |
| `Gmail — Create Draft (NEVER SEND)` | Email support processed | Atomically creates the email inquiry and its pending review draft, with Gmail identifiers |
| `Gmail — Label No-Draft Outcome` | A separate copy of Email support processed | Records the email inquiry and review/skip/failure outcome without inventing a draft |
| `Gmail — Mark Skipped` | Email screening result | Reports sender/automatic-message screening as skipped activity |
| `CHECK — Is Lead Valid?` false output | Form rejected or duplicate | Reports validation failure as skipped activity |
| `CHECK — Not Duplicate?` false output | A separate copy of Form rejected or duplicate | Reports suppressed duplicates |
| `SHEETS — Reserve Follow-Up` | Follow-up reserved | Shows Reserved with the execution ID |
| `SHEETS — Log Follow-Up Outcome` | Follow-up outcome | Shows Sent or Needs Review and the saved send timestamp |

Keep existing connections in place. Event delivery should report an already saved result, not rerun an acknowledgement or customer send after an HTTP error. Publishers retry the same event ID. If a source Sheets operation returns only an ID, configure it to return the saved mapped fields or merge them from its linked source before publishing.

The kit also includes an Error Trigger → Execution failure event → Publish execution failure chain. Configure that imported workflow as the existing workflow's error workflow, after configuring the publisher credential. It reports the failed node and execution ID to Automation / Activity. Do not select it as its own error workflow.

Email leads default to **no follow-up consent**. Email receipt alone does not grant follow-up permission. Form submissions and Gmail support remain separate paths in the source; the adapters bring both into the same CRM records. A form submission does not gain an AI reply draft until a draft-generation path is added to that branch.

### See Gmail inquiries in the dashboard

Use **Copy email inquiry nodes** in Automation, or download `customerlead-email-nodes.json`. Paste the two connected nodes into the original automation. Connect `Gmail — Create Draft (NEVER SEND)` to `Email support processed` while keeping its existing connection to the label node. Select **Header Account 2** in `Publish Email support processed`. This credential name is the user's existing CRM Header Auth credential; it is unrelated to the Gmail OAuth2 credential.

The publisher sends the original inquiry, classification, AI summary, Gmail identifiers, and proposed reply to the CRM together. Find the lead in **Inbox → Incoming inquiries** (source Gmail), or **Leads**; open the reply in **AI Drafts**. This displays inquiries processed and published by the automation, not the entire Gmail mailbox. Add the no-draft outcome publisher separately as described in the adapter table so those inquiries appear too.

### Send a reply manually from the dashboard

1. Download **customerlead-manual-gmail-sender.json** from Automation and import it as a **separate workflow**. Keep the existing automation and sync bridge.
2. Choose **Header Account 2** on `Claim approved reply`, `Record prepared draft`, and `Confirm Gmail delivery`.
3. On all four Gmail HTTP requests (`Read sending Gmail account`, `Read Gmail reply context`, `Save confirmed Gmail draft`, `Send confirmed Gmail draft`), choose **Predefined Credential Type → Gmail OAuth2**, using the same existing sending account. The credential needs access to read the account/thread/draft and compose/send a draft; see the [Gmail draft-send API](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/send).
4. With no replies queued, run **Test manual sender** once. It reads the Gmail profile and registers the sender with the CRM. `Claim approved reply` returns `{"job":null}` and the false branch ends normally. Automation then shows the sending address.
5. Enable/publish its one-minute schedule. Keep the sync bridge running; the sender waits for outstanding lead and review changes to reach Sheets.
6. In **Inbox → Incoming inquiries**, open or create a reply. Edit and **Approve reply**. Choose **Send via Gmail**, review From/To/subject/body, then **Confirm and queue email**. These are separate actions; approval alone never queues delivery.
7. View the request in **Inbox → Outgoing replies**. It progresses from **Queued** to **Sending** and **Sent** when Gmail returns a message ID. A queued reply can be cancelled. Sent content remains available in the outgoing view and its draft is locked against edits/repeated sending.

The manual sender does not use `send_emails_enabled`; that master switch controls automatic form acknowledgements, owner alerts, and follow-ups. Manual sending requires explicit owner confirmation regardless of that switch. `lead_ai_enabled` classifies form leads and does not generate a reply draft for the form branch by itself.

Sending first queues cancellation of an unclaimed pending follow-up and waits for the cancellation to reach Sheets. A follow-up already Reserved blocks the operation. Cancelling the queued reply does not restore the follow-up automatically. On a confirmed send, the CRM marks a New/Pending lead Contacted and queues the corresponding Sheet update.

The server freezes the approved recipient, sender, subject, and body, and persists an execution claim before n8n can send. The worker validates a linked draft's recipient/thread and refuses attachments or copied recipients. Without a linked draft it creates a new plain-text Gmail draft. For Gmail inquiries, it includes the thread's reply headers as required by [Gmail threading](https://developers.google.com/workspace/gmail/api/guides/threads).

**Never enable retries on `Claim approved reply` or `Send confirmed Gmail draft`, or restart an execution at its send node.** Gmail draft sending consumes the saved draft, and the queue does not reclaim a Sending request. If delivery is uncertain, the result is Needs Review; check the sending account's Sent folder and n8n execution before using **I checked Gmail: not sent**. If an execution stops before reporting its result, Sending stays visible; inspect that execution rather than running the send node again. CRM result acknowledgements are idempotent and can retry independently.

Tests simulate Gmail results in an isolated workspace. No real recipient is emailed by the test suite. A live send still requires the imported sender's Gmail credentials and an owner-confirmed test reply.

The form adapters recognise the source's `AI category: ...` Notes prefix and expose it as structured Category / AI_Summary fields. Prefer updating the original classifier to output those fields directly. The captured-lead event is create-only so a delayed capture notification cannot undo a later result or owner edit. Initial email outcomes use the separate `lead.delivery` event and leave lead status, notes, consent, and follow-up results intact.

## 4. Make both n8n branches read Settings

`GET /api/n8n/config` returns `{ "version": 1, "config": { ... } }`, with the snake-case field names used by the source workflow. The configuration contains no API keys or spreadsheet credentials. The CRM's Settings page controls business/owner details, verified facts, tone, signature, primary provider/model IDs, query, scan limits, follow-up delay, response expectation, and four automation preferences.

For the email support branch, add an authenticated CRM configuration read before `CONFIG — BUSINESS, FAQ & AI MODELS`. Replace its hardcoded assignments with expressions from `$json.config`, for example `={{ $json.config.business_name }}`, `primary_ai`, `gemini_model`, `openai_model`, `gmail_query`, and `max_emails_per_scan`. Configure the actual allowed model IDs in CRM Settings before running AI nodes. Preserve the required processing/outcome-label exclusions in your Gmail query.

For the form/hourly branch, replace the hardcoded configuration node with:

```text
TAG — Form Submission ─┐
                      ├→ Keep inquiry context → Read shared CRM configuration
TAG — Scheduled Review┘                            → Apply lead configuration
                                                    → ROUTE — Is Customer Form?
```

The three named nodes are included in the adapter kit. Set the spreadsheet ID in Apply lead configuration. The original form payload is restored from Keep inquiry context; the request to read configuration must not discard the customer's form fields. Shared configuration is assigned to `_cfg`, as expected by the existing nodes.

The four enable switches require separate workflow checks. The original export does not implement all of them independently:

| Branch | Required condition |
| --- | --- |
| Customer acknowledgement | `_cfg.send_emails_enabled && _cfg.send_customer_ack` |
| Owner notification | `_cfg.send_emails_enabled && _cfg.send_owner_alert` |
| Customer follow-up scheduler | `_cfg.send_emails_enabled && _cfg.send_customer_follow_up` plus consent/status/state/time eligibility |
| Optional lead AI classification | `_cfg.lead_ai_enabled` |

Add an independent owner-alert check rather than placing the owner alert only behind the acknowledgement's true branch. When either email is disabled, record Skipped and continue to result logging. A disabled acknowledgement must not silently disable an enabled owner notification. **Allow automatic form emails defaults off in the CRM**; it takes effect only after n8n reads this configuration and uses these checks. It does not alter the existing workflow until you wire it.

## 5. Repair the source's disconnected fallback paths

The supplied export has two empty outputs:

- `IF — Primary Gemini?` false → `AI — OpenAI Primary`.
- `IF — Gemini Valid?` false → `AI — OpenAI Backup`.

Configure the primary Gemini HTTP node's error behavior to reach its parser/fallback on a failed provider request. Verify all provider credentials and both success/failure routes with test data. Remove duplicate/manual `X-goog-api-key` headers and select the correct credential. Replace the source's test-only Gmail sender filter and unify its two different business identities. The imported kits contain none of the source's literal keys.

## Event contract and results

Every event uses a stable `eventId` (at most 180 characters), a `type`, and a `data` object. A saved event returns `{ "accepted": true, "duplicate": false }`; an identical retry returns `duplicate: true`. Do not reuse an event ID for a changed payload. The local file retains the most recent 2,000 IDs.

```json
{
  "eventId": "execution-123:lead:LEAD-123",
  "type": "lead.upsert",
  "data": {
    "Lead_ID": "LEAD-123",
    "Name": "Example Customer",
    "Email": "customer@example.com",
    "Service": "Kitchen sink leak",
    "Message": "Could someone inspect the leak?",
    "Source": "n8n Form",
    "Consent": "Yes",
    "Status": "New",
    "Priority": "High",
    "Category": "Booking",
    "AI_Summary": "Customer requests an inspection.",
    "Follow_Up_State": "Pending",
    "Follow_Up_Due_UTC": "2026-10-20T04:00:00.000Z"
  }
}
```

| Event | Payload |
| --- | --- |
| `lead.upsert` | Full current lead row; stable Lead_ID, name/email/service/message required |
| `lead.delivery` | Lead_ID and Acknowledgement_Status / Owner_Alert_Status; full lead row also required when the lead does not exist yet |
| `draft.upsert` | Draft_ID, existing Lead_ID, Subject, Body; optional Provider, Review_Reason, Gmail_Draft_ID |
| `support.processed` | Lead row plus optional draft fields; persists the email lead and its draft together |
| `followup.updated` | Existing Lead_ID, Follow_Up_State, optional Follow_Up_Sent_UTC |
| `automation.run` | Title, Detail, optional Status (`running`, `success`, `failed`, `skipped`), Stage, Execution_ID, Workflow, Lead_ID |

`Run_Status` can carry execution status when `Status` already contains the lead's New/Pending/etc. status. Full lead events must come from a fresh Sheets read after applying owner changes. Events cannot overwrite an owner-reviewed draft or a lead/draft with pending owner changes; these return 409. Archived leads return `ignored: true`. Unauthenticated requests return 401, unconfigured integration 503, invalid events 400, and persistence failures 500. Retry a persistence failure with the same ID.

An outbound acknowledgement looks like:

```json
{"changeId":"ID_FROM_SYNC_POLL","status":"Applied","detail":"Shared lead row updated in Sheets.","executionId":"123"}
```

Use `Failed` and a concise reason on an external error. Only acknowledge Applied after the external write succeeds. An already Applied acknowledgement is idempotent. A failed row is retried from the Automation page; a sync retry never resends mail.

## Review before unattended use

Test one form inquiry, one email inquiry with a draft, an owner edit/status/consent change, a failed sync, and a consented follow-up with test recipients. Check both Sheets and the CRM after each action. Marking a customer contacted must reach Sheets before the next live follow-up scan. The hourly source checks a 24-hour due time on a subsequent scan; it does not guarantee delivery at exactly 24 hours.

Sheets reservation and update operations are not transactional across workflows. The bridge checks the latest visible state, but simultaneous sends/owner edits still need a shared database with atomic claims for stronger guarantees. Keep this single-owner CRM on loopback; it has local storage and no owner-login system. This integration is for the local Docker setup, not public production hosting.

Validation uses isolated records: `npm test` in `templates/leads`, the TypeScript check, and `scripts/check-crm.mjs`. It does not exercise real Gmail delivery or edit the live n8n workflow.
