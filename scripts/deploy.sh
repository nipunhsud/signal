#!/bin/bash
set -euo pipefail

# Redeploy the stack on the DigitalOcean droplet after a code change.
# Pulls main, rebuilds --no-cache (regenerates Prisma client, avoids stale
# drift), and brings everything up. migrations service re-runs prisma migrate
# deploy on its own — no manual step. Run from the repo root on the droplet.

cd "$(dirname "$0")/.."

# `docker compose` (v2 plugin, what get.docker.com installs) vs legacy
# `docker-compose` (hyphen). Use whichever exists.
DC="docker compose"; command -v docker-compose >/dev/null 2>&1 && DC="docker-compose"

git pull origin main
# migrations MUST be rebuilt too: its image bakes in prisma/migrations, and a
# stale one makes `migrate deploy` miss new migrations (silent schema drift).
$DC build --no-cache migrations dashboard agent-tier-1 agent-tier-2 agent-tier-3 agent-tier-4 agent-tier-5 agent-in-1 agent-in-2
$DC up -d
$DC ps
