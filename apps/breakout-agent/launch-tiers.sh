#!/bin/bash

# Launch all tier agents in parallel
# Rate limiting via exponential backoff on 429 responses
TIERS=${1:-63}
LOG_DIR="logs"
mkdir -p "$LOG_DIR"

echo "🚀 Launching $TIERS breakout agent tiers in parallel..."
echo "   Rate limiting: exponential backoff on 429 responses"
echo "   Total: $((TIERS * 100)) assets scanned per hour"
echo ""

for tier in $(seq 1 $TIERS); do
  ENV_FILE="../../.env.tiers/.env.tier-$tier"

  if [ ! -f "$ENV_FILE" ]; then
    echo "⚠️  Skipping tier $tier: $ENV_FILE not found"
    continue
  fi

  LOG_FILE="$LOG_DIR/tier-$tier.log"

  # Stagger startup: 50ms delay between tiers
  sleep 0.05

  # Load env variables from file and run node
  (
    set -a
    . "$ENV_FILE"
    set +a
    exec node dist/index.js
  ) > "$LOG_FILE" 2>&1 &

  PID=$!
  echo "✓ Tier $tier (PID: $PID)"
done

echo ""
echo "✅ Launched $TIERS tiers. Logs in logs/ directory"
echo ""
echo "Monitor:"
echo "  ps aux | grep 'node dist/index' | grep -v grep | wc -l"
echo "  tail -f logs/tier-1.log"
