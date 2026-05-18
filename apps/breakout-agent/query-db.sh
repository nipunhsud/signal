#!/bin/bash

# PostgreSQL query tool for Signal Forge database
# Usage: ./query-db.sh [command] [args...]

DB_URL="postgresql://nipunsud@localhost:5432/signal_forge"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

show_help() {
  cat << 'EOF'
PostgreSQL Query Tool for Signal Forge

USAGE:
  ./query-db.sh [command] [options]

COMMANDS:
  signals [type] [limit]     List recent signals (type: all|breakout|setup)
  breakouts [limit]          List recent breakout signals
  setups [limit]             List recent setup signals
  assets [filter]            List all analyzed assets
  stats [hours]              Signal statistics for last N hours
  live [interval]            Live signal monitor (refresh every N seconds)
  search <symbol>            Find all signals for a symbol
  sql <query>                Execute raw SQL query
  top-assets [limit]         Top assets by signal count
  asset-types                Count by asset type (stock vs etf)
  cache-status               Show cache efficiency info
  help                       Show this help

EXAMPLES:
  ./query-db.sh signals                    # All signals, last 24h
  ./query-db.sh breakouts 50               # Last 50 breakout signals
  ./query-db.sh search AAPL                # All signals for AAPL
  ./query-db.sh stats 12                   # Statistics for last 12 hours
  ./query-db.sh live 5                     # Monitor updates every 5 seconds
  ./query-db.sh top-assets 20              # Top 20 assets by signal count
  ./query-db.sh sql "SELECT * FROM Signal LIMIT 5"

EOF
}

# Execute query
query() {
  psql "$DB_URL" -t -c "$1" 2>&1
}

query_formatted() {
  psql "$DB_URL" -c "$1" 2>&1
}

# Signals command
cmd_signals() {
  local type="${1:-all}"
  local limit="${2:-50}"

  local where=""
  case "$type" in
    breakout) where="AND agentName = 'BreakoutAgent' AND signalType NOT LIKE 'setup-%'" ;;
    setup) where="AND signalType LIKE 'setup-%'" ;;
  esac

  query_formatted "
    SELECT
      asset,
      \"signalType\",
      ROUND(confidence::numeric, 2) as conf,
      \"shouldAlert\" as alert,
      TO_CHAR(\"createdAt\", 'YYYY-MM-DD HH24:MI') as created
    FROM \"Signal\"
    WHERE \"createdAt\" > NOW() - INTERVAL '24 hours'
    $where
    ORDER BY \"createdAt\" DESC
    LIMIT $limit;
  "
}

