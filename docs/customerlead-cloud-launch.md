# Launch the CRM and n8n without leaving your computer on

**Route update, 21 October 2026:** you declined card verification and selected
your existing Vercel account for personal use. Follow
[the Vercel/Supabase/n8n personal guide](vercel-supabase-n8n-personal-guide.md).
The Oracle instructions below are retained as an alternative, not the current
selected route. No Oracle account/server was created.

Your choice: a Cloudflare account, no owned domain, free hosting if possible, and
continuous operation away from this Windows PC. This guide and the server files
are prepared; a cloud account/server and public launch have **not** been created.

## The free route

Use one **Oracle Always Free** Linux server for the website/backend and n8n. Use
two **DuckDNS** addresses instead of buying a custom domain. Caddy supplies HTTPS.
The CRM keeps its Supabase login; customer inquiry forms remain public in n8n.

Example addresses, subject to availability:

- Dashboard: `https://your-business-crm.duckdns.org`
- Automation/editor: `https://your-business-automation.duckdns.org`
- Customer form: the automation address plus your existing `/form/<form-id>`.

DuckDNS supplies a free subdomain, not ownership of a custom domain. A Cloudflare
account does not itself provide a custom domain or an always-running n8n server.
Cloudflare's free Workers address applies to its own platform; the current CRM's
disk storage and the n8n service need a server. You can use a purchased domain
through Cloudflare later without rebuilding the application.

