#!/bin/bash

# Stagger tier cron schedules across the hour to avoid API burst limits
# Instead of all 63 tiers running at :00, spread them out across 60 minutes

set -e

OUTPUT_DIR=".env.tiers"
TOTAL_TIERS=$(ls -1 "$OUTPUT_DIR"/.env.tier-* 2>/dev/null | wc -l)

echo "🕐 Staggering $TOTAL_TIERS tier cron schedules..."
echo "   Each tier will run at a different minute of the hour"
echo ""

for i in $(seq 1 $TOTAL_TIERS); do
  ENV_FILE="$OUTPUT_DIR/.env.tier-$i"

  if [ ! -f "$ENV_FILE" ]; then
    continue
  fi

  # Calculate minute (0-59) for this tier
  MINUTE=$((($i - 1) % 60))

  # Create new cron schedule: run at this specific minute every hour
  CRON_SCHEDULE="$MINUTE * * * *"

  # Update the env file (works on both macOS and Linux)
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/^CRON_SCHEDULE=.*/CRON_SCHEDULE=$CRON_SCHEDULE/" "$ENV_FILE"
  else
    sed -i "s/^CRON_SCHEDULE=.*/CRON_SCHEDULE=$CRON_SCHEDULE/" "$ENV_FILE"
  fi

  echo "✓ Tier $i → :$MINUTE of each hour"
done

echo ""
echo "✅ Staggered all tiers!"
echo ""
echo "Result:"
echo "  - Tier 1 runs at :00 (0 * * * *)"
echo "  - Tier 2 runs at :01 (1 * * * *)"
echo "  - Tier 3 runs at :02 (2 * * * *)"
echo "  - ... continuing through :59"
echo ""
echo "This spreads 63 tiers across 60 minutes, keeping API calls ~100-110/min average"
echo ""
echo "Next: Restart agents for new schedules to take effect"
echo "  pkill -f 'node dist/index'"
echo "  ./launch-tiers.sh 63"