# Breakout signals
cmd_breakouts() {
  local limit="${1:-20}"
  query_formatted "
    SELECT
      asset,
      ROUND(confidence::numeric, 2) as confidence,
      resistance,
      support,
      ROUND(\"currentPrice\"::numeric, 2) as price,
      \"pineScriptGreen\" as green,
      TO_CHAR(\"createdAt\", 'YYYY-MM-DD HH24:MI') as created
    FROM \"BreakoutSignal\"
    WHERE confidence >= 0.80
      AND \"createdAt\" > NOW() - INTERVAL '24 hours'
    ORDER BY \"createdAt\" DESC NULLS LAST
    LIMIT $limit;
  "
}

# Setup signals
cmd_setups() {
  local limit="${1:-20}"
  query_formatted "
    SELECT
      asset,
      ROUND(confidence::numeric, 2) as confidence,
      metadata->>'setupType' as type,
      metadata->>'sector' as sector,
      TO_CHAR(\"createdAt\", 'YYYY-MM-DD HH24:MI') as created
    FROM \"Signal\"
    WHERE \"signalType\" LIKE 'setup-%'
      AND confidence >= 0.80
      AND \"createdAt\" > NOW() - INTERVAL '24 hours'
    ORDER BY \"createdAt\" DESC
    LIMIT $limit;
  "
}

# Asset search
cmd_search() {
  local symbol="$1"
  if [ -z "$symbol" ]; then
    echo "Usage: search <symbol>"
    return 1
  fi

  query_formatted "
    SELECT
      asset,
      \"signalType\",
      ROUND(confidence::numeric, 2) as confidence,
      TO_CHAR(\"createdAt\", 'YYYY-MM-DD HH24:MI') as created
    FROM \"Signal\"
    WHERE asset = '$symbol'
    ORDER BY \"createdAt\" DESC
    LIMIT 20;
  "
}

# Statistics
cmd_stats() {
  local hours="${1:-24}"
  query_formatted "
    SELECT
      COUNT(*) as total_signals,
      COUNT(DISTINCT asset) as distinct_assets,
      ROUND(AVG(confidence)::numeric, 3) as avg_confidence,
      SUM(CASE WHEN \"shouldAlert\" THEN 1 ELSE 0 END) as alert_count
    FROM \"Signal\"
    WHERE \"createdAt\" > NOW() - INTERVAL '$hours hours';
  "
}

# Top assets
cmd_top_assets() {
  local limit="${1:-20}"
  query_formatted "
    SELECT
      asset,
      COUNT(*) as signal_count,
      ROUND(AVG(confidence)::numeric, 2) as avg_confidence
    FROM \"Signal\"
    WHERE \"createdAt\" > NOW() - INTERVAL '24 hours'
    GROUP BY asset
    ORDER BY COUNT(*) DESC NULLS LAST
    LIMIT $limit;
  "
}

# Asset types
cmd_asset_types() {
  query_formatted "
    SELECT
      COALESCE(metadata->>'assetType', 'unknown') as asset_type,
      COUNT(*) as count,
      ROUND(AVG(confidence)::numeric, 2) as avg_confidence
    FROM \"Signal\"
    WHERE \"createdAt\" > NOW() - INTERVAL '24 hours'
    GROUP BY COALESCE(metadata->>'assetType', 'unknown')
    ORDER BY count DESC NULLS LAST;
  "
}

# Live monitor
cmd_live() {
  local interval="${1:-5}"
  while true; do
    clear
    echo -e "${BLUE}=== Signal Forge Live Monitor ===${NC}"
    echo "Updated: $(date '+%Y-%m-%d %H:%M:%S')"
    echo ""

    query_formatted "
      SELECT
        'Signals (24h)' as metric,
        COUNT(*)::text as value
      FROM \"Signal\"
      WHERE \"createdAt\" > NOW() - INTERVAL '24 hours'

      UNION ALL

      SELECT
        'Distinct Assets',
        COUNT(DISTINCT asset)::text
      FROM \"Signal\"
      WHERE \"createdAt\" > NOW() - INTERVAL '24 hours'

      UNION ALL

      SELECT
        'Recent (1min)',
        COUNT(*)::text
      FROM \"Signal\"
      WHERE \"createdAt\" > NOW() - INTERVAL '1 minute'
    "

    echo ""
    echo "Top 10 assets by signals:"
    query_formatted "
      SELECT
        asset,
        COUNT(*) as count
      FROM \"Signal\"
      WHERE \"createdAt\" > NOW() - INTERVAL '1 hour'
      GROUP BY asset
      ORDER BY COUNT(*) DESC NULLS LAST
      LIMIT 10;
    "

    echo ""
    echo "Refreshing in ${interval}s... (Ctrl+C to exit)"
    sleep "$interval"
  done
}

# Raw SQL
cmd_sql() {
  local sql="$1"
  if [ -z "$sql" ]; then
    echo "Usage: sql <query>"
    return 1
  fi
  query_formatted "$sql"
}

# Main
if [ $# -eq 0 ]; then
  show_help
  exit 0
fi

case "$1" in
  help) show_help ;;
  signals) cmd_signals "$2" "$3" ;;
  breakouts) cmd_breakouts "$2" ;;
  setups) cmd_setups "$2" ;;
  search) cmd_search "$2" ;;
  stats) cmd_stats "$2" ;;
  live) cmd_live "$2" ;;
  top-assets) cmd_top_assets "$2" ;;
  asset-types) cmd_asset_types ;;
  cache-status)
    echo "Cache TTL: 5 minutes"
    echo "Cache type: In-memory (market data)"
    echo "Current cache hits logged as: 'Cache hit for {symbol}'"
    ;;
  sql) shift; cmd_sql "$@" ;;
  *)
    echo "Unknown command: $1"
    show_help
    exit 1
    ;;
esac
