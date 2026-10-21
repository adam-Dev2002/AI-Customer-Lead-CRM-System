# Workflow functions and owner screens

## Combined Inbox navigation (20 October 2026)

Inbox is the single navigation entry for incoming inquiries, AI/manual reply review
and outgoing emails. Use its **Incoming inquiries / AI replies / Outgoing emails**
tabs. Existing approve/reject/save controls and explicit send confirmation remain.
The Inbox badge and AI replies tab show the number of replies awaiting review.

Links use `/inbox`, `/inbox?view=replies` or `/inbox?view=outgoing`. Optional `lead`
and `draft` parameters select the exact inquiry/reply. The old `/drafts` route
redirects to Inbox's AI replies tab and preserves these identifiers. Tabs support
keyboard navigation, refresh and browser Back. Panels stay mounted during tab
switches to retain searches, filters and unsaved reply edits; reloading still
requires saving edits first. The following historical AI Drafts references refer
to **Inbox → AI replies** in the current UI.

Project: **AI customer support + lead inquiry CRM**. Baseline: the user's 68-node n8n export. The 19 October 2026 live audit also checked and repaired the published original automation and its two separate helpers. n8n runs in Docker on this computer; CustomerLead is its local owner interface. See [the complete project PDF](../templates/leads/public/integrations/customerlead-project-guide.pdf) for setup, storage, daily use and the verification limits.

Current source: the Downloads `ONE WORKFLOW.json` export selected on 19 October 2026, replacing the older `(1).json` reference. The business functions and adapter node names are unchanged; see [the version comparison](n8n-current-review.md).

| Business function | Source automation | Frontend | Backend / connection |
| --- | --- | --- | --- |
| Website form capture | Form trigger, validate, deduplicate, append lead | Leads; lead details; Inbox | Required-field and duplicate validation; `lead.upsert` adapter |
| Gmail inquiry capture | Five-minute scan, read full email | Inbox; Leads; original message; Gmail thread link | `support.processed` creates an email inquiry and optional draft atomically, then queues automatic Leads / ReplyReviews indexing |
| Screening, labels, processing lock | Sender/auto-message screening and outcome labels | Automation and Activity stages/results | `automation.run`, screening and execution-failure adapters; automatic work stays in n8n |
| AI service intent, priority, summary | Gemini / OpenAI parsers and routing | Inbox and lead details; category/priority controls | Structured Category / AI_Summary fields; service kept separate |
| AI draft generation | Review AI & Route; Gmail Create Draft | AI Drafts; original inquiry; provider/reason | `draft.upsert` / `support.processed`; reviewed drafts protected from overwrite |
| Owner reply review | Missing from original source | Edit/save/approve/reject/copy; Gmail drafts link | Local review + queued `draft.review`; bridge saves ReplyReviews and updates eligible existing Gmail drafts; approval never sends |
| Manually send an approved reply | Separate prepared Gmail sender | AI Drafts confirmation; Inbox outgoing replies, queue cancellation, delivery review | Authenticated claim/prepared/result endpoint; immutable owner-confirmed reply; Gmail draft send; no automatic send retries |
| Shared lead management | Sheets lead row | Create/edit/delete, assign owner, notes, status, search/filter, CSV | Persistent local mutations; queued write-back, external archive on delete, stable Lead_ID |
| Customer acknowledgement | Gmail acknowledgement; initial result logging | Per-lead delivery result; Settings preference | Live master and independent acknowledgement gates use shared settings; result publisher records outcome |
| Owner notification | Gmail alert; initial result logging | Per-lead owner alert result; owner contact and notification preference | Live master and independent owner-alert gates use shared settings; result publisher records outcome |
| Consent and 24-hour scheduling | Hourly consent/status/time filter | Follow-ups; lead details; Calendar | Same local eligibility rules, cancel/reschedule mutations, queued Sheet changes |
| Review and send follow-up | Exact saved email approval; atomic reservation; Gmail send; log outcome | On-page email editor, permission, schedule, approval, Pending / Reserved / Sent / Skipped / Needs Review | `approved-followups-v1` claims return reviewed content; `followup.updated` preserves execution ownership |
| Error handling and recovery | Provider/parser failures, delivery errors, failed executions | Automation activity, follow-ups needing attention, failed updates + Retry | Structured execution metadata and acknowledged outbox; delivery retries remain an explicit n8n/Gmail decision |
| Business facts and response style | Two original config blocks | Settings business identity, FAQ/facts, tone, signature, response expectation | Both live branches consume authenticated shared `GET /api/n8n/config`; form/follow-up context is preserved |
| Provider/model and throughput | Original model/query/scan config | Settings Gemini/OpenAI, model IDs, Gmail query, email/follow-up scan limits | Validated settings and native n8n field mapping; credentials stay in n8n |
| Connection monitoring | Missing from original source | Automation receiver/event/config/poll indicators; pending/applied/failed updates | Authenticated health/events/config/sync endpoints; no false claim of Gmail/AI credential health |
| Owner productivity | Additional CRM functions | Tasks, Contacts, Calendar, Dashboard, Activity export | Derived from the same stored leads/tasks; no matching n8n node is needed |

Every current CRM mutation has an owner control: lead creation/edit/deletion/import, manual drafts and review, confirmed Gmail sending, queued-reply cancellation and delivery review, follow-up cancel/reschedule, task create/edit/complete/delete, settings save, sample removal, notifications-read, and failed-sync retry. Automatic sends stay in n8n; a manual reply requires explicit owner confirmation in the draft editor.

The live wiring, both missing AI fallback routes, independent email gates, shared config reads and Sheet operations were repaired. The final audit snapshot verified 10 Gmail leads and 10 reply rows in Sheets, with 22 Applied / 0 Pending / 0 Failed updates. Existing Sheet form rows and all real CRM inquiries were preserved. All 43 automated checks, isolated desktop/mobile checks, TypeScript and the production build passed. No new real-mail delivery or elapsed 24-hour follow-up test was performed. The owner confirmed deleting old test emails/drafts; the affected queued send was cancelled and its text retained for fresh review through the explicit deleted-link recovery action. See [the exact connection steps](n8n-connection.md).
