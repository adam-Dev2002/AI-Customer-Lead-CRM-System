# Local CustomerLead dashboard

The CRM is implemented in `templates/leads`, using the original Square UI design and components. The upstream template catalog may remain in an existing local workspace, but is excluded from this application's repository.

| Preview          | Address               | Source            |
| ---------------- | --------------------- | ----------------- |
| CustomerLead CRM | http://localhost:3001 | `templates/leads` |

From the project root, start the CRM in a PowerShell terminal:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1 -Template leads
```

Keep those terminals running. Press Ctrl+C in a terminal to stop its server. The policy override applies only to the launched PowerShell process; it does not change the machine's script policy. An optional `-Port` parameter changes the port. Both servers bind to this computer's loopback interface.

The launcher uses Node.js on PATH or the portable Windows runtime in `.local-tools`. Restore dependencies with `pnpm install --frozen-lockfile` inside `templates/leads`, using Node.js 22 and pnpm 10.34.7. Portable runtimes are local tools and are excluded from the repository.

The CRM has connected Dashboard, Leads, Inbox, AI Drafts, Follow-ups, Calendar, Tasks, Contacts, Activity, Settings, and Help pages. It supports persistent lead creation/edits/deletion, owners and notes, CSV import/export, reply editing/approval/rejection, consent-based follow-up scheduling/cancellation, tasks, and local preferences. Counts and charts come from the same saved records.

With `CRM_STORAGE_BACKEND=supabase`, records are stored in the private Supabase workspace and files in its private `crm-private` bucket. The existing workspace has already been migrated; do not re-import the old local snapshot. Local development storage uses `templates/leads/.data/crm.json`, which is ignored by Git. Preserve real inquiries, drafts and delivery history. Restarting or refreshing does not reset saved data. See [cloud storage and deployment](docs/vercel-supabase-n8n-personal-guide.md).

Supabase Auth protects the dashboard, CRM/photo APIs and the separate read-only Gemini assistant. Follow [the login and assistant setup guide](docs/login-and-assistant.md) for the public environment values, workspace-access SQL, application users, invitations and recovery links. A Supabase account without an admin-created workspace membership cannot read CRM records. This is one shared workspace; signing in does not create a separate database of leads for each user.

The existing Docker workflow receives inquiries, reads shared preferences, writes Sheets and sends explicitly confirmed owner replies. Its `/api/n8n/*` endpoints retain separate Bearer authentication and do not require a browser sign-in. Draft approval records review; Send via Gmail separately queues a confirmed reply. Keep the local app bound to loopback. Hosting also requires durable private record storage, HTTPS, correct Supabase redirect URLs and shared limits if running multiple replicas.

## Verification

For a production build and server, stop the current preview and add `-Production`
to the launcher. See [launch performance](docs/launch-performance.md) for the
isolated production benchmark, measurement limits and hosting requirements.

With Node.js 22 on PATH, run inside `templates/leads`:

```powershell
npm test
node .\node_modules\typescript\bin\tsc --noEmit
node .\node_modules\next\dist\bin\next build
```

The project-local runtime can be used by its full path if Node.js is not on PATH. Browser checks are in `scripts/check-crm.mjs` and `scripts/check-login-assistant.mjs`; they use the project-local `playwright-core` helper installed in `.local-tools/browser-testing` and the existing Chrome executable. Run them sequentially from the root with Node.js. Each starts and stops an isolated test server on port 3002 with separate data/build output and a fake Supabase HTTP service, so real accounts and records are preserved. Chat UI responses are intercepted in browser tests; unit tests mock Gemini. Generated screenshots/logs are in `.local-preview`.

See [the current workflow review](docs/n8n-current-review.md) and [the connection guide](docs/n8n-connection.md).

## Docker n8n connection

The project is an AI customer support and lead inquiry CRM. Its workflow runs in Docker on this Windows computer. How it works at http://localhost:3001/automation maps business functions to their owner screens and shows incoming activity and saved changes. Integration setup files are maintainer resources, not part of the customer interface.

The Docker container can reach the loopback CRM at `http://host.docker.internal:3001`. Configure the private token with `scripts/configure-n8n.ps1`; use `-CopyToken` to copy its Authorization value for an n8n Header Auth credential. See [the Docker connection guide](docs/n8n-connection.md) and [function coverage](docs/workflow-coverage.md). The source automation and live credentials remain unchanged until the integration nodes are configured in n8n.
