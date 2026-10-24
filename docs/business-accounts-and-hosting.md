# Business accounts and automation hosting

Maintainer handover, reviewed 22 October 2026 (Singapore). Keep account setup and hosting instructions outside the customer's daily dashboard.

## What is already hosted

The current website runs on Vercel. Supabase stores application logins and the migrated CRM records. The reviewed combined Gemini automation has 128 nodes and still belongs to the existing local n8n Docker installation. A website deployment does not start that installation.

When Docker/n8n is stopped, cloud sign-in and saved CRM records can remain available, but local email scanning, form intake, Sheets write-back, confirmed sending and follow-ups stop. Queuing a reply or approving its text does not prove delivery.

The 21 October deployment was one shared ClearFlow business. Its invited staff accounts saw the same records and used the same connected Gmail and Sheet. The current account release uses **immediate signup without an email confirmation**, as explicitly selected by the owner. It requires the private-workspace migration, the matching Supabase authentication policy and a new application deployment. Code preparation does not apply SQL or change the platform policy. It does not move or start n8n.

## What a new business account means

After this release is applied, a person supplies a business name, email and password. Supabase creates the account and session; the app validates that session, creates the person's empty business workspace and opens the dashboard immediately. No signup confirmation email is sent. The email address is not proven to belong to the person: the owner explicitly chose that tradeoff. Supabase automatically marks the new account confirmed under this project policy. Existing ClearFlow memberships and records stay with ClearFlow; server-checked membership determines access to business records. [Supabase authentication settings](https://supabase.com/docs/guides/auth/general-configuration)

Supabase is already the application's database. Supabase Auth stores account identities and password hashes; private CRM state and workspace memberships live in the same project. A custom plaintext-password table is unnecessary. [Supabase password storage](https://supabase.com/docs/guides/auth/password-security)

The intended separation covers leads, messages, drafts, tasks, settings, activity, sync queues, send jobs, reports and uploaded files. A new business must not inherit ClearFlow's customers, pending emails, saved business facts or samples. Existing users keep their existing workspace rather than creating another copy of it on each sign-in.

Creating an account does **not** connect the person's Gmail, copy their inbox, create a Google Sheet or authorize an email. For unattended processing, each business still needs a separately configured automation connection using that business's Gmail authorization, Sheet and Gemini configuration. The business's CRM automation token must select only its own workspace. Never give a new business ClearFlow's legacy integration secret or reuse ClearFlow's bound workflow export as their ready-to-run installation.

The current dashboard does not provide a complete self-service Google OAuth connection and automation-provisioning product. A maintainer must prepare and verify each business's connection. Customers can then use the normal business controls without editing n8n nodes.

## Apply the account release safely

1. Retain the existing Vercel project and Supabase project. Record the current Production deployment so application rollback is available. Make a private consistent backup of the existing CRM, membership/configuration tables and private files. If n8n is off, leave it off while preparing this change.
2. In the existing Supabase SQL Editor, run [202610220001_crm_private_workspaces.sql](../supabase/migrations/202610220001_crm_private_workspaces.sql). Its prerequisites are the already-applied [workspace access migration](../supabase/migrations/202610200001_crm_workspace_access.sql) and [cloud storage migration](../supabase/migrations/202610210001_crm_cloud_storage.sql). It retains the legacy ClearFlow state and adds private workspace/token support. Do not re-import the old local CRM snapshot, reset the database or run the sample-data import.
3. Verify the existing `clearflow` membership and workspace state remain present. New workspace IDs must be distinct. Keep the server-only Supabase key private; browser access must still use the publishable key and the authenticated application routes.
4. Deploy this release to the existing Vercel project, using Root Directory `templates/leads` and the existing Production environment. Preserve `CRM_STORAGE_BACKEND=supabase`, the matching Supabase URL/keys and the existing private `N8N_WEBHOOK_SECRET`. Environment edits require a new deployment. Do not commit `.env.local` or private workflow exports.
5. Configure immediate signup as below. Test with two addresses you control. Confirm signup opens each empty workspace directly, no confirmation email is sent, each sees only its own saved changes, signing out denies CRM access and the original owner still sees the preserved ClearFlow records. Check direct record/report/file requests as well as the page list.
6. Test the old authenticated ClearFlow automation connection and a new business's separate connection without sending mail. Keep new automations inactive until their workspace/token, Gmail account and Sheet are verified. Perform a controlled live send only with an explicit owner confirmation.