Oracle's free server is conditional: most signups need a phone/card, free capacity
may be unavailable in the chosen home region, and idle free instances can be
reclaimed. It is a possible zero-hosting-fee route, not guaranteed uptime. Do not
buy a paid resource or rely on temporary trial credits to call this free. Gemini,
Google services and Supabase have their own quotas; hosting does not make them
unlimited. Sources: [Oracle Free Tier](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm),
[Always Free limits](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm),
[DuckDNS](https://www.duckdns.org/), [Workers filesystem](https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/).

## Step 1 — Create the cloud account

1. Open [Oracle Cloud Free Tier](https://www.oracle.com/cloud/free/), then Start
   for free. Create your own account and complete the identity verification.
2. Choose the home region carefully: free compute is provisioned in that region.
   Choose an available nearby region for your users; do not assume another region
   can be selected later just to obtain free capacity.
3. Stay on the free account and select resources within the actual Always Free
   entitlement shown in your Console. Creating an account is the current next
   human step. Keep account passwords, cards and verification codes private.

## Step 2 — Create one eligible server

In Compute → Instances → Create instance:

- Name: `customerlead`.
- Image: an Always Free-eligible **Ubuntu 24.04** image matching the shape.
- Preferred shape: **VM.Standard.A1.Flex**, for example **2 OCPUs and 6 GB RAM**.
  Oracle's currently documented free total is 2 OCPUs/12 GB across A1 instances;
  do not follow older 4-OCPU/24-GB instructions. Confirm your actual entitlement.
- Boot disk: default 50 GB, within the account's combined free block allowance.
- Use a public subnet with a public IP. Save the SSH private key privately on
  this PC; do not paste it in chat or upload it to source control.
- Allow SSH (22) from your own IP, and HTTP/HTTPS (80/443) for public use. Do not
  expose ports 3001 or 5678 to the internet. Apply the equivalent host firewall
  rules without blocking your existing SSH session.

If Always Free capacity is unavailable, stop here. Do not select a paid shape to
continue a free launch. A paid persistent server is the alternative if you later
choose a budget. The 1-GB free micro shape is a poor target for this combined app,
Chromium report generation and production builds.

## Step 3 — Reserve two free addresses

1. Open [DuckDNS](https://www.duckdns.org/) and sign in with a supported account.
2. Reserve two available names for the CRM and automation.
3. Set both IPv4 records to the server's public IPv4 address. If that IP later
   changes, update both records; the customer-facing names stay the same.
4. Keep the DuckDNS account token private. The deployment does not require it if
   you update the addresses in the DuckDNS website.

## Step 4 — Prepare the server and source

Connect from PowerShell using your saved SSH key and the server's public IP:

```powershell
ssh -i "C:\path\to\your-private-key.key" ubuntu@YOUR_SERVER_IP
```

Install Docker Engine and the Docker Compose plugin using the
[official Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/).
Verify `docker version` and `docker compose version`. Run Docker commands with
`sudo` if your account has not been granted Docker access.

Transfer the app source and `deploy/customerlead` to one server directory, keeping
their repository paths. Build on Linux for that server's architecture; do not
copy Windows `node_modules` or a Windows Next build. Exclude `.env.local`, `.data`,
private exports, backups and `node_modules` from the source upload. Those private
files are transferred separately, securely, in the migration step.

The launch kit's build context is `templates/leads`. Its `.dockerignore` excludes
customer data, environment files and maintainer integration downloads. The image
contains Linux Chromium for PDF reports. It runs as a non-root user and starts
only when a valid restored `crm.json` and required configuration exist.

## Step 5 — Restore the existing system privately

This is the maintainer-assisted migration step. The prepared kit does **not**
export, stop or modify the current live system automatically.

1. Record the current running n8n version (currently **2.43.8**), active workflow
   IDs, CRM counts, pending changes and delivery jobs. Do not clear queues, reset
   replay protection, relabel messages or delete records to make migration easier.
2. At the agreed cutover, stop the local processing services long enough to make
   consistent private backups. Back up the **entire** `templates/leads/.data`
   directory and `.env.local`. Preserve reports, assistant configuration and
   contact-photo configuration, not only `crm.json`.
3. Back up the complete Docker **n8n_data** volume consistently, including its
   SQLite database, configuration/encryption key, credentials, workflows and
   binary data. Use a stopped-volume backup or a supported consistent database
   backup. Workflow JSON alone does not transfer working credentials. Retain the
   original backup separately for rollback.
4. Restore the data beneath `deploy/customerlead/state/crm` and
   `deploy/customerlead/state/n8n` on the server. Restrict the deployment/state
   directories and give the service data directories to UID/GID **1000:1000**.
   Do not make them world-writable. Never use `docker compose down -v` as a reset.
5. Copy `.env.example` to `.env` in `deploy/customerlead`, then fill in the two
   real hostnames, certificate email, existing public Supabase values, the
   **unchanged** CRM integration secret and the existing form ID. Copy
   `n8n-runtime.env.example` to `n8n-runtime.env` and restore any explicit private
   n8n database/encryption/runtime settings from the old container. If the old
   container used an environment encryption key, preserve that exact key; if it
   used its saved config key, preserve the config and leave the environment key
   unset. Protect both environment files with private permissions.

The kit preserves `.data` on a mounted directory and n8n on a separate mounted
directory. It runs **one** CRM instance because the current JSON store coordinates
writes within one process. Do not scale this setup horizontally.

## Step 6 — Build and verify before publishing

From `deploy/customerlead` on the server:

```sh
docker compose config --quiet
docker compose build crm
docker compose up -d crm
# The public HTTPS proxy remains off unless its public profile is requested.
# Before starting hosted n8n, deactivate only the RESTORED copy's schedules:
docker compose run --rm --no-deps n8n unpublish:workflow --all
docker compose up -d n8n
```

The read-only initial inspection of the existing n8n confirmed that
`unpublish:workflow --all` is supported in 2.43.8. Run it only against the restored
server copy. These commands are not an instruction to deactivate the current
Windows instance early. No hosted schedule should run during staging.

Use an SSH tunnel to inspect the private website/editor before enabling public
HTTPS. From a separate PowerShell window on this PC:

```powershell
ssh -i "C:\path\to\your-private-key.key" -L 13001:127.0.0.1:3001 -L 15678:127.0.0.1:5678 ubuntu@YOUR_SERVER_IP
```

The CRM can be inspected at `http://127.0.0.1:13001`. n8n is configured for secure
cookies on its eventual HTTPS host, so use the public HTTPS editor after the next
step if its private HTTP tunnel cannot sign in; do not turn secure cookies off.
Verify the CRM unauthenticated API denies access, login/membership works, record
counts/IDs/settings match the backup, reports render and persist, and existing
Sent/Needs Review jobs stay unchanged. The internal Docker alias
`host.docker.internal` routes existing CRM callback URLs to the CRM service on
port 3001, avoiding a blanket rewrite of your workflow nodes. Prove authenticated
health/connectivity from hosted n8n before enabling schedules.

## Step 7 — HTTPS and connection settings

After DNS resolves to this server and the firewall allows 80/443:

```sh
docker compose --profile public up -d caddy
```

Open both real HTTPS addresses. Caddy provisions certificates automatically. n8n
uses `N8N_WEBHOOK_URL`, `N8N_EDITOR_BASE_URL` and one trusted proxy hop. These are
configured for version 2.43.8; do not upgrade n8n incidentally during migration.

In your existing **Supabase** project, set Site URL to the CRM HTTPS origin. Add
that origin's `/auth/callback`, `/auth/callback?next=/update-password` and relevant
`/auth/confirm` reset/invite URLs. Update hard-coded local reset/invite email links
to the new HTTPS origin as described in `docs/login-and-assistant.md`. Keep the
same workspace members. Verify sign-in, denied non-member access and password
recovery on the hosted address.

In the existing **Google OAuth client**, add the exact callback URL displayed by
hosted n8n (normally the automation origin plus
`/rest/oauth2-credential/callback`). Preserve the existing Client ID/secret and
credential bindings. Test Gmail profile/labels and Sheets reads; reconnect only
if required. The customer form link in CRM Settings uses the hosted automation
origin and the original form ID.

## Step 8 — Launch once, then test

1. Keep the local equivalent schedules stopped/unpublished before publishing
   the intended hosted workflow. Keep the older replaced helpers inactive.
   Never run both copies of an inbox scan or sender while testing migration.
2. Publish only the intended current workflow(s), preserving their IDs/bindings
   and previously verified settings. Verify the four independent schedules and
   the form trigger if using the unified workflow.
3. Submit one inquiry from an owner-controlled mailbox or form with customer
   sends disabled for the controlled test. Confirm capture, AI draft, Sheet sync,
   owner edits, permission and follow-up scheduling. Test a delivery only after
   explicitly approving/confirming a controlled recipient and content.
4. Confirm a signed-out visitor cannot read CRM data. Confirm the form remains
   public, the private n8n editor requires its own login, and the API machine
   endpoints still require their Bearer credential.
5. Record the final URLs, workflow IDs, versions, backups and test results. The
   services have `unless-stopped` restart policies. Once hosted processing is
   confirmed, this Windows PC can be switched off.

Keep private off-server backups of both data directories and the original
encryption/environment configuration. Oracle may reclaim idle free resources;
free hosting does not replace backups or provide an uptime guarantee.

## Current launch status

Prepared: application Dockerfile, persistent Compose services, HTTPS proxy,
startup guards and this guide. Cloud server, addresses, restored data, external
OAuth/Auth URL updates and a public launch still require the user's cloud account
and server access. Local CRM records, n8n workflows and actual mail sending have
not been changed by preparing this route.

## Maintainer verification

The Linux AMD64 production image was tested locally using synthetic data and a
mock Supabase service: sign-in, denied non-member access, protected CRM/report
APIs, cross-origin protection, private machine authentication, the internal
callback alias, PDF/Excel generation and persistence after restart. The Compose
and Caddy configurations validate. Both services refuse missing restored data.
The 154 existing automated checks and TypeScript pass. No live email was sent.

These checks do not verify an Oracle ARM server, public DNS/certificate issuance,
restored live credentials or actual hosted schedules. Verify those after a server
exists. Reproduce the isolated image checks from the repository root (port 3003
must be free):

```powershell
docker build -t customerlead-hosting-qa --build-arg NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_isolated_qa_only templates/leads
& .\.local-tools\node-v22.23.3-win-x64\node.exe scripts/check-cloud-container.mjs
```

This QA image deliberately contains mock public Auth settings. Build the real
server image through Compose with the existing project's actual public settings.
Never deploy the QA image or fixtures as the customer workspace.
