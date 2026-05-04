#!/bin/bash

# Generate tiered .env files for distributed scanning
# Usage: ./scripts/generate-tier-envs.sh 50 60

set -e

TIER_SIZE=${1:-50}
NUM_TIERS=${2:-60}
BASE_ENV="./apps/breakout-agent/.env"
OUTPUT_DIR=".env.tiers"

if [ ! -f "$BASE_ENV" ]; then
  echo "Error: Base .env not found: $BASE_ENV"
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

echo "Generating $NUM_TIERS tier files (size=$TIER_SIZE)..."

for i in $(seq 1 $NUM_TIERS); do
  ENV_FILE="$OUTPUT_DIR/.env.tier-$i"

  # Copy base .env and update tier-specific values
  cp "$BASE_ENV" "$ENV_FILE"

  # Update tier number and size
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/^ASSETS_TIER=.*/ASSETS_TIER=$i/" "$ENV_FILE"
    sed -i '' "s/^ASSETS_TIER_SIZE=.*/ASSETS_TIER_SIZE=$TIER_SIZE/" "$ENV_FILE"
  else
    sed -i "s/^ASSETS_TIER=.*/ASSETS_TIER=$i/" "$ENV_FILE"
    sed -i "s/^ASSETS_TIER_SIZE=.*/ASSETS_TIER_SIZE=$TIER_SIZE/" "$ENV_FILE"
  fi

  echo "✓ Created $ENV_FILE (tier $i)"
done

echo ""
echo "✅ Generated $NUM_TIERS .env files in $OUTPUT_DIR/"
echo ""
echo "Next steps:"
echo "1. Edit .env.tiers/.env.tier-1 to add your API keys and database URL"
echo "2. Copy to all tiers:"
echo ""
echo "   for f in .env.tiers/.env.tier-*; do"
echo "     sed -i.bak 's/your-key-here/YOUR_ACTUAL_KEY/g' \"\$f\""
echo "   done"
echo ""
echo "3. Run with Docker Compose:"
echo ""
echo "   docker-compose -f docker-compose.tiers.yml up -d"
echo ""
echo "Or run locally:"
echo ""
echo "   for i in $(seq 1 $NUM_TIERS); do"
echo "     (cd apps/breakout-agent && TIER=\$i npm run dev) &"
echo "   done"
echo ""
