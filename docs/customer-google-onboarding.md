# Customer Google connection onboarding

Prepared 24 October 2026. This implementation is local and disabled by default.
It has not connected a real new Google account, created a live Sheet, imported a
live credential, published a workflow, migrated hosting, or sent an email.

The owner subsequently chose **public Vercel + existing Docker n8n on this PC**
for the first multi-business test. Follow [local Docker setup](local-docker-multi-user.md)
using `CRM_N8N_CONNECTION_MODE=pull`. Hosting migration is deferred. The direct
hosted helper instructions below are retained for a future migration.

## Customer experience

The business owner opens **Connections** and chooses **Connect Google**. They
choose Gmail or a Gmail-enabled Google Workspace account and approve Google's
permissions. This is separate from signing into the CRM. An email address alone
cannot grant mailbox access. Outlook and other mail providers are not supported
by this release.

The website then advances through durable setup steps:

1. Read the authorized Gmail profile and retain its actual email address.
2. Add the four existing AI-SUPPORT processing/outcome labels, without labeling
   or changing existing messages.
3. Create one new native Google Sheet in that account with **Leads** and
   **ReplyReviews**, exact 21/9 headers and frozen header rows. No old records
   or sample rows are copied.
4. Import two fresh, fixed Google credentials into the operator's n8n project;
   create a separate CRM Header Auth credential and workspace token.
5. Create an inactive copy of the reviewed, predefined Gemini business workflow.
   All 50 credential bindings are assigned by the server. Gmail, Sheets, CRM
   token and form identity belong to this business. The operator's approved
   Gemini credential is shared as an operator service.
6. Read the Gmail profile, Sheet metadata and saved workflow graph to check the
   expected identity, tabs, parameters, connections and bindings.
7. Show **Ready to enable**. The owner reviews business preferences, confirms
   the connected account and explicitly enables processing. A separate Pause
   control stops the workflow. Setup checks themselves execute no inquiry and
   send no mail.

The four independent schedules remain independent: inbox, follow-ups, sync and
confirmed sending. Enabling a workflow is not proof that a background poll or a
customer email succeeded. The UI reports received background checks separately.
Normal reply approval, send confirmation, uncertain-send protection, follow-up
consent and business email gates are retained. AI suggestions and automatic
emails use the owner's existing preferences; onboarding does not enable them.

## Why there is an operator helper

The reviewed n8n 2.43.8 public credential API validates against a schema that
excludes hidden OAuth token fields. It cannot accept `oauthTokenData` obtained
by the website. Creating a nominal OAuth credential through that API would
leave it disconnected or fail validation.

`deploy/n8n-onboarding` adds a small authenticated import endpoint alongside
n8n in the same container. It accepts only the two fixed Google credential types,
reconstructs allowed fields, generates a fresh credential ID, and invokes the
supported `n8n import:credentials --input ... --projectId ...` CLI. No editor
session cookies, undocumented editor APIs, dynamic/end-user credentials,
enterprise credential resolvers or arbitrary command execution are used.

In local pull mode the same constrained importer runs inside the existing
container through an outbound worker. Encrypted queued jobs replace the hosted
import endpoint. Only the local worker retains the n8n API key. The extra
`202610240002_crm_local_onboarding_worker.sql` migration supplies job claims and
heartbeats, with durable encrypted local journaling for uncertain results.

