# Follow-up email review

Follow-ups is a standalone workspace page. Open a customer's View control to
record their permission, set a time, preview/edit/save the email and approve it.
These actions stay on `/follow-ups`; they do not open the lead editor or Inbox.

Leads shows follow-up permission as read-only: Granted or Not recorded. Its
Manage follow-up button opens the same inquiry's Follow-ups details. Ordinary
lead edits preserve the latest saved permission; new manually created leads
start without permission. Record any permission and schedule in Follow-ups.

Saving the email and approving it are separate actions. Approval confirms the
exact saved subject, body, recipient and schedule. Editing the saved email,
rescheduling, removing permission or withdrawing approval requires a new review.
Approval never records delivery or sends an immediate email. The scheduled check
can send only after the due time, with customer permission, New/Pending status,
both email preferences enabled and no competing delivery or outstanding sync.

The page shows All records separately from Due for follow-up. Due counts pending
schedules at or before the current time, including those awaiting approval or
blocked by a sending requirement. Unscheduled, future, skipped, already sent and
reserved records are not due. Card counts match the search and cover all result
pages. The due filter uses the same predicate, refreshed every 15 seconds.
Dashboard/report due totals use that same schedule definition. Each record
explains the requirement preventing sending.

Saved email text lives in optional `Lead.followUpEmail` in the existing CRM file.
There is no reseed or destructive migration. Existing pending follow-ups require
fresh approval; existing sent/uncertain deliveries without saved text explicitly
say that their historical email was not recorded. Suggested text is never
presented as evidence of a past email. Permission/schedule/cancellation changes
retain the existing acknowledged Sheets sync. Email text is read from the CRM
claim, so no new Sheet columns are required.

The authenticated `/api/n8n/followups` claim requires the
`approved-followups-v1` capability and returns the immutable reviewed subject/body
for that reservation. Older senders are refused rather than sending their
hardcoded template. Reserved email cannot be edited or approved again. Delivery
callbacks still require their execution owner; uncertain delivery is never
retried automatically. Releasing Needs Review requires the owner to check the
sending account and explicitly confirm that the follow-up was not sent, followed
by a fresh schedule and approval.

`scripts/setup-followup-review.mjs` previews the two-node live update.
`--apply` checks updated CRM health and idle deliveries, backs up the complete
current workflow, and updates only Claim consented follow-up and GMAIL — Send
Consented Follow-Up. It retains all 128 live nodes, report support, credential
references, edges and other workflows. It uses supported CLI import/publication
and reloads the engine. Exports/CLI details stay private. Do not replace the live
128-node workflow with the older generated import to install this feature.

Verification uses `tests/followups.test.mjs`, `tests/unified-workflow.test.mjs`
and `scripts/check-followups.mjs`. Browser tests use isolated CRM storage and a
mock Supabase service, with intercepted schedule fixtures for counts; no live
Gmail request or real customer send is part of those checks.

`tests/form-followups.test.mjs` exercises the reviewed form's actual permission
options, validation, Sheets field mapping and capture adapter through CRM due
counts, preview/save/approval, reservation and simulated delivery confirmation.
It covers No/missing permission, custom delays, exact due boundaries, closed or
contacted inquiries, sending preferences and duplicate prevention entirely in
memory. Form Yes records permission and schedules Pending automatically; opening
Follow-ups supplies a suggested preview, without creating a saved Gmail draft.
Owner save and approval are required before the hourly check can send.
