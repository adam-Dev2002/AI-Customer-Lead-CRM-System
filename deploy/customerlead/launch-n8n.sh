#!/bin/sh
set -eu
if [ ! -s /home/node/.n8n/config ] || [ ! -s /home/node/.n8n/database.sqlite ]; then
  echo 'n8n not started: restore its complete existing SQLite data directory and encryption configuration first.' >&2
  exit 1
fi
exec /docker-entrypoint.sh "$@"
