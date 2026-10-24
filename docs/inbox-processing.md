# Inbox processing status

The customer Inbox and How it works pages show authenticated, per-business scan
status: checking Gmail, matching message count, the current email, completion
(including an empty result), and a safe failure explanation. The sidebar links
to the Inbox. A scan is separate from an actual captured inquiry and from the
setup worker heartbeat, settings reads, record sync and sending-account polls.

New self-service workflows report `inbox.scan` to the existing authenticated
`POST /api/n8n/events`. Tenant selection comes from the integration token; the
payload cannot select another workspace. Only a fixed state, execution ID,
start time and bounded counters are persisted. Raw provider errors, OAuth tokens,
mailbox responses and email bodies are excluded from these status events.
Completed and failed scans also appear in Activity. Duplicate and late callbacks
cannot move the current scan backwards or turn a failed run into a success.

Inbox checks run every five minutes. Gmail profile, label, search and message
reads get at most three attempts, one second apart. A failed fetch stops that
scan and the next scheduled scan can try again. Failures during processing do
not unlock messages, recreate drafts, replay sends or infer delivery. Existing
mail and follow-up claims and uncertain-outcome safeguards are unchanged.

Refresh status reads saved CRM state; it does not execute a workflow. While a
scan or delivery is active, the dashboard polls every three seconds; otherwise
it polls every fifteen seconds. A missing result is shown as overdue after
eight minutes (fifteen minutes while processing). This is a monitoring warning,
not proof that the mailbox is empty. A stopped Docker host cannot report a new
error; the overdue state covers that absence. Existing unrelated workflows do
not acquire telemetry just from deploying the website.

The first self-service template used `new URL` in an n8n Code node. n8n's sandbox
does not expose that global. Validation now checks the fixed HTTPS origin without
requiring it. The reviewed upgrade tool is `scripts/upgrade-connected-inbox.mjs`.
It defaults to a read-only plan, accepts a self-service workspace UUID, compares
the complete prior graph and credential IDs, requires no pending setup/delivery
and outgoing automation disabled, writes an encrypted ignored backup, pauses
only that workflow, updates the same ID and restores its previous active state.
Unexpected graphs and unknown update outcomes require inspection, not retries.

Maintainer invocation (private env values never belong in Git):

```powershell
& '.local-tools/node-v22.23.3-win-x64/node.exe' `
  --env-file=templates/leads/.env.local `
  --env-file=private-integrations/local-onboarding/vercel-production.env `
  --experimental-strip-types scripts/upgrade-connected-inbox.mjs `
  --workspace BUSINESS_WORKSPACE_UUID
```

Deploy the event receiver before applying the reviewed upgrade with `--apply`.
Preserve all existing account bindings, Sheets, records and email preferences.
AI replies remain off until the owner enables them in Settings.

Checks: `templates/leads/tests/inbox-processing.test.mjs` and the isolated
`scripts/check-inbox-processing.mjs` browser/API check. They use simulated inbox
events and do not connect to Gmail or create/send real email.

Reference: [n8n error handling](https://docs.n8n.io/flow-logic/error-handling/).