The helper uses a private temporary file with restrictive permissions, removes
it on normal success/failure, suppresses CLI output, and persists only a receipt
ID, request hash and result ID. A failed/interrupted import remains pending and
cannot be blindly retried. The host filesystem and backups still require normal
operator protection. [n8n credential API implementation](https://github.com/n8n-io/n8n/blob/n8n%402.43.8/packages/cli/src/public-api/v1/controllers/credentials.public.controller.ts),
[schema validation](https://github.com/n8n-io/n8n/blob/n8n%402.43.8/packages/cli/src/public-api/v1/handlers/credentials/credentials.utils.ts),
[supported CLI](https://docs.n8n.io/hosting/cli-commands/).

## Future direct-host maintainer setup

Customers do not perform these steps. Keep keys out of chat, Git and screenshots.

1. Select a durable, always-on host within the owner's **free, no-card** limit.
   See the hosting section below. Keep local Docker stopped while preparing a
   hosted copy; never run duplicate schedules for the same business.
2. Back up and restore the complete existing n8n SQLite directory and encryption
   configuration privately. Keep restored workflows inactive until their hosted
   CRM receiver addresses and credentials are checked. Retain the approved
   Gemini credential and the owning n8n project. The new image refuses a blank
   database or a missing `customerlead-host-ready` marker. Create that marker
   only after the hosted-cutover checklist has been completed.
3. Build/deploy `deploy/n8n-onboarding/Dockerfile`, expose **8080** through the
   host's HTTPS ingress, and persist `/home/node/.n8n`. The proxy forwards normal
   n8n routes to internal port 5678 and reserves `/customerlead-setup/credentials`
   for operator-authenticated imports. Set trusted proxy hops for the actual
   topology. `compose.yaml` assumes one TLS ingress followed by this proxy.
   `WEBHOOK_URL` must be the public HTTPS origin; the similarly named
   `N8N_WEBHOOK_URL` is not a replacement for the documented setting.
4. Configure `CUSTOMERLEAD_SETUP_KEY` (32+ random characters) and
   `CUSTOMERLEAD_OPERATOR_PROJECT_ID` in the host's private environment. Retain
   the original encryption key/config. The n8n API user, imported credentials,
   new workflows and approved Gemini credential must have compatible ownership
   in this project. Do not give API keys or editor accounts to customers.
5. Apply the additive migration
   `supabase/migrations/202610240001_crm_google_connections.sql` in the existing
   Supabase project. It adds encrypted setup state and non-overwriting token
   registration. It preserves existing workspace records and integration tokens.
6. Configure a Google **Web application** OAuth client for this product. Enable
   Gmail, Google Sheets and Google Drive APIs. Register the exact redirect URI:
   `https://YOUR-STABLE-PRODUCTION-ORIGIN/api/connections/google/callback`.
   For the currently selected CRM, that origin is
   `https://ai-customer-lead-crm-system-oyh1.vercel.app`.
7. Declare `https://www.googleapis.com/auth/gmail.modify` and
   `https://www.googleapis.com/auth/drive.file`. The first is restricted and
   allows the existing read/label/draft/send behavior. The second limits Drive
   access to files created/opened by this app; broad Drive or spreadsheet-list
   access is not requested. In Testing, add only controlled test users. Public
   customer onboarding requires the applicable Google verification and, where
   required, a security assessment; those are not completed by this code.
8. Set the server-only website values below in **Vercel Production**, not just
   local `.env.local`. Generate and retain the encryption key privately. A
   changed/missing key cannot decrypt existing connections.

| Setting | Meaning |
| --- | --- |
| `CRM_PUBLIC_ORIGIN` | Stable public CRM HTTPS origin, without a path |
| `CRM_GOOGLE_CLIENT_ID` / `CRM_GOOGLE_CLIENT_SECRET` | Product's Web OAuth client |
| `CRM_CONNECTION_ENCRYPTION_KEY` | Random 32-byte key encoded as base64 |
| `CRM_N8N_API_URL` | Hosted HTTPS n8n/proxy origin, without `/api/v1` |
| `CRM_N8N_API_KEY` | Operator key for creating credentials/workflows and enabling/pausing them |
| `CRM_N8N_SETUP_KEY` | Same value as the helper's `CUSTOMERLEAD_SETUP_KEY` |
| `CRM_N8N_GEMINI_CREDENTIAL_ID` | Existing approved Gemini Header Auth credential ID |
| `CRM_N8N_GEMINI_MODEL` | Maintainer-selected working Gemini model |
| `CRM_GOOGLE_CONNECTIONS_ENABLED` | Set `true` only after the migration, host and Google app are ready |

9. Build and deploy the website; verify signed-out access is denied. Sign in
   through the stable public URL. Existing ClearFlow and manually configured
   connections remain support-managed and cannot be replaced through this flow.
   Before enabling, the maintainer can run the read-only
   `scripts/check-google-onboarding-ready.mjs` using the private server
   environment. It prints only presence/status and does not create resources.
10. Run the controlled second-business acceptance test below before offering
    automatic onboarding to customers.

## Hosting within the free, no-card constraint

No account-specific free 24/7 deployment has been established by this work.
Docker is now running on the current computer. Hosting work is deferred at the
owner's request; no cloud resources have been created.

Correction: the earlier ClawCloud Run recommendation relied on stale material.
Its official discontinuation notice set 11 May 2026 for free-service shutdown.
It is no longer a candidate. The owner's pictured `clawcloud.sh` is a different
paid OpenClaw product. [Official discontinuation notice](https://question.run.claw.cloud/questions/10010000000003261)

Each connected business adds four schedules and separate Google operations;
resource use grows with business count. Include the temporary memory/CPU peak of
the credential-import CLI process, not just idle n8n, when measuring a free host.
Free hosting must be measured with the
actual instance and persistent volume. If no account provides a durable running
instance within its allocation, the no-cost hosted service remains unavailable.
There is no code change that makes an offline computer run schedules.

The existing Vercel Hobby deployment also remains subject to its personal,
non-commercial restriction; choosing it for a personal preview does not license
a commercial launch. [Vercel plan rules](https://vercel.com/docs/plans/hobby)

## Controlled second-business acceptance test

Use a separate owner account and two inboxes you control. Do not reset or seed
ClearFlow. Keep automatic emails off until the business settings are reviewed.

1. Open Connections, authorize the controlled Gmail account and allow setup to
   finish. Check that the created Sheet is new, has exact headers and no copied
   customer rows. Confirm that no email has been sent.
2. Refresh during setup to verify confirmed steps resume. Confirm that another
   business cannot see the connection, Sheet link, state or token. A member
   without owner access must be denied setup controls.
3. Review the business facts and enable AI suggestions if wanted. Confirm the
   authorized inbox and enable processing. Wait for actual sync/sender polls;
   a green setup checklist alone does not prove runtime availability.
4. Send one fresh controlled inquiry from the second inbox to the connected
   account. Verify Inbox, Leads and AI replies in this workspace only, plus its
   new Sheet rows. Confirm the original business remains unchanged.
5. Edit internal notes and a draft, and verify applied Sheet results. Approve
   the reply, confirm the controlled recipient/content, then explicitly send.
   Verify Gmail-confirmed Sent and actual receipt in the controlled mailbox.
6. Pause processing and verify schedules/webhooks stop for this workflow. Enable
   again only after confirming the connected inbox. Restart the host and verify
   records, encrypted credentials, receipts and the form URL survive.

No test above has been claimed complete against live services in this release.

## Recovery and limitations

OAuth uses a ten-minute, single-use state bound to the owner session, workspace,
HTTP-only browser cookie and PKCE verifier. Google grants and setup artifacts are
AES-256-GCM encrypted with the workspace in authenticated data. Only service-role
RPCs can read/write setup state; owner-checked routes return a small safe status.

Each external resource creation is preceded by a persisted claim. Lost responses
and crashes retain the claim and display Needs attention. Automatic retries do
not recreate resources or activate workflows. A support operator must inspect
the corresponding Google resource/n8n receipt and reconcile the encrypted record
before resuming; no destructive automatic reset or credential rotation exists.

Pause is not Google consent revocation. Revoking app access in Google disables
the grant; it does not delete CRM records or the business's spreadsheet. This
initial release does not provide self-service account replacement or automated
recovery from an uncertain provisioning result.

## n8n licensing answer

**No: n8n's restrictions do not make this account-connection flow impossible.**
The current FAQ explicitly allows users to connect their own accounts to
predefined automations operated by the product owner. This interface does not
accept workflow code, custom nodes, arbitrary API URLs, credential IDs or a
workflow builder. Operator code controls the graph. Giving customers a way to
build/configure their own workflow logic requires separate commercial licensing,
including when hidden behind a custom interface. The credential-import helper
does not change those licensing boundaries. Confirm any materially expanded
offering with n8n before launch. [Official n8n license FAQ](https://docs.n8n.io/n8n-community-license/community-license/license-faq)

## Local validation

Run from `templates/leads`: `pnpm test:connections`, `pnpm test:tenants`,
`pnpm exec tsc --noEmit`, and `pnpm build`. From the repository root run
`node --experimental-strip-types scripts/check-connections.mjs` for the isolated
desktop/mobile browser flow. Tests use simulated Google/n8n services, temporary
credential imports and embedded PostgreSQL; they never send real mail.

Recorded local validation: 173 isolated automated tests passed, TypeScript and
the production build passed, and desktop/mobile/dark browser checks passed with
simulated Google/n8n results before local pull mode was added. The later Docker
and pull-worker validation is recorded in the local setup checkpoint. No live
acceptance test or deployment is implied.
