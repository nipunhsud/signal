#!/bin/bash
set -euo pipefail

# Redeploy the stack on the DigitalOcean droplet after a code change.
# Pulls main, rebuilds --no-cache (regenerates Prisma client, avoids stale
# drift), and brings everything up. migrations service re-runs prisma migrate
# deploy on its own — no manual step. Run from the repo root on the droplet.

SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$0")/.."

# `docker compose` (v2 plugin, what get.docker.com installs) vs legacy
# `docker-compose` (hyphen). Use whichever exists.
DC="docker compose"; command -v docker-compose >/dev/null 2>&1 && DC="docker-compose"

# The pull may replace this very file. bash reads a script as it runs, so
# the rest of THIS run would still be the old copy (the Sep 17 Caddy recreate
# step was pulled but never executed). Pull, then re-exec the fresh script.
if [ -z "${DEPLOY_REEXEC:-}" ]; then
  git pull origin main
  DEPLOY_REEXEC=1 exec "$SELF" "$@"
fi

# Reclaim disk BEFORE building: every deploy is a --no-cache rebuild of 8
# images, and the orphaned layers from prior deploys pile up until the disk
# fills and builds start failing. Prunes only dangling/unused images and build
# cache — running containers and named volumes are untouched.
docker image prune -af || true
docker builder prune -af || true
df -h / | tail -1

# migrations MUST be rebuilt too: its image bakes in prisma/migrations, and a
# stale one makes `migrate deploy` miss new migrations (silent schema drift).
AGENTS="agent-tier-1 agent-tier-2 agent-tier-3 agent-tier-4 agent-tier-5 agent-in-1 agent-in-2"
$DC build --no-cache migrations dashboard $AGENTS
# --remove-orphans: a container from an older compose topology (a service since
# renamed or deleted) keeps running forever otherwise. `up -d` only manages
# services named in the CURRENT file and leaves the rest alone, restart policy
# and all. On 2026-09-23 a BUG alert arrived in the email format deleted on
# 2026-09-09 — rocket emoji, "TRADE SETUP", "Buy Point (Entry)", "Source:
# Signal Forge" — so something had been scanning and emailing on two-week-old
# code, under none of the gates since added.
$DC up -d --remove-orphans
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

# Every running agent must be on the image this deploy just built. Two ways
# that silently fails: a build error aborts before `up` and leaves the old
# container running, and an orphan from a previous compose topology survives
# every deploy because `up -d` only manages services the current file names.
# Both keep scanning and emailing on old code under old rules.
echo "--- image check ---"
stale=0
for svc in $AGENTS dashboard; do
  cid="$($DC ps -q "$svc" 2>/dev/null || true)"
  if [ -z "$cid" ]; then
    echo "MISSING   $svc is not running"
    stale=1
    continue
  fi
  running="$(docker inspect -f '{{.Image}}' "$cid" 2>/dev/null || true)"
  image="$($DC config --images "$svc" 2>/dev/null | head -1 || true)"
  expected=""
  [ -n "$image" ] && expected="$(docker image inspect -f '{{.Id}}' "$image" 2>/dev/null || true)"
  if [ -z "$expected" ] || [ -z "$running" ]; then
    echo "UNCHECKED $svc — could not resolve its image; verify by hand"
  elif [ "$running" != "$expected" ]; then
    echo "STALE     $svc is on ${running#sha256:}, this deploy built ${expected#sha256:}"
    stale=1
  else
    echo "ok        $svc"
  fi
done

# Everything docker is running, newest image first. A container whose image is
# weeks older than the rest is the one still sending the old emails.
echo "--- running containers, by image age ---"
docker ps --format '{{.Names}}\t{{.Image}}\t{{.RunningFor}}'

if [ "$stale" = "1" ]; then
  echo "DEPLOY INCOMPLETE — a container is not on the image just built, so it is still running old code and old alert rules." >&2
  exit 1
fi
echo "all services on the freshly built images"
