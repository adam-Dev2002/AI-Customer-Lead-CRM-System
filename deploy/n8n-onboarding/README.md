# Customer Google onboarding helpers

For the current **public Vercel + existing local Docker** test, follow
[local Docker multi-business setup](../../docs/local-docker-multi-user.md).
Use `scripts/install-local-onboarding-worker.ps1`; it installs an outbound worker
inside the existing container. Do not replace that container with this image.
`pull-worker.mjs` handles fixed queued setup jobs, and `run-pull-worker.mjs` keeps
an encrypted journal so a crash or lost callback cannot repeat an unknown create.

`workflow-integrity.mjs` is shared with the website's connection checker. It
ignores only a credential's display name when its explicit ID is present; n8n
resolves these names on reads. Credential IDs/types, executable parameters and
connections are still compared. Temporary metadata read errors retry up to three
times; resource creation and activation are never blindly retried.
The canonical module lives under `templates/leads/lib/connections`; the repository
worker re-exports it, and the installer copies it into the standalone worker folder.

Use `scripts/install-local-onboarding-worker.ps1 -Restart` to update this worker.
It sends SIGTERM only to the exact installed onboarding runner and lets its
current job/callback finish before replacing files. It does not restart n8n,
remove an encrypted journal, rotate configuration, or affect inquiry workflows.
If the job cannot drain, installation stops instead of forcing termination.

The remaining image/Compose files below describe a future hosted direct mode.

This is an operator deployment artifact, not an already running hosted service.
Follow [customer onboarding and hosting](../../docs/customer-google-onboarding.md)
before starting. Keep the owner's free/no-card restriction; no cloud subscription
or resource is created by these files.

The image retains n8n 2.43.8, adds a small Node proxy and an authenticated endpoint
that imports only **new fixed Google credentials** using n8n's CLI. Expose port
8080 through HTTPS ingress; port 5678 stays internal. Persist and back up the
complete `/home/node/.n8n` directory and original encryption configuration.

Do not start a restored active workflow while another copy processes the same
business. The startup guard requires a restored SQLite database/config plus
`customerlead-host-ready` in that directory. Only create the marker after safely
disabling duplicate schedules, checking hosted receiver URLs and retaining the
existing operator project/Gemini credential. The marker is an operator checkpoint,
not a health check or an automatic migration.

Copy `runtime.env.example` to ignored `runtime.env` privately. Set the existing
project ID and a long random setup key. Set the same setup key in the website's
server-only `CRM_N8N_SETUP_KEY`; keep the n8n public API key server-only as well.
The credentials imported through this helper share the existing operator project.

The included Compose assumes an external HTTPS ingress; it does not provision
DNS/TLS or a ClawCloud account. It refuses to create a blank replacement database.
Configure actual proxy hops for the hosting topology. The host must remain running
without visitors and retain its volume across restart/replacement.
