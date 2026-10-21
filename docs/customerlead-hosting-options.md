# CustomerLead hosting options

> Earlier planning reference. The website is now on Vercel and the CRM is in
> Supabase. Automation hosting is paused: Northflank asked this account for a
> payment card. Start with the [current handover](start-here.md) and
> [automation hosting checklist](setup-combined-workflow.md#7-when-you-are-ready-to-host-the-automation).
> Older local-storage and no-deployment statements below describe earlier work.

Maintainer guide. Reviewed on 21 October 2026, Singapore time.

Latest preference: existing Vercel account, personal/non-commercial use, no card
and no PC left running. See [the current staged guide](vercel-supabase-n8n-personal-guide.md).
The business-use caveat for Vercel below does not exclude this personal demo.
The cloud database/report adapter is now implemented, and this workspace has
been migrated. An Auth connection alone did not perform that migration. The
current guide records the actual setup and remaining hosting steps.

## Recommendation

Consolidate and verify the existing automation locally first. The dashboard and n8n already work together on this computer; fewer workflow files do not require a hosting move. Keep the existing CRM records, Google Sheet, Gmail account and Gemini credentials.

Hosting can later let the system run while this computer is off. For this project, an always-on server with persistent storage is the most direct route. A free website deployment alone does not provide the running n8n service or the storage this application currently uses.

This guide describes the migration path. Supabase sign-in and workspace access
checks now exist in the app. The Docker/server launch kit is in
`deploy/customerlead`; the current step-by-step free-server guide is
[customerlead-cloud-launch.md](customerlead-cloud-launch.md). No cloud account,
server or public address has been created by preparing these files.

## A website and a running automation are different services

| Deployment | What it provides | What this project still needs |
| --- | --- | --- |
| Free static frontend site | Public pages and browser assets | A running Next.js backend, durable CRM storage, and n8n to scan email, sync changes and send confirmed replies. This app cannot be deployed as static pages alone. |
| Free serverless Next.js deployment | Pages and request-driven API functions | Supported durable storage and an independently running n8n service. Deploying the dashboard does not start n8n's timers. |
| Always-on server with persistent storage | A place to run both Next.js and n8n, each with its own stored data | Login, HTTPS, backups, secure configuration and ongoing server maintenance. |
| Current computer | The existing dashboard, Docker n8n, credentials and records | Keep the computer, CRM server, Docker and n8n running for unattended processing. |

The browser can be closed while the services continue running. Closing or sleeping the computer stops local processing.

## What the current free plans mean

| Option | Relevant limits | Fit |
| --- | --- | --- |
| Render Free | Web services sleep after 15 minutes without incoming traffic. Files changed at runtime disappear on restart, redeploy or sleep. Free services cannot attach a persistent disk; free PostgreSQL expires after 30 days. | Temporary previews rather than dependable unattended CRM operation. A sleeping n8n process cannot run its schedules. [Official free-service limits](https://render.com/docs/free) |
| Vercel Hobby | The free Hobby plan is limited to personal, non-commercial use. Vercel recommends external storage for files written by Functions. | Not the free deployment choice for this business CRM. Moving here would also require replacing the current writable CRM file storage. [Hobby plan](https://vercel.com/docs/plans/hobby), [Files in Functions](https://vercel.com/kb/guide/how-can-i-use-files-in-serverless-functions) |
| Oracle Always Free VM | Eligible compute and block storage may support both services. Availability varies; Oracle can reclaim idle free instances. Current Always Free A1 limits are equivalent to 2 OCPUs and 12 GB memory, subject to the account's entitlement. | A possible free server route if capacity is available and someone can administer it. It requires more setup than the current local system. Check the actual Console estimate and entitlement before creating resources. [Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) |
| Paid persistent hosting | Select an always-on service and persistent storage, or a server you administer. | Usually a more predictable route when the system must stay available. Render documents n8n with PostgreSQL or an attached persistent disk. [Render's n8n deployment guide](https://render.com/docs/deploy-n8n) |

n8n's self-hosted Community edition does not require a paid edition license. Its managed Cloud service has a time-limited trial followed by paid plans. Server hosting and Gemini/API usage remain separate from that distinction. [n8n self-hosting](https://docs.n8n.io/deploy/host-n8n), [n8n Cloud trial](https://docs.n8n.io/deploy/use-n8n-cloud/start-your-free-trial)

## Required application work before public use

The current app is a single-workspace deployment. Before its public cutover:

- Supabase Auth now protects dashboard pages, and CRM API routes require an
  authenticated member of `crm_workspace_members` for the existing workspace.
  Verify signed-out and non-member denial on the deployed server. Preserve the
  existing Supabase project and membership; configure its public HTTPS redirects.
- Keep the n8n integration endpoints protected by their existing server-side authentication. Owner login must not accidentally break authenticated machine-to-machine requests. Public form intake, if used, needs its own appropriate validation and abuse controls.
- `templates/leads/lib/crm/storage.ts` saves records to `CRM_DATA_DIR/crm.json`, defaulting to `.data/crm.json`. It serializes writes within one Node.js process. For the initial server route, run **one dashboard instance** and mount a persistent directory. Serverless deployments, multiple instances or multiple independent writers need a database and transactional coordination instead.
- Keep secrets outside the repository and browser code. Add production HTTPS, private backups and a tested restoration procedure.

The login and deployment files are implemented. Hosting-account creation,
restoring data, public addresses, cloud verification and the actual cutover still
remain; combining workflows alone does not perform those steps.

## Step-by-step migration, including a conditional free-VM route

1. **Finish local verification.** Test the consolidated workflow's inquiry capture, draft review, Sheets updates and confirmed-send queue with isolated data or controlled inquiries. Record the current n8n version and the currently active workflow IDs. Keep the earlier workflows available for rollback, with only the intended replacement processing each branch after cutover.

2. **Complete the application protections above.** Confirm that a signed-out visitor cannot read CRM records or change them. Confirm that an authenticated n8n request can still reach its integration endpoints. Use a separate staging workspace for these checks.

3. **Make consistent private backups.** Back up the current CRM JSON and private environment configuration. Back up the n8n database, configuration and encryption key from its persistent volume, retaining the current image version. Stop the relevant service for a filesystem backup or use a supported consistent database backup method. Do not copy a live SQLite file while assuming the copy is complete.

   Workflow JSON contains credential references, not a backup of working Gmail/Google OAuth tokens. Preserve n8n's encrypted data and its existing encryption key together. A restored database needs that key to decrypt its credentials. Do not put decrypted credential exports or keys in source control. [n8n backup and restore](https://docs.n8n.io/deploy/host-n8n/keep-n8n-running/backup-and-restore)

4. **Select the host.** For a free-VM attempt, create an Oracle Cloud account only if its sign-up requirements are acceptable, choose the home region carefully, and look for available Always Free eligible compute. Account creation commonly requires a phone number and card. Stay within the actual free compute, storage and networking allowances; do not assume trial-credit resources remain free afterward. If no eligible capacity is available, retain the local system or choose another host. [Oracle Free Tier](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm)

5. **Prepare the server.** Install a supported Linux system, Docker and Docker Compose. Restrict administrative access and set up HTTPS for the dashboard and n8n. An Arm-based VM needs compatible container images and a Linux/Arm application build; do not copy Windows `node_modules` onto it. Keep the dashboard and n8n as separate services even when they share a server.

6. **Configure persistent data before startup.** Mount a private writable directory for the dashboard and point `CRM_DATA_DIR` to it. Mount n8n's persistent data directory separately. Restore the complete CRM data directory and n8n backup, retaining the same encryption key and compatible n8n version. The launch kit refuses startup against missing or incomplete restored storage, preventing an accidentally seeded workspace. Keep the hosted schedules inactive during verification.

7. **Configure the service addresses.** Ensure n8n can reach the CRM on their private Docker network. The prepared Compose kit gives the CRM the alias `host.docker.internal`, preserving the existing `http://host.docker.internal:3001` callbacks. Other hosting layouts may need an internal address change. Preserve the same CRM authentication secret on both sides. The dashboard's public address and n8n's public form/webhook address should use HTTPS.

   Check the **installed n8n version** before changing webhook URL environment variables. Current n8n documentation uses `N8N_WEBHOOK_URL` and states that `WEBHOOK_URL` became deprecated from version 2.35.0. Older versions use the older setting. Do not rename the local setting blindly or upgrade n8n as an incidental migration step. Configure proxy headers and trusted proxy hops for the actual network path. [n8n reverse-proxy configuration](https://docs.n8n.io/deploy/host-n8n/configure-n8n/basic-configuration/configuration-examples/configure-webhook-urls-with-reverse-proxy)

8. **Check Google OAuth and API connections.** Keep the existing Gmail account, Google Sheet ID, selected credential references and Gemini configuration. In the hosted credential editor, copy the exact displayed OAuth redirect URL and add it to the existing Google OAuth client's authorized redirect URIs. Retain the local URI during the transition if rollback is needed. Reconnect only if Google requires it; moving the workflow does not itself create a new mailbox or Sheet. Test Gmail profile/labels and Sheets reads before any delivery. [n8n Google OAuth setup](https://docs.n8n.io/integrations/builtin/credentials/google/oauth-single-service)

9. **Verify without processing twice.** Compare record IDs and counts, settings, pending changes, draft links and delivery jobs with the backup. Do not reset replay protection or requeue completed/uncertain sends. Verify the hosted dashboard privately and test authenticated health/configuration requests. Do not run local and hosted copies of the same schedules together.

10. **Cut over once.** Pause the local schedules, take a final consistent data snapshot, restore the final state and verify it, then publish the hosted replacement. Update the website's production form address if it changes. Send one new controlled inquiry, verify CRM and Sheets, and use an explicit owner confirmation for a controlled reply test. Gmail-confirmed delivery is the completion signal; draft approval alone is not.

11. **Prove independence and recovery.** With local processing stopped, check that hosted scheduled scans and saved changes continue. Keep private backups outside the server and document a restoration test. Retain the local rollback backup until the hosted system has been verified; do not activate both copies to recover from a partial failure.

## Completion evidence

Before calling hosting complete, record the deployed versions, public/private addresses, backup location, authenticated-access checks, matching CRM record counts and successful controlled capture/sync results. Record a controlled send separately, and distinguish simulated follow-up tests from an actual elapsed 24-hour follow-up.

Customer-facing Automation and Settings should continue to show business controls and understandable status messages. Keep this infrastructure guide and credential setup outside the customer's daily interface.
