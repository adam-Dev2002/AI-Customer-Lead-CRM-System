#!/bin/sh
set -eu
# An existing operator project and Gemini credential are required. A blank
# installation must never silently replace the established n8n database/key.
if [ ! -s /home/node/.n8n/config ] || [ ! -s /home/node/.n8n/database.sqlite ]; then
  echo 'Restore the existing n8n database and encryption configuration before starting.' >&2
  exit 1
fi
if [ ! -f /home/node/.n8n/customerlead-host-ready ]; then
  echo 'Complete the hosted-cutover checklist before creating customerlead-host-ready in the restored data directory.' >&2
  exit 1
fi
node /opt/customerlead/server.mjs &
proxy_pid=$!
n8n start &
n8n_pid=$!
trap 'kill "$proxy_pid" "$n8n_pid" 2>/dev/null || true' TERM INT EXIT
wait "$n8n_pid"
