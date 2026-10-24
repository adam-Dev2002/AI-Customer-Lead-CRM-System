# Public CRM with local Docker n8n

Selected by the owner on 24 October 2026. Hosting migration is deferred. The CRM
stays at https://ai-customer-lead-crm-system-oyh1.vercel.app and uses its existing
Supabase project. n8n stays in the existing `n8n` Docker container on this PC.

## How the connection works

Owners sign into separate CRM workspaces, open Connections, and approve Google
access for their business inbox. The website creates a new native Google Sheet.
Encrypted setup jobs wait in Supabase. A local operator worker requests those
jobs from the public CRM and creates new Google/CRM credentials and a predefined
inactive workflow inside n8n. The owner confirms the inbox before enabling it.

All Docker-to-website requests are outbound HTTPS. The public website never calls
`localhost`, `host.docker.internal`, or the n8n editor. No public Docker port or
tunnel is required. n8n then polls Gmail and the public CRM using each business's
separate credentials and CRM token. The four schedule branches stay independent.

This mode initially covers **Gmail intake**. Local n8n form webhooks cannot receive
public form submissions without another ingress/queue. The customer UI therefore
does not advertise a public form link for a locally provisioned connection.

An email address alone cannot authorize Gmail. Each owner must approve Google's
permissions. Gmail/Workspace accounts are supported; Outlook is not configured.

## Current live checkpoint

Read-only inspection on 24 October found n8n 2.43.8 running, with the existing
128-node unified ClearFlow workflow published. Its CRM receiver still targets
`host.docker.internal:3001`, and public CRM polls are stale. Changing the address
and verifying the existing credential must precede restoring its public sync.

The imported Business 2 workflow `el8KWk6fA2fx8yrZ` remains inactive. Its configured
email is Adam's second test account, but some nodes select the original Gmail
credential, the Gemini node selects the original CRM credential, its Sheet ID
is still a placeholder, and most bindings are missing. Do not publish this copy.
The automatic connection flow creates a separate verified copy; it does not
silently repair or activate that incomplete manual copy.

Supabase has the original workspace and one empty second workspace. The owner
has now applied both connection migrations, verified through the live schema.
They created a local operator API key, and the installed worker's read-only n8n
check passes with zero jobs executed. Its directory/config permissions are
700/600, owned by the existing n8n user. No new
Google grant, live Sheet, credential, job, workflow activation or send has been
performed by the implementation tests.

## One-time operator setup

Customers only use Connections. The following steps belong to the maintainer.

1. In local n8n, open **Settings → n8n API → Create an API key**, label it
   `CustomerLead local setup`. Put it only in `apiKey` in the ignored private
   `private-integrations/local-onboarding/worker.json`. Never paste it into chat
   or commit it. The operator key stays on this PC, not on Vercel. It needs
   credential read/create and workflow read/create/activate/deactivate access.
   [Official API authentication](https://docs.n8n.io/api/authentication/).
2. The prepared private config pins the existing n8n project
   `1xf2pdRYK0cRMvZ0`, approved Gemini credential `NZvBB4N15DHueCK6`, loopback n8n
   origin, and stable CRM origin. Keep its generated worker ID/key. Do not rotate
   keys with a pending journal. Copy the matching worker ID/key from the ignored
   `vercel-production.env` into Production environment settings privately.
3. Apply these additive SQL files, in order, to the existing Supabase project:
   `202610240001_crm_google_connections.sql`, then
   `202610240002_crm_local_onboarding_worker.sql`. They retain original CRM data,
   memberships and existing tokens. They add service-only encrypted setup state,
   jobs and worker heartbeats. A Supabase service key cannot apply SQL through
   the normal data API; use the SQL Editor or an authorized database connection.
4. Configure the product Google Web OAuth client, enable Gmail/Sheets/Drive APIs,
   and register this exact callback:
   `https://ai-customer-lead-crm-system-oyh1.vercel.app/api/connections/google/callback`.
   Use `gmail.modify` and `drive.file` scopes. Add the two controlled inboxes as
   test users while the Google app is in Testing. See the Google release limits
   in [the onboarding reference](customer-google-onboarding.md).
5. Add the values from the private env file to **Vercel Production**, supplying
   the real product Google client ID/secret. Keep the existing Supabase and CRM
   values. Select `CRM_N8N_CONNECTION_MODE=pull`. `CRM_N8N_API_URL`,
   `CRM_N8N_API_KEY` and `CRM_N8N_SETUP_KEY` are unnecessary on Vercel in this mode.
   Keep `CRM_CONNECTION_ENCRYPTION_KEY` backed up and unchanged after first use.
6. Deploy the reviewed app, then set `CRM_GOOGLE_CONNECTIONS_ENABLED=true` and
   redeploy when SQL/Google/config are ready. The prepared file keeps this false
   so unconfigured setup cannot open early. No production change is made by
   generating the file.
7. From the project directory run:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-local-onboarding-worker.ps1 -Install -Check
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-local-onboarding-worker.ps1 -Start
   ```

   Install only copies the helper/config files. Check reads local n8n credential
   metadata; it executes zero jobs. Start begins claiming owner-requested setup
   jobs. A worker heartbeat confirms transport, not inquiry/email delivery.
   Existing workflows and credentials are retained. Different installed config
   is refused so an encrypted pending journal cannot become unreadable.

The worker must be started again after this container restarts. Run the `-Start`
command; an OS socket inside the container prevents duplicate workers. Docker,
this PC and its network must stay on for automation to run. This test arrangement
does not establish unattended hosted availability.

## Two-business acceptance test

Keep the incomplete manual Business 2 copy inactive. Use the second CRM owner
and that owner's separate controlled Google account, with automatic emails off.
Connect Google through the public site and inspect the actual new Sheet, exact
Leads/ReplyReviews headers and empty rows. Confirm all new Gmail/Sheets/CRM
bindings are separate from ClearFlow; only the approved operator Gemini service
is shared. Then confirm the inbox and enable processing.

Wait for real public CRM sync/sender checks. Send a fresh inquiry yourself from a
controlled mailbox. Verify it appears in only this business's Inbox, Leads and
AI Drafts plus this Sheet. Edit internal notes, wait for Applied, and check the
Sheet. Approve a draft, then separately confirm its recipient/content before a
controlled delivery test. Approval alone must never show Sent.

Sign into both owners separately and verify no cross-business records, activity,
reports, tokens, Sheet links or connection state. Pause Business 2 and confirm
only its workflow stops. Restart Docker, start the worker again, and verify state
and credentials survive. A simulated test result does not complete these steps.

## Failure handling

Queued work remains saved while the PC is off. Claim IDs, database CAS and an
encrypted local journal prevent repeated creates after lost responses. Once a
mutation starts, a crash becomes **Needs attention**, without automatic replay.
Lost result callbacks retry only the stored result. Never delete `journal.enc`,
rotate its key, or blindly reset a connection to clear an uncertain operation.
Inspect the corresponding resource and reconcile it before continuing.

Run `pnpm test:connections`, `pnpm test:tenants`, TypeScript and the build from
`templates/leads`. `scripts/check-connections.mjs` exercises isolated browser/API
flows. Google, Gmail delivery and n8n setup are simulated in these tests; real
owner consent and the live acceptance test remain separate checkpoints.
