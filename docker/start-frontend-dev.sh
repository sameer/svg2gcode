#!/bin/sh

set -eu

cd /app/web

stamp_file="node_modules/.package-lock.sha256"
current_lockfile_hash="$(sha256sum package-lock.json | awk '{print $1}')"
installed_lockfile_hash=""

if [ -f "$stamp_file" ]; then
  installed_lockfile_hash="$(cat "$stamp_file")"
fi

if [ ! -d node_modules ] || [ "$current_lockfile_hash" != "$installed_lockfile_hash" ]; then
  echo "Installing frontend dependencies..."
  npm ci --no-audit
  printf '%s\n' "$current_lockfile_hash" > "$stamp_file"
fi

echo "Starting Vite dev server on port ${VITE_PORT:-5173}..."
exec npm run dev -- --host 0.0.0.0 --port "${VITE_PORT:-5173}"
