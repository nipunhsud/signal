#!/bin/bash
set -euo pipefail

# Redeploy the stack on the DigitalOcean droplet after a code change.
# Pulls main, rebuilds --no-cache (regenerates Prisma client, avoids stale
# drift), and brings everything up. migrations service re-runs prisma migrate
# deploy on its own — no manual step. Run from the repo root on the droplet.

cd "$(dirname "$0")/.."

git pull origin main
docker-compose build --no-cache dashboard agent-tier-1 agent-tier-2 agent-tier-3 agent-tier-4 agent-tier-5
docker-compose up -d
docker-compose ps
