# One CustomerLead workflow

> Historical consolidation notes from 20 October. The selected current export
> has **128 nodes** and was exported as active. Use [Welcome back](start-here.md)
> and the [current illustrated guide](setup-combined-workflow.md) for today's
> setup. The inactive 123-node draft and three-active-originals state described
> below are earlier checkpoints. CRM storage now uses Supabase.

Maintainer guide, 20 October 2026. The customer continues to use the existing dashboard.

The consolidated file is `private-integrations/customerlead-unified-gemini.json`, named **ClearFlow — Customer support, leads & dashboard (Gemini only)**. It combines the three selected Downloads exports into one inactive workflow. The three originals are retained for rollback. Importing this draft does not switch the running automation.

The verified draft is already imported into the existing n8n project: [open the new workflow](http://localhost:5678/workflow/63a8178b-64a0-4360-8ff3-d150fe201cf9). It remains inactive. The three original workflows remain published. The import verified all four saved credential types, 48 total bindings, the complete saved graph and unchanged originals. It did not restart n8n or send an email.

The live read-only connection check **passed**, n8n execution **750**: CRM health, `adamromas0634@gmail.com`, and `AI-SUPPORT CRM WORKFLOW` with `Leads`, `ReplyReviews` and `START_HERE`. Exactly the five check nodes ran. Gemini generation, real delivery and elapsed follow-ups remain separate controlled tests after cutover.

## What is inside

| Path | Starts when | Result |
| --- | --- | --- |
| Customer email | Every five minutes | Screen new inbox messages, use Gemini, save a Gmail draft when appropriate, and capture the inquiry in the dashboard. |
| Website form | A customer submits the existing production form | Validate and capture the lead; apply the existing acknowledgement and owner-notification preferences. |
| Agreed follow-up | Hourly, for eligible due inquiries | Claim the current consented inquiry in the CRM before reserving its Sheet row and sending the configured follow-up. |
| Dashboard changes | Every minute | Save ordered owner changes and reply reviews to the existing Google Sheet and eligible Gmail drafts. |
| Confirmed replies | Every minute | Claim one owner-approved, explicitly confirmed reply after its changes finish syncing; record Gmail's delivery result. |

The four schedules start separate executions. An empty sync queue cannot starve the sender, and the sender is outside the sync loop. All paths still share the same n8n process, Google accounts and API limits; consolidation does not make an unavailable service available.

There is one additional **Manual system check**. It only reads CRM health, the Gmail profile and the Sheet's title/tab names. It cannot reach a draft-write or send node. n8n permits one Manual Trigger per workflow; the old manual triggers were replaced by this check. [n8n Manual Trigger](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.manualworkflowtrigger/)

The new workflow contains 123 nodes, including five section notes, compared with 137 across the original exports. The reduction removes OpenAI primary/backup routing, redundant provider/parser nodes, a disabled duplicate form publisher, old notes and duplicate manual triggers. The original trusted business prompt is retained. Gemini failure captures the inquiry for manual review rather than inventing a reply or sending one.

## What is preserved

- The selected Gmail, Google Sheets, Gemini and CRM credential references on every retained node: 44 existing bindings.
- The existing Sheet `1IugQXIcteoSLJ0aACmG8A5eSb6vl-CvelPWg9b4K8-Y`, its `Leads` and `ReplyReviews` tabs, columns, row IDs and matching fields.
- The original form webhook ID `0b35d245-d073-4729-b87f-8d1be7732c76`. Verify the production address shown after publication; no replacement form was created.
- The local CRM address `http://host.docker.internal:3001` used from Docker, existing integration authentication and dashboard settings reads.
- Gmail screening, labels, processing locks, event deduplication, owner review, recipient/thread checks, follow-up consent rules and confirmed-delivery tracking.
- Existing CRM records, settings, reply text, queued/completed delivery jobs and replay protection. No record migration or reset is required for local consolidation.

Inline Gemini key headers were removed from the two Gemini request nodes; both use the saved Gemini credential already selected in the export. The supplied source exports are backed up privately and left unchanged. The generated file contains credential references, not decrypted credentials. It must be imported into the same n8n instance/project to keep those selections working.

The running helpers had six later differences from the uploaded helper files. Review confirmed the existing project's MIME body wrapping, Unicode subject folding, deleted-draft explanations and explicit RAW Sheet reads; those fixes are preserved in the consolidated version. Published main defaults for plain-text Gmail drafts, safe extra Sheet fields, Code-node modes and read-only configuration requests are explicit too. The reviewed live graph fingerprints are recorded alongside the untouched source-file hashes; import refuses a subsequent unreviewed change.

The dashboard saves its records in `templates/leads/.data/crm.json`. n8n writes the native Google Sheet. A downloaded `.xlsx` remains a snapshot. Form capture writes a lead directly; Gmail capture queues lead/draft indexing through the sync path. Owner edits and review decisions also write through that path. Combining the workflows does not change these storage responsibilities.

## Before switching

1. **Keep the current services running.** Use the current local Docker n8n and CRM at `http://localhost:3001`. If the updated CRM is not running, start it from the project directory:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1 -Template leads
   ```

   The updated backend adds an authenticated atomic follow-up claim. The new Manual system check refuses to pass against an older backend without that capability. Reuse the existing environment file and CRM data directory.

2. **Keep private backups.** The prepared source exports and CRM snapshot are in the ignored `private-integrations/source-backups` and `private-integrations/crm-backups` directories. The draft-import helper also exports the three current n8n workflows privately inside its persistent volume. For disaster recovery or moving computers, additionally back up the full n8n database/configuration and its existing encryption key together. Workflow JSON alone cannot restore working encrypted Gmail/API credentials. [n8n backup and restore](https://docs.n8n.io/deploy/host-n8n/keep-n8n-running/backup-and-restore)

3. **Open the prepared inactive draft.** If the helper has already imported it, find **ClearFlow — Customer support, leads & dashboard (Gemini only)** in your n8n workflow list. Otherwise choose **Import from file** and select:

   ```text
   C:\Projects\ai-customer-lead-dash\private-integrations\customerlead-unified-gemini.json
   ```

   Import into the same personal project as your three current workflows. Leave the new workflow unpublished for now. Do not paste it over an original workflow or create multiple copies.

4. **Review the passed connection check.** Execution 750 already returned `ready: true` and `mailSent: false`. To repeat it after changing a connection, refresh the new workflow's editor and click **Execute workflow**, starting at **Manual system check**. `System check complete` should show your existing Gmail account and both Sheet tabs. If it fails, leave the originals running and fix the indicated connection first. This check does not call Gemini or test actual email delivery.

5. **Check pending work before switching.** In the dashboard, let active email sends finish and review waiting/failed saved changes. In n8n's Executions view, let current main, sync and sender runs finish. A reply marked **Needs attention** after uncertain delivery needs a Gmail check; do not replay its send node.

## Switch once

6. **Deactivate the three originals.** Unpublish/deactivate the existing support automation, Sheets write-back bridge and owner-confirmed Gmail sender. Retain them and their credentials. Check Executions again and wait for any already-running execution to finish. Deactivation stops new triggers; it does not justify interrupting a send already underway.

7. **Publish the new workflow.** Only after the originals have stopped, publish the consolidated workflow. Keep the older combined helper inactive too if it exists. Never run the same capture/sync/send paths in old and new workflows simultaneously. Both form workflows share the preserved production webhook ID, so they must not be active together.

8. **Check automatic processing.** No daily manual execution is needed. Keep the computer awake, Docker/n8n and the CRM server running. Gmail scanning starts on the next five-minute tick; sync and confirmed sending run each minute; eligible follow-ups are checked hourly. An inquiry due after 24 hours may wait until the next hourly check.

## Verify from the frontend

9. **Send one fresh controlled inquiry.** From your other test mailbox, send a new plumbing inquiry to `adamromas0634@gmail.com`. Allow the next five-minute scan plus AI processing. Check **Inbox**, **Leads** and, when a reply is appropriate, **AI Drafts**. Confirm one copy of the inquiry appears. Keep the existing search query and processed labels; do not remove labels to force old messages through again.

10. **Verify the same Sheet.** Check the inquiry in `Leads` and its draft in `ReplyReviews` after sync. Edit the inquiry's internal notes in the dashboard. Its saved change should move from **Waiting** to **Saved**, and the matching Sheet row should show the edit. A confirmed save is different from a local save waiting for sync.

11. **Test a reply only when you intend to send it.** Review/edit a draft, approve it, choose **Send via Gmail**, check the recipient and content, then explicitly confirm. Follow the queued/synced/sending/sent display in **Inbox → Outgoing replies**. Approval alone never sends. **Sent** appears only after Gmail returns a confirmed message ID. Use your controlled test address for this delivery test; no real email was sent by the automated verification described below.

12. **Check form and preferences.** Use one controlled submission through the production form. Confirm its lead and the configured acknowledgement/owner-notification results. Keep your business switches as intended. Turning on AI or automatic form emails does not queue manual replies.

13. **Check follow-ups without forcing delivery.** An inquiry needs consent, an open eligible status, a due date and enabled automatic-email/follow-up switches. A manual reply cancels an unclaimed pending follow-up. The new CRM claim prevents a stale Sheet row or a competing manual reply from authorizing another send. If a run stops after claiming, the follow-up stays reserved for review; do not repeatedly execute the send node. A live elapsed follow-up needs a separate controlled test and was not performed during preparation.

## Roll back if needed

Unpublish the consolidated workflow and wait for its in-flight executions to finish. Review Gmail/CRM before retrying any uncertain delivery. Re-enable the three original workflows once, using the same CRM data and Google Sheet. Do not restore an older CRM snapshot merely to change workflows: it can lose new inquiries or forget completed deliveries. If the new follow-up claim left an inquiry reserved, resolve that specific item before enabling a second processor for it.

## Verification and maintenance

Preparation verified the selected source hashes, preserved retained node IDs/credentials, compiled all Code nodes, checked references and paths, and ran 66 automated tests plus TypeScript and the production build. Isolated desktop/mobile checks exercised navigation, settings, capture, ordered sync, approval, simulated Gmail callbacks and concurrent follow-up claims. The API race test allowed one claimant and rejected the other. It used a separate data directory. The final read-only comparison retained all 18 pre-existing lead IDs, 15 draft IDs and two delivery-job IDs; tasks remain empty. The latest live total is 19 leads, including one additional inquiry received while the current system continued running.

These checks do not establish live Gmail delivery, Gemini quota availability or an elapsed 24-hour follow-up. The inactive draft and read-only connection check precede the controlled cutover tests above. No live workflow is activated by the builder/import helper.

The installed n8n 2.43.8 CLI initially selected the first inbox trigger despite its start-node discovery selecting the manual trigger. Those attempts found no unhandled messages and made no inquiry/draft/delivery changes. The final draft now puts all five manual-check nodes first, and the live rerun verified that exact path. The checker refuses any other node ordering. A draft-order refresh is narrowly limited to reordering identical nodes in an inactive draft; it cannot overwrite different parameters or credentials.

The reviewed 97-node main source is now recorded in `scripts/n8n/source-reference.json`; all three source hashes are in `scripts/n8n/unified-sources.json`. Regeneration refuses changed sources until reviewed:

```powershell
& .\.local-tools\node-v22.23.3-win-x64\node.exe .\scripts\build-unified-workflow.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\import-unified-workflow.ps1                 # inspect only
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\import-unified-workflow.ps1 -ReviewLive     # safe field comparison
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\import-unified-workflow.ps1 -ImportDraft    # import inactive draft only
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-unified-connections.ps1             # verified read-only connection check
```

Keep generated files and backups private. They are intentionally outside the app's public downloads and ignored by Git. The previous three-workflow PDF remains a reference for the same business journey; use this guide for the one-workflow cutover. For moving online, see [hosting options and migration steps](customerlead-hosting-options.md).