Code pushed to GitHub, a successful build, applied SQL and a verified live deployment are separate checkpoints. Record which ones actually completed. If Vercel deploys automatically from `main`, apply the compatible database migration before routing users to the new signup behavior; verify the deployed build after the push.

## Enable immediate signup

The latest read-only check found the private-workspace migration installed and
signup enabled, with Confirm Email still on. The required remaining policy change
is **Confirm Email off**. This code release does not toggle the dashboard setting.

1. Open the existing Supabase project ? **Authentication ? Sign In / Providers ? Email**. Keep email/password signup enabled and turn **Confirm Email off**, then save. This replaces the earlier confirmation-required setup. The app checks this setting before calling signup; while confirmation is still on it returns `AUTH_SIGNUP_POLICY` without creating an account or requesting a signup email. [Supabase settings](https://supabase.com/docs/guides/auth/general-configuration)
2. Apply the workspace SQL and retain the five Production Vercel environment variables described above. Deploy the latest main-branch code.
3. Use the public Production address, currently [the -oyh1 CRM login](https://ai-customer-lead-crm-system-oyh1.vercel.app/login). A read-only check confirmed the previous long deployment-specific address redirects to Vercel's own sign-in, while this Production address serves the CRM publicly. Customers should use the public CRM address and create only a CRM account. [Vercel Authentication](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication)
4. Choose **Create an account**, enter a new controlled email/business/password and submit. Expect the dashboard to open immediately with an empty workspace and no confirmation email. Refresh to verify persistence, sign out, and test ordinary email/password sign-in.
5. Repeat with another controlled account and verify each business's records remain private. Existing users should use **Sign in**; duplicate signup never signs someone into an existing account.

The project still checks the actual Supabase session and admin-managed membership. It never grants ClearFlow access based only on an email or copies ClearFlow integrations. The existing SQL's confirmation timestamp is set automatically by Supabase when Confirm Email is off; it is not evidence of an inbox verification step.

Password recovery remains a separate email action. Keep the public Production Site URL and reset/invite redirect URLs in **Authentication ? URL Configuration**. Configure custom SMTP before relying on password-reset emails to external users. Existing confirmation links remain supported for accounts from the earlier flow. No SMTP sender is needed solely for new immediate signup. [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp)

### If Create account returns HTTP 503

Failures include a safe `code` and `requestId`; Vercel Runtime Logs record action/phase without passwords, emails or keys.

- `AUTH_SIGNUP_POLICY`: Confirm Email is still on, policy could not match the signup session, or the provider changed settings during signup. Save the immediate-signup policy first.
- `AUTH_CONFIGURATION`: Auth settings or shared database quotas are unavailable. Verify the Production environment, including `CRM_STORAGE_BACKEND=supabase` and the matching server-only key. Editing local `.env.local` does not update Vercel; redeploy after environment changes. [Vercel environment changes](https://vercel.com/docs/environment-variables/managing-environment-variables)
- `AUTH_WORKSPACE_SETUP`: The workspace readiness check failed. Apply the private-workspace migration and verify server database access before creating accounts.
- `AUTH_WORKSPACE_UNAVAILABLE`: The account exists but opening/provisioning its workspace failed. The app clears the incomplete session. Restore database access and use **Sign in**; do not repeatedly create the same account.
- `AUTH_SIGNUP_DISABLED`: Signup or the email/password provider is disabled.
- `AUTH_RATE_LIMIT` (HTTP 429): Wait before retrying.
- `AUTH_EMAIL_SETUP`: An explicitly requested email action, such as password recovery, needs its sender configured. New immediate signup does not depend on confirmation mail.
- `AUTH_UNAVAILABLE`: A temporary provider or network error; the message names the attempted action.

The isolated automated checks use fake Auth/Storage and real embedded PostgreSQL. They prove app behavior and workspace separation, not that a live platform toggle has been changed or a live email has been delivered.

## Connect one new business's automation

This is maintainer work. The customer dashboard asks the business to contact support while its connection is being prepared; it does not display a token-generation interface.

1. Complete verified signup and the first sign-in so the new empty workspace exists. In Supabase, find that account's `workspace_id` in `crm_workspace_members`. It must be the new UUID, not `clearflow`. Keep ClearFlow's original environment secret unchanged.
2. From the repository root, review the token-creation plan using the existing private server environment. Replace the example UUID before running:

   ```powershell
   & .\.local-tools\node-v22.23.3-win-x64\node.exe --env-file=templates/leads/.env.local --experimental-strip-types .\scripts\configure-business-automation.mjs --workspace "NEW-BUSINESS-WORKSPACE-UUID"
   ```

3. After confirming the selected business, run the same command with `--apply`. The tool generates a new credential in ignored private storage at `private-integrations/business-connections/<UUID>-<timestamp>.json`; it prints only the path/status. Supabase stores the token's SHA-256 hash. Open the private file locally and copy its `authorization` value into a new n8n **Header Auth** credential: header name `Authorization`, value `Bearer …`. Never paste the token into chat, GitHub or a public guide.
4. Configure a separate inactive workflow for that business. Use its new CRM Header Auth credential on every CRM request, the existing Vercel Production origin, its own Gmail/Sheets credentials, its own spreadsheet and Gemini connection, and a distinct form identity. A token selects the CRM workspace; it does not select the Google account or change the Sheet ID inside n8n. Retain the independent schedule paths.
5. Verify read-only CRM health/configuration and Google profile/Sheet access first. Confirm the business's new records reach only its dashboard and Sheet. Keep automatic email switches off until verified business facts, permissions and controlled tests are complete. No workflow activation or email is performed by the token tool.

For an existing connection, the tool refuses replacement unless `--rotate` accompanies `--apply`. Rotation immediately invalidates the old token. Pause affected processing, generate the replacement privately, update every relevant CRM credential binding and verify before resuming. Keep the private credential file in protected backup storage; its raw token cannot be recovered from the database hash.

## Can the automation run 24/7 for free without a card?

No hosted workload has been verified for this account that meets all four requirements: no card, no recurring hosting charge, durable n8n data and unattended operation around the clock. On 24 October the owner deferred hosting and chose the public Vercel CRM with existing local Docker n8n. Follow [the local multi-business setup](local-docker-multi-user.md). Northflank's card requirement already stopped that route; Oracle's card requirement was declined.

Official plan checks on 22 October 2026:

| Option | Relevant condition | Use here |
| --- | --- | --- |
| ClawCloud Run | Official discontinuation notice set 11 May 2026 for free-service shutdown. Earlier credit guidance was stale. [Discontinuation notice](https://question.run.claw.cloud/questions/10010000000003261) | Removed as a candidate. `clawcloud.sh` is a different paid OpenClaw product. |
| Render Free | Sleeps after 15 minutes without inbound traffic; local filesystem changes disappear on restart/sleep; no free persistent disk. Its free PostgreSQL expires after 30 days. [Official limits](https://render.com/docs/free) | Practice preview; does not meet this automation's continuous schedules/storage needs. |
| blitz.cloud Free | Advertises no card and persistent app files, but n8n sleeps after 30 minutes without visitors; free webhooks do not wake it. [Official n8n page](https://blitz.cloud/apps/n8n/), [file persistence](https://blitz.cloud/docs/settings-and-files/) | Possible temporary practice only. Its free plan does not provide unattended n8n operation. |
| Railway Free/trial | Trial is up to 30 days/$5, then $1 monthly credit; free RAM and volume limits are each 0.5 GB. Account verification can restrict outbound access. [Plans](https://docs.railway.com/pricing/plans), [trial conditions](https://docs.railway.com/pricing/free-trial) | A limited experiment, with no verified budget fit for this workflow. Continuous 0.25 GB RAM alone is approximately $2.50/month at its published memory rate, before CPU/storage. |
| Koyeb | Its current signup FAQ requires a card. [Official FAQ](https://www.koyeb.com/docs/faqs/pricing) | Does not meet the no-card preference. |
| n8n Cloud trial | No card for the Cloud trial; time/usage limited, then paid. [Official pricing](https://n8n.io/pricing/) | Temporary evaluation, not a permanent free host. |

### Current next step: test with local Docker

The website stays on the stable public Vercel domain. The new outbound setup
worker connects this computer to the CRM without a public n8n port or tunnel.
Use [local Docker multi-business setup](local-docker-multi-user.md); real Google
consent, separate business bindings, Production SQL/environment and live inquiry
verification remain required. No hosting signup is needed for this test.

The reviewed workflow has two minute timers, a five-minute inbox timer and an hourly follow-up timer. That is approximately **95,760 scheduled starts in 30 days**, before forms and manual runs. This is arithmetic from the saved schedule, not measured billing. Execution-limited hosting must account for idle polls as well as customer emails; the smallest n8n Cloud quotas do not fit that cadence.

For now, the existing no-hosting-charge route is the current PC with Docker/n8n running. A sleeping/off PC stops processing. If continuous service without the PC is required, choose an always-on persistent host whose actual plan and account eligibility fit, or revisit the budget/card preference. Do not use artificial keep-alive traffic to describe a sleeping free service as guaranteed 24/7 hosting.

Before using the current Vercel Hobby deployment commercially, review its plan: Hobby is for personal, non-commercial use. The earlier personal-demo deployment decision does not establish eligibility for a commercial service offered to other businesses. [Vercel Hobby rules](https://vercel.com/docs/plans/hobby)

## Move the existing automation after a host is selected

1. Back up n8n's complete `.n8n` data directory, original credential encryption configuration and any external database/files. Stop SQLite writers for a filesystem copy, or use a supported consistent snapshot. Workflow JSON alone cannot recover working credentials. [n8n backup instructions](https://docs.n8n.io/deploy/host-n8n/keep-n8n-running/backup-and-restore)
2. Restore to an inactive hosted copy at the existing version. Keep the original credentials and form identity. A new business instead needs a clean separate configuration, its own credentials and its own CRM token. Never publish two copies processing the same business inbox/queues.
3. Keep the dashboard and records on existing Vercel/Supabase. In the hosted workflow, replace local CRM origins, including **Bridge settings**, with the actual Vercel Production origin, preserving `/api/n8n/…` paths. A cloud host cannot reach this PC through `host.docker.internal`.
4. Configure the host's HTTPS n8n address and persistent storage before activation. For the reviewed n8n version, use `WEBHOOK_URL`, `N8N_EDITOR_BASE_URL`, `N8N_HOST`, `N8N_PROTOCOL=https` and internal port `5678`; configure trusted proxy hops for the actual network. [n8n reverse-proxy configuration](https://docs.n8n.io/deploy/host-n8n/configure-n8n/basic-configuration/configuration-examples/configure-webhook-urls-with-reverse-proxy)
5. Add the exact hosted Google OAuth callback displayed by the credential editor to Google Cloud. Verify Gmail profile/labels, Sheet reads, CRM authenticated health/configuration and the manual system check before processing mail.
6. Let old executions finish and stop the corresponding local schedules. Publish the hosted combined copy once. Keep replaced helper workflows inactive. Update the business's public customer-form link to the hosted form Production URL.
7. With the PC's local processing off, use controlled inboxes to prove form/email capture, AI suggestions, owner-edit sync and a separately confirmed reply. Confirm records/credentials survive a host restart. A consented follow-up still needs a due time and all eligibility checks; do not force it by replaying a send node.

The existing `deploy/customerlead` Compose files describe an earlier alternative that also hosts the local-storage CRM. They are not a direct n8n-only launch command for the selected Vercel/Supabase arrangement. Use the host's actual deployment model rather than restoring an outdated CRM snapshot.

## n8n licensing when other businesses use the dashboard

Review the architecture against n8n's current rules before offering it as a service. Its updated official FAQ permits prebuilt background workflows and customer-owned account connections when the operator controls workflow logic. It requires a commercial license when external users can build/configure workflows, including through a custom interface or API, or when n8n itself is hosted/white-labelled as the product. Account ownership alone is not the deciding test. [Current license FAQ](https://docs.n8n.io/n8n-community-license/community-license/license-faq), [official help article](https://support.n8n.io/article/can-i-use-your-license-for-my-use-case)

This CRM's signup feature does not grant n8n editor access or settle commercial license eligibility. If business preferences or a future connection builder let customers configure workflow logic, or n8n is bundled into a paid customer installation, describe the exact arrangement to `license@n8n.io` before launch. Hosting fees, n8n licensing, authentication email delivery and Google/Gemini quotas are separate considerations.
