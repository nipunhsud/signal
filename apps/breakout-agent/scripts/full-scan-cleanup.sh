#!/bin/bash

# Full Scan with Database Cleanup
# This script:
# 1. Clears BreakoutSignal and Signal tables
# 2. Generates stock list for each tier
# 3. Launches 5 tiers with IMMEDIATE_SCAN=true
# 4. Saves processed stocks to a timestamped file

set -e

# Compute paths correctly
# Scripts are at: /Users/nipunsud/github/signal-forge/apps/breakout-agent/scripts
# Breakout agent is at: /Users/nipunsud/github/signal-forge/apps/breakout-agent
# Project root is at: /Users/nipunsud/github/signal-forge
SCRIPT_DIR="/Users/nipunsud/github/signal-forge/apps/breakout-agent/scripts"
BREAKOUT_DIR="/Users/nipunsud/github/signal-forge/apps/breakout-agent"
PROJECT_ROOT="/Users/nipunsud/github/signal-forge"
LOG_DIR="$BREAKOUT_DIR/logs"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
PROCESSED_STOCKS_FILE="$BREAKOUT_DIR/processed-stocks-${TIMESTAMP}.txt"

mkdir -p "$LOG_DIR"

echo "═══════════════════════════════════════════════════════════════"
echo "🔄 Full Database Cleanup & Multi-Tier Scan"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Step 1: Clear database
echo "📦 Step 1: Clearing BreakoutSignal and Signal tables..."
cd "$BREAKOUT_DIR"
node scripts/clear-db.js

if [ $? -ne 0 ]; then
  echo "❌ Failed to clear database"
  exit 1
fi
echo ""

# Step 2: Extract and save stocks for each tier
echo "📋 Step 2: Extracting stocks per tier..."
ASSETS_FILE="$PROJECT_ROOT/scripts/scanner-lists/combined-nasdaq-nyse-sp500.txt"

if [ ! -f "$ASSETS_FILE" ]; then
  echo "⚠️  Warning: $ASSETS_FILE not found"
  ASSETS=""
else
  # Parse assets from file (comma-separated)
  ASSETS=$(cat "$ASSETS_FILE" | tr ',' '\n' | xargs)
fi

# Create header for stock file
cat > "$PROCESSED_STOCKS_FILE" <<EOF
# Processed Stocks for Full Scan - ${TIMESTAMP}
# 5-tier sharded distribution of assets
# Format: TIER | STOCKS

EOF

# For each tier, calculate which stocks will be processed
TIER_COUNT=5
for tier_idx in $(seq 0 $((TIER_COUNT - 1))); do
  tier_num=$((tier_idx + 1))

  # Use awk to shard: keep indices where i % SHARD_TOTAL == SHARD_INDEX
  TIER_STOCKS=$(echo "$ASSETS" | tr ' ' '\n' | awk -v shard_idx=$tier_idx -v shard_total=$TIER_COUNT 'NR > 0 && (NR - 1) % shard_total == shard_idx {print}' | tr '\n' ' ')

  STOCK_COUNT=$(echo "$TIER_STOCKS" | wc -w)

  echo "Tier $tier_num: $STOCK_COUNT stocks"
  echo "" >> "$PROCESSED_STOCKS_FILE"
  echo "## Tier $tier_num (SHARD_INDEX=$tier_idx, $STOCK_COUNT stocks)" >> "$PROCESSED_STOCKS_FILE"
  echo "$TIER_STOCKS" >> "$PROCESSED_STOCKS_FILE"
done

echo "✅ Stock distribution saved to: $PROCESSED_STOCKS_FILE"
echo ""

# Step 3: Modify tier env files to enable IMMEDIATE_SCAN
echo "⚙️  Step 3: Enabling IMMEDIATE_SCAN on all tiers..."
for tier_num in $(seq 1 5); do
  ENV_FILE="$PROJECT_ROOT/.env.tiers/.env.tier-${tier_num}"

  if [ ! -f "$ENV_FILE" ]; then
    echo "⚠️  Skipping $ENV_FILE (not found)"
    continue
  fi

  # Remove existing IMMEDIATE_SCAN line if present, then add it
  sed -i '' '/^IMMEDIATE_SCAN=/d' "$ENV_FILE"
  echo "IMMEDIATE_SCAN=true" >> "$ENV_FILE"

  echo "✓ Tier $tier_num: IMMEDIATE_SCAN=true"
done

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "🚀 Step 4: Launching 5 tiers with full scan..."
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Build/compile first
cd "$BREAKOUT_DIR"
if [ -d "dist" ]; then
  echo "Rebuilding TypeScript..."
  npm run build || echo "Warning: Build had issues"
fi

# Launch tiers
for tier_num in $(seq 1 5); do
  ENV_FILE="$PROJECT_ROOT/.env.tiers/.env.tier-${tier_num}"

  if [ ! -f "$ENV_FILE" ]; then
    echo "⚠️  Skipping tier $tier_num: $ENV_FILE not found"
    continue
  fi

  LOG_FILE="$LOG_DIR/tier-${tier_num}.log"

  # Clear old log
  > "$LOG_FILE"

  # Stagger startup: 100ms delay
  sleep 0.1

  # Launch with IMMEDIATE_SCAN
  (
    set -a
    . "$ENV_FILE"
    set +a
    exec node dist/index.js 2>&1
  ) > "$LOG_FILE" 2>&1 &

  PID=$!
  echo "✓ Tier $tier_num launched (PID: $PID) | Log: $LOG_FILE"
done

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "✅ Scan launched on 5 tiers"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "📊 Monitoring:"
echo "   Active processes: ps aux | grep 'node dist/index' | grep -v grep | wc -l"
echo "   Tail tier 1:     tail -f $LOG_DIR/tier-1.log"
echo "   Tail tier 2:     tail -f $LOG_DIR/tier-2.log"
echo ""
echo "📋 Stock distribution saved to: $PROCESSED_STOCKS_FILE"
echo ""
echo "⏱️  Scans will complete and processes will exit automatically (IMMEDIATE_SCAN=true)"
echo ""
