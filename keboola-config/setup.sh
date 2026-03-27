#!/bin/bash
set -Eeuo pipefail

cd /app/app

# If lockfile exists, prefer deterministic install.
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

