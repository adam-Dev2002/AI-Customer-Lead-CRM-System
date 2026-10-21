# Personal project: Vercel, Supabase and hosted n8n

Reviewed 21 October 2026, Singapore time. This is a setup guide, not a completed
deployment. It uses your existing Vercel and Supabase accounts. Your requirements
are personal use, no payment card and operation without this PC staying on.
The earlier Oracle route is not the selected route.

## What each service does

| Service | Its job | Current position |
| --- | --- | --- |
| Vercel Hobby | Website and its Next.js API routes | Existing account; this CRM has not been deployed there. |
| Existing Supabase project | Sign-in, cloud CRM records and private reports | Cloud storage is implemented and the existing workspace has been imported. |
| Northflank Sandbox | Run n8n continuously, with a PostgreSQL database for its saved workflows and credentials | Candidate no-card host; account eligibility, free resources and actual workload fit still need checking. |

For personal, non-commercial use, Vercel Hobby is suitable within its limits.
Northflank advertises a no-card free tier with always-on compute, two services
and one database. The n8n template includes PostgreSQL, but a template's default
resource choices are not proof of a zero bill. Confirm free resource selections
and the actual estimate before creating anything. Free services do not provide
a guaranteed uptime commitment for this project.

Sources: [Vercel Hobby](https://vercel.com/docs/plans/hobby),
[Northflank free signup](https://northflank.com/blog/how-to-deploy-vibe-coded-v0-apps-to-production),
[Northflank pricing](https://northflank.com/pricing),
[n8n template](https://northflank.com/stacks/deploy-n8n).

Supabase Free currently includes a 500 MB database and 1 GB file storage; inactive
free projects pause after one week. Google/Gemini quotas apply separately.
[Supabase limits](https://supabase.com/pricing).

## 1. Confirm the existing Supabase login

1. Open [your existing Supabase project](https://supabase.com/dashboard/project/ygxpxmntcjhmjxfzuaqt).
2. Open Authentication → Users. Confirm your existing application login exists;
   do not recreate or reset it if it already works.
3. Open Table Editor and look for `crm_workspace_members`. Your login should have
   an owner membership for `clearflow`.
4. If either is missing, use the existing instructions in
   [login-and-assistant.md](login-and-assistant.md), including the reviewed SQL
   files in `supabase`. That migration grants workspace access; it does not move
   customer records into Supabase.
5. Keep the current local URLs while using the local app. Add the real Vercel
   URLs after deployment, as described in step 5 below.

Supabase is already cloud-hosted. You do not need to install or host Supabase on
this PC or on Vercel.

## 2. Supabase storage — completed for this workspace

**Completed 21 October 2026:** 33 leads, 11 drafts, all saved settings, consent,
approvals, delivery/replay state, 51 sync-history entries and 33 private files
were imported and compared with the original. The local app now uses Supabase.
The original private data and a full pre-import backup were retained.

CRM records now live in `public.crm_workspace_state`, inside its `data` JSONB
field. It is one complete workspace row, preserving all the existing record IDs
and relationships. Supabase Table Editor therefore shows one workspace row;
the application's Leads page still shows the individual leads. Private reports
and server configuration live in the **private** `crm-private` Storage bucket.
Browser access to the state table/RPCs is denied; the server checks workspace
membership before using its private key.
[Vercel file guidance](https://vercel.com/kb/guide/how-can-i-use-files-in-serverless-functions).

The implementation includes:

- Database revision checks and idempotent commit receipts, protecting concurrent
  edits, automation callbacks and delivery claims across server instances.
- Insert-only migration and file verification, refusing to overwrite a different
  existing cloud workspace. Cloud outages never fall back to a seeded local CRM.
- Private report downloads, immutable report-mail attachments, and packaged
  serverless Chromium for Vercel PDF generation.
- Migrated private assistant, Google Contacts and form configuration. Their
  existing environment overrides remain available.
- Shared database quotas for login, assistant, uploads and report actions.
- Isolated real-PostgreSQL concurrency/access tests, complete CRM and report
  browser flows, and a Linux production/serverless-browser check.

The SQL setup file is `supabase/migrations/202610210001_crm_cloud_storage.sql`.
The insert-only import tool is `scripts/migrate-crm-to-supabase.mjs`; its default
mode only prints a plan. You already completed this import: **do not re-import
the old local snapshot after new cloud edits**. The `.data` directory is now a
retained source/backup, not the live cloud workspace.

The existing Docker/Compose kit remains an alternative persistent-server route;
Vercel uses the normal Next.js build, not that Docker image.

## 3. Prepare the no-card n8n host

You can check account eligibility while the application work is pending:

1. Open [Northflank](https://app.northflank.com/) and create your own account.
2. Choose the free Sandbox option. If signup requires a card or the needed free
   resources are unavailable for your account, stop at that screen; do not move
   onto a paid plan to finish a free setup.
3. Create a project called `customerlead-automation` in an available nearby
   region. This step alone does not migrate the existing automation.
4. Review the [n8n + PostgreSQL template](https://northflank.com/stacks/deploy-n8n).
   Use the single n8n service and database. Check that both use the free resource
   choices and that the estimate remains zero. The worker/Redis template adds
   resources and is unnecessary for the initial personal deployment.
5. Keep n8n at the existing **2.43.8** version during migration. Free-resource
   memory/CPU limits still need a workload test with this workflow; do not assume
   that a successful empty n8n startup proves all processing will fit.

Before deploying the restored automation, the maintainer must make a consistent
private backup and migrate the existing SQLite database to PostgreSQL using a
supported migration for that n8n version. Preserve its existing encryption key,
workflow IDs, credential bindings, account access and required runtime data.
Keep any filesystem binary data backed up and provide durable storage if it is
needed. A workflow JSON import alone does not migrate working credentials.

The template's automatically generated encryption key must not replace the key
needed to decrypt restored credentials. Store the retained key and database
connection values in Northflank's private secrets. Keep hosted workflows inactive
until the final cutover. Do not publish an empty or partially restored copy.

## 4. Put the app in GitHub and configure Vercel

If the latest code is already in a GitHub repository, push the changes there and
skip creating another repository. Otherwise, use GitHub Desktop to initialize a
repository in the existing `templates/leads` folder, keeping its existing
`.gitignore`. Review Changes: `.env.local`, `.data`, `node_modules` and `.next`
must be absent. Commit the application code, choose Publish repository, and keep
the repository private. Do not upload an archive containing local credentials
or customer records. Supabase migration/setup scripts outside this folder are
maintainer tools; they are not needed inside the deployed Next.js application.

1. Sign in to your existing Vercel account. Keep the existing GitHub connection.
2. Choose Add New → Project and import the repository containing this CRM.
3. Set **Root Directory** to `templates/leads` if the repository contains this
   whole project. If you published only the app folder as described above, use
   the repository root (`./`). `home` is the original template catalog.
4. Use **Next.js**, **Node.js 22.x**, the existing pnpm lockfile, install command
   `pnpm install --frozen-lockfile`, build command `pnpm build`, and the default
   Next.js output directory. Do not deploy the Docker QA image.
5. Enter the current public Auth settings in Vercel's Environment Variables:

   ```text
   NEXT_PUBLIC_SUPABASE_URL
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
   ```

6. Add these **Production** environment variables, copying the existing private
   values from your local `.env.local` without posting them in chat:

   | Variable | Value |
   | --- | --- |
   | `CRM_STORAGE_BACKEND` | `supabase` |
   | `SUPABASE_SECRET_KEY` | Your existing server-only Supabase secret key |
   | `N8N_WEBHOOK_SECRET` | The unchanged CRM/n8n integration secret |

   The two public Auth variables from step 5 are also required. Do not put the
   secret key in a `NEXT_PUBLIC_` variable. This adapter uses Supabase's API/RPCs;
   a separate CRM `DATABASE_URL` is not required.
7. Keep live cloud secrets out of Preview deployments; use a separate isolated
   Supabase project if you want writable previews. An unconfigured preview will
   refuse storage access instead of creating dummy customer records. Existing
   assistant/Contacts settings were imported privately; environment overrides
   are optional, not mandatory additional setup.
8. Click Deploy and record the actual `https://…vercel.app` production address.
   The existing cloud records should appear after authorized sign-in. Do not
   run a seed or import to populate the deployment.

No purchased domain is needed to use the generated Vercel address.

## 5. Connect the real public addresses

1. In Supabase → Authentication → URL Configuration, set Site URL to the actual
   Vercel production origin. Add that origin's `/auth/callback` and
   `/auth/callback?next=/update-password` redirects. Retain local redirects for
   local development if needed.
2. Update reset/invite email links to the new origin's `/auth/confirm` handler,
   using the existing templates in [login-and-assistant.md](login-and-assistant.md).
3. In Northflank, record n8n's generated HTTPS `code.run` address. Configure the
   editor/webhook origin and trusted proxy settings for the installed n8n version
   and actual proxy path. Do not disable secure cookies to fix an address issue.
4. In the existing Google OAuth client, add the exact redirect URL shown by the
   hosted n8n Gmail/Google credential. Keep existing credentials and Sheet IDs;
   reconnect only as required. Verify profile/labels and Sheets reads first.
5. Replace every hosted workflow CRM receiver origin
   `http://host.docker.internal:3001` with the Vercel production origin, preserving
   each `/api/n8n/…` path and the same Bearer credential. That Docker-only hostname
   cannot reach Vercel. Use the stable production URL, not a temporary preview URL.
6. Machine requests must reach the CRM without an interactive Vercel login page.
   If Vercel deployment protection is enabled, configure its supported automation
   access while retaining the app's Bearer checks; verify authenticated health.
7. Set Vercel's `CRM_CUSTOMER_FORM_URL` to n8n's HTTPS production `/form/<existing-id>`
   address. The form belongs to n8n, not to Supabase Auth. Keep the original form ID.

## 6. Migrate once and verify before switching this PC off

1. Record current CRM counts, workflow IDs, settings and pending/uncertain jobs.
   The live CRM is now in Supabase. With writers paused, export its current state
   and private files using the command below; the old `.data` snapshot does not
   contain later cloud edits. Back up n8n's complete database/configuration too.

   ```powershell
   & .\.local-tools\node-v22.23.3-win-x64\node.exe --env-file=templates/leads/.env.local --experimental-strip-types scripts/backup-supabase-crm.mjs
   ```
2. At cutover, stop the equivalent local processing before publishing the hosted
   workflow. Vercel uses the SAME already-migrated Supabase workspace; do not
   restore the stale local snapshot over it. Compare IDs/counts/settings. Do not
   reset queues, replay protection, Sent results or uncertain delivery states.
3. Verify sign-in and password recovery, denied signed-out/non-member access,
   private reports, assistant availability, authenticated machine endpoints and
   durable records after a redeploy/restart.
4. Use one owner-controlled form/mailbox inquiry with customer sends disabled.
   Verify capture → CRM → AI draft → Sheets sync and owner-edit write-back.
5. Check all intended independent schedules. Keep replaced helper workflows and
   the local copy inactive. Only test actual delivery with explicitly confirmed
   recipient/content; approval alone is not proof of sending.
6. Confirm hosted processing continues without local services. Keep private
   off-host backups and check free-plan usage. Then this PC can be switched off.

The installed n8n 2.43.8 CLI supports `export:entities` / `import:entities` for the
SQLite-to-PostgreSQL transfer. Its export flag for history is
`--includeExecutionHistoryDataTables=true`; user data-table rows are included by
default. Keep entity exports, their key material and the existing encryption key
private. Import only into the intended fresh hosted database while its n8n service
is stopped, then unpublish restored workflows before starting it. Do not use
`--truncateTables` against an existing populated instance. This transfer still
requires the hosted project's database/terminal access and has not been executed
by the Supabase CRM migration. Existing local workflows remain the active copy.

## The immediate next step

Publish the prepared app code to your private GitHub repository, then import it
into your existing Vercel account using step 4. Create/check the Northflank free
account/project for the later automation move. Supabase storage is already
migrated; **Vercel and Northflank hosting are not deployed yet**. This PC still
runs the website and n8n until those hosting steps are verified.
