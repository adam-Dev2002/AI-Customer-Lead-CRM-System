# Business accounts and automation hosting

Maintainer handover, reviewed 22 October 2026 (Singapore). Keep account setup and hosting instructions outside the customer's daily dashboard.

## What is already hosted

The current website runs on Vercel. Supabase stores application logins and the migrated CRM records. The reviewed combined Gemini automation has 128 nodes and still belongs to the existing local n8n Docker installation. A website deployment does not start that installation.

When Docker/n8n is stopped, cloud sign-in and saved CRM records can remain available, but local email scanning, form intake, Sheets write-back, confirmed sending and follow-ups stop. Queuing a reply or approving its text does not prove delivery.

The 21 October deployment was one shared ClearFlow business. Its invited staff accounts saw the same records and used the same connected Gmail and Sheet. The private-business account changes in this release require the database migration, Supabase signup/email configuration and a new application deployment before they are available on the existing website. Applying that SQL, configuring SMTP and proving external signup delivery have not been completed by preparing this release. It does not itself move or start n8n.

## What a new business account means

After this release is applied, a person can create an account with their email, confirm that address and sign in. A verified account without an existing membership receives its own empty business workspace. Existing ClearFlow memberships and records stay with ClearFlow. A different email address is an identity; the server's workspace membership determines which business records that identity may access.

The intended separation covers leads, messages, drafts, tasks, settings, activity, sync queues, send jobs, reports and uploaded files. A new business must not inherit ClearFlow's customers, pending emails, saved business facts or samples. Existing users keep their existing workspace rather than creating another copy of it on each sign-in.

Creating an account does **not** connect the person's Gmail, copy their inbox, create a Google Sheet or authorize an email. For unattended processing, each business still needs a separately configured automation connection using that business's Gmail authorization, Sheet and Gemini configuration. The business's CRM automation token must select only its own workspace. Never give a new business ClearFlow's legacy integration secret or reuse ClearFlow's bound workflow export as their ready-to-run installation.

The current dashboard does not provide a complete self-service Google OAuth connection and automation-provisioning product. A maintainer must prepare and verify each business's connection. Customers can then use the normal business controls without editing n8n nodes.

## Apply the account release safely

1. Retain the existing Vercel project and Supabase project. Record the current Production deployment so application rollback is available. Make a private consistent backup of the existing CRM, membership/configuration tables and private files. If n8n is off, leave it off while preparing this change.
2. In the existing Supabase SQL Editor, run [202610220001_crm_private_workspaces.sql](../supabase/migrations/202610220001_crm_private_workspaces.sql). Its prerequisites are the already-applied [workspace access migration](../supabase/migrations/202610200001_crm_workspace_access.sql) and [cloud storage migration](../supabase/migrations/202610210001_crm_cloud_storage.sql). It retains the legacy ClearFlow state and adds private workspace/token support. Do not re-import the old local CRM snapshot, reset the database or run the sample-data import.
3. Verify the existing `clearflow` membership and workspace state remain present. New workspace IDs must be distinct. Keep the server-only Supabase key private; browser access must still use the publishable key and the authenticated application routes.
4. Deploy this release to the existing Vercel project, using Root Directory `templates/leads` and the existing Production environment. Preserve `CRM_STORAGE_BACKEND=supabase`, the matching Supabase URL/keys and the existing private `N8N_WEBHOOK_SECRET`. Environment edits require a new deployment. Do not commit `.env.local` or private workflow exports.
5. Configure signup and confirmation delivery as below. Test with two addresses you control. Confirm each new account starts empty, each sees only its own saved changes, signing out denies CRM access and the original owner still sees the preserved ClearFlow records. Check direct record/report/file requests as well as the page list.
6. Test the old authenticated ClearFlow automation connection and a new business's separate connection without sending mail. Keep new automations inactive until their workspace/token, Gmail account and Sheet are verified. Perform a controlled live send only with an explicit owner confirmation.

Code pushed to GitHub, a successful build, applied SQL and a verified live deployment are separate checkpoints. Record which ones actually completed. If Vercel deploys automatically from `main`, apply the compatible database migration before routing users to the new signup behavior; verify the deployed build after the push.

## Enable Supabase email signup

### If Create account returns HTTP 503

