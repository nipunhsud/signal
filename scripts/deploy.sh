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

# Reclaim disk BEFORE building: every deploy is a --no-cache rebuild of 8
# images, and the orphaned layers from prior deploys pile up until the disk
# fills and builds start failing. Prunes only dangling/unused images and build
# cache — running containers and named volumes are untouched.
docker image prune -af || true
docker builder prune -af || true
df -h / | tail -1

# migrations MUST be rebuilt too: its image bakes in prisma/migrations, and a
# stale one makes `migrate deploy` miss new migrations (silent schema drift).
$DC build --no-cache migrations dashboard agent-tier-1 agent-tier-2 agent-tier-3 agent-tier-4 agent-tier-5 agent-in-1 agent-in-2
$DC up -d
# Caddy reads its Caddyfile from a single-file bind mount. Two traps: `up -d`
# does not recreate a container whose image and env are unchanged, and a
# `git pull` replaces the file with a NEW inode, which a running container
# never sees — so even `caddy reload` re-reads the old config. A Caddyfile
# edit (chat.dataquant.ai) therefore never took effect and the new host
# answered TLS with an internal error (no certificate). Recreate the
# container every deploy: the mount is re-resolved and the new Caddyfile
# loads. Certs persist in the caddy_data volume, nothing is re-issued.
$DC up -d --force-recreate --no-deps caddy
$DC ps