The application now returns a safe `code` and `requestId` with failures. Vercel
Runtime Logs include that reference, action and phase, without passwords, email
addresses or keys. A signup error must not be treated as successful account creation.

1. Open the existing Vercel project's **Production deployment → Visit**, rather
   than retaining a deployment-specific URL. The URL supplied during the 22 October
   investigation was protected by Vercel sign-in, so its runtime logs/settings
   could not be inspected from the public site.
2. Check **Settings → Environment Variables → Production** for all five existing
   values: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `CRM_STORAGE_BACKEND=supabase`, `SUPABASE_SECRET_KEY`, and `N8N_WEBHOOK_SECRET`.
   Copy the matching private values locally; do not paste them into chat. Saving
   `.env.local` on your PC does not update Vercel. Redeploy after changing variables.
   Keep live secrets out of Preview environments. [Vercel environment changes](https://vercel.com/docs/environment-variables/managing-environment-variables)
3. `AUTH_CONFIGURATION` means the Auth client or shared database limits are
   unavailable. Check the phase in Runtime Logs and the Production environment
   before retrying. This is distinct from `AUTH_RATE_LIMIT` (HTTP 429).
4. `AUTH_WORKSPACE_SETUP` means the read-only workspace readiness check failed.
   Apply the new private-workspace migration above and verify server database
   access. A read-only check on 22 October found email signup and confirmation
   enabled, but `crm_provision_workspace` was absent and the attempted signup
   account had not been created. The release now checks workspace setup before
   asking Supabase to create an account.
5. `AUTH_EMAIL_SETUP` means confirmation/reset email delivery needs configuration;
   use the SMTP steps below. `AUTH_SIGNUP_DISABLED` means signup is disabled at the
   provider. `AUTH_UNAVAILABLE` covers temporary provider/network errors and has
   action-specific wording. Do not disable email confirmation or insert a new
   user into ClearFlow to work around these failures.

After setup, make one registration attempt using your controlled address, confirm
the email and sign in. Verify its workspace is empty and separate from ClearFlow.
The automated failure checks use simulated email only; they do not establish that
the live SMTP sender is configured or that a real confirmation email was delivered.

Use the existing project's Supabase Dashboard. These are application logins, separate from GitHub, Vercel, Supabase Dashboard and n8n editor accounts.

1. Open **Authentication → Sign In / Providers → Email**. Enable email/password sign-in and **Allow new users to sign up**. Leave **Confirm Email** on. Supabase's hosted email/password signup normally requires confirmation; disabling confirmation assumes an address is already verified. [Supabase configuration](https://supabase.com/docs/guides/auth/general-configuration), [password signup](https://supabase.com/docs/guides/auth/passwords)
2. Open **Authentication → URL Configuration**. Set **Site URL** to the actual Vercel Production origin. Add the application's exact Production `/auth/confirm?type=signup`, `/auth/callback` and `/auth/callback?next=/update-password` redirect URLs. Retain local callbacks only when still needed. Use a stable Production address in real confirmation/reset emails. [Redirect configuration](https://supabase.com/docs/guides/auth/redirect-urls)
3. Configure **Authentication → Email → SMTP Settings** with your email provider's host, port, username, password and verified sender address. Publish the sender-domain DNS records required by that provider. Keep the password private. Supabase's built-in sender delivers only to organization team addresses, currently permits two messages per hour and offers best-effort delivery; it cannot support arbitrary business signup emails. Use custom SMTP or a separately implemented Send Email hook for real users. Do not disable email confirmation as a workaround. [Supabase SMTP requirements](https://supabase.com/docs/guides/auth/auth-smtp) The existing n8n Gmail OAuth credential does not configure this separate authentication-email service.
4. Check the **Confirm signup** template against the release's confirmation handler. For the existing token-hash handler, use the actual Production origin, for example:

   ```html
   <a href="https://YOUR-PRODUCTION-ORIGIN/auth/confirm?token_hash={{ .TokenHash }}&type=signup">Confirm email</a>
   ```

   Keep recovery links on `/auth/confirm` with `type=recovery` and invitation links with `type=invite`. Confirmation/reset links are private and one-time. Test the actual rendered email and link, including expiry/error handling.
5. Create one controlled account from the public login page. Verify the email arrives, confirmation returns to the correct website, signing in opens its empty business and password recovery works. Check Supabase Auth logs and the SMTP provider's delivery log if mail is absent. Saving SMTP settings alone is not proof of delivery.

Supabase Free has its own usage limits and currently pauses inactive projects after a week; a free database is not an uptime guarantee. Keep independent backups and review actual usage before a wider launch. [Supabase pricing](https://supabase.com/pricing)

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

No hosted workload has been verified for this account that meets all four requirements: no card, no recurring hosting charge, durable n8n data and unattended operation around the clock. **ClawCloud Run is a conditional candidate to check next.** Northflank's card requirement already stopped that route; Oracle's card requirement was declined. The website can stay on Vercel while n8n is hosted separately.

Official plan checks on 22 October 2026:

| Option | Relevant condition | Use here |
| --- | --- | --- |
| ClawCloud Run Free | Advertises $5 recurring monthly credits for eligible GitHub accounts older than 180 days; its launch announcement says no card for Free. Credits fund metered resources. [Pricing](https://run.claw.cloud/pricing), [eligibility FAQ](https://docs.run.claw.cloud/clawcloud-run/faq), [announcement](https://blog.run.claw.cloud/88/) | Candidate for a small n8n installation. This account's GitHub age meets the published threshold; actual grant, regional availability, persistence and workload cost remain unverified. |
| Render Free | Sleeps after 15 minutes without inbound traffic; local filesystem changes disappear on restart/sleep; no free persistent disk. Its free PostgreSQL expires after 30 days. [Official limits](https://render.com/docs/free) | Practice preview; does not meet this automation's continuous schedules/storage needs. |
| blitz.cloud Free | Advertises no card and persistent app files, but n8n sleeps after 30 minutes without visitors; free webhooks do not wake it. [Official n8n page](https://blitz.cloud/apps/n8n/), [file persistence](https://blitz.cloud/docs/settings-and-files/) | Possible temporary practice only. Its free plan does not provide unattended n8n operation. |
| Railway Free/trial | Trial is up to 30 days/$5, then $1 monthly credit; free RAM and volume limits are each 0.5 GB. Account verification can restrict outbound access. [Plans](https://docs.railway.com/pricing/plans), [trial conditions](https://docs.railway.com/pricing/free-trial) | A limited experiment, with no verified budget fit for this workflow. Continuous 0.25 GB RAM alone is approximately $2.50/month at its published memory rate, before CPU/storage. |
| Koyeb | Its current signup FAQ requires a card. [Official FAQ](https://www.koyeb.com/docs/faqs/pricing) | Does not meet the no-card preference. |
| n8n Cloud trial | No card for the Cloud trial; time/usage limited, then paid. [Official pricing](https://n8n.io/pricing/) | Temporary evaluation, not a permanent free host. |

### Next step: check ClawCloud without moving existing data

The [public GitHub account record](https://api.github.com/users/adam-Dev2002) for `adam-Dev2002` has creation time **9 January 2025**, so it is over 180 days old on this review date. This satisfies the published age prerequisite; it does not prove ClawCloud will allocate the credit to this account. No ClawCloud account or server has been created by this work.

1. Open [ClawCloud Run](https://run.claw.cloud/) and sign in with that existing GitHub account. Choose **Free**, not a paid subscription. Check Account Center/Billing for the actual recurring **$5 monthly Gift Credits**, the reset date and usable region. If eligibility, payment requirements or available credit differ, stop before deployment and retain the existing setup.
2. Use the console's resource estimate for **one** n8n instance and its persistent data volume. At the posted monthly rates, 0.5 CPU + 1 GB RAM + 2 GB storage is approximately **$4.24/month**, before traffic or other resources. This is an arithmetic estimate, not a measured running cost or a confirmed price for this account. Check the actual total, renewal periods and margin; more memory or another database can exceed the credit. [Published resource rates](https://run.claw.cloud/pricing)
3. Confirm the selected app can remain running without visitors and that `/home/node/.n8n` is persistent across replacement/restart. Exhausting credit prevents services from starting; its grace period preserves resources temporarily, then clears them after seven days. Keep independent backups and monitor the balance. [Billing and retention policy](https://docs.run.claw.cloud/clawcloud-run/billing-and-usage) Monthly gift credits also expire rather than accumulating. [Credit FAQ](https://docs.run.claw.cloud/clawcloud-run/faq)
4. Once the plan and restore method are established, follow the inactive-copy migration below. **Do not launch an empty n8n template over the saved database** or allow it to generate a replacement credential encryption key. Keep original backups off the host and compare restored IDs/credentials before activation.

The reviewed workflow has two minute timers, a five-minute inbox timer and an hourly follow-up timer. That is approximately **95,760 scheduled starts in 30 days**, before forms and manual runs. This is arithmetic from the saved schedule, not measured billing. Execution-limited hosting must account for idle polls as well as customer emails; the smallest n8n Cloud quotas do not fit that cadence.

For now, the existing no-hosting-charge route is the current PC with Docker/n8n running. A sleeping/off PC stops processing. If continuous service without the PC is required, choose an always-on persistent host whose actual plan and account eligibility fit, or revisit the budget/card preference. Do not use artificial keep-alive traffic to describe a sleeping free service as guaranteed 24/7 hosting.

Before using the current Vercel Hobby deployment commercially, review its plan: Hobby is for personal, non-commercial use. The earlier personal-demo deployment decision does not establish eligibility for a commercial service offered to other businesses. [Vercel Hobby rules](https://vercel.com/docs/plans/hobby)

## Move the existing automation after a host is selected

1. Back up n8n's complete `.n8n` data directory, original credential encryption configuration and any external database/files. Stop SQLite writers for a filesystem copy, or use a supported consistent snapshot. Workflow JSON alone cannot recover working credentials. [n8n backup instructions](https://docs.n8n.io/deploy/host-n8n/keep-n8n-running/backup-and-restore)
2. Restore to an inactive hosted copy at the existing version. Keep the original credentials and form identity. A new business instead needs a clean separate configuration, its own credentials and its own CRM token. Never publish two copies processing the same business inbox/queues.
3. Keep the dashboard and records on existing Vercel/Supabase. In the hosted workflow, replace local CRM origins, including **Bridge settings**, with the actual Vercel Production origin, preserving `/api/n8n/…` paths. A cloud host cannot reach this PC through `host.docker.internal`.
4. Configure the host's HTTPS n8n address and persistent storage before activation. For the reviewed n8n version, use `N8N_WEBHOOK_URL`, `N8N_EDITOR_BASE_URL`, `N8N_HOST`, `N8N_PROTOCOL=https` and internal port `5678`; configure trusted proxy hops for the actual network. [n8n reverse-proxy configuration](https://docs.n8n.io/deploy/host-n8n/configure-n8n/basic-configuration/configuration-examples/configure-webhook-urls-with-reverse-proxy)
5. Add the exact hosted Google OAuth callback displayed by the credential editor to Google Cloud. Verify Gmail profile/labels, Sheet reads, CRM authenticated health/configuration and the manual system check before processing mail.
6. Let old executions finish and stop the corresponding local schedules. Publish the hosted combined copy once. Keep replaced helper workflows inactive. Update the business's public customer-form link to the hosted form Production URL.
7. With the PC's local processing off, use controlled inboxes to prove form/email capture, AI suggestions, owner-edit sync and a separately confirmed reply. Confirm records/credentials survive a host restart. A consented follow-up still needs a due time and all eligibility checks; do not force it by replaying a send node.

The existing `deploy/customerlead` Compose files describe an earlier alternative that also hosts the local-storage CRM. They are not a direct n8n-only launch command for the selected Vercel/Supabase arrangement. Use the host's actual deployment model rather than restoring an outdated CRM snapshot.

## n8n licensing when other businesses use the dashboard

Review the architecture against n8n's current rules before offering it as a service. Its updated official FAQ permits prebuilt background workflows and customer-owned account connections when the operator controls workflow logic. It requires a commercial license when external users can build/configure workflows, including through a custom interface or API, or when n8n itself is hosted/white-labelled as the product. Account ownership alone is not the deciding test. [Current license FAQ](https://docs.n8n.io/n8n-community-license/community-license/license-faq), [official help article](https://support.n8n.io/article/can-i-use-your-license-for-my-use-case)

This CRM's signup feature does not grant n8n editor access or settle commercial license eligibility. If business preferences or a future connection builder let customers configure workflow logic, or n8n is bundled into a paid customer installation, describe the exact arrangement to `license@n8n.io` before launch. Hosting fees, n8n licensing, authentication email delivery and Google/Gemini quotas are separate considerations.
