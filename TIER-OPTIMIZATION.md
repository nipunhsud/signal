# Tier Optimization: 100 Tiers → 10 Tiers + Rate Limiting

## Problem
- **100 parallel tiers** × ~63 assets/tier × 2-3 FMP calls/asset = ~15,750 concurrent calls
- FMP limit: **750 calls/min** — you're exceeding it **20x over**
- Result: Rate limit errors, failed scans, wasted API calls

## Solution Implemented
✅ **Rate limiter** (750 calls/min, globally enforced)
✅ **Market data cache** (5-min TTL, ~60-70% fewer API calls)
✅ **Increased per-tier concurrency** (CONCURRENCY=5, safe with rate limiting)

## Step 1: Regenerate Tier Configs (10 tiers instead of 100)

```bash
cd /Users/nipunsud/github/signal-forge
rm -rf .env.tiers  # Clean up old 100-tier configs
mkdir -p .env.tiers

./scripts/generate-tier-envs.sh 627 10  # 6,270 ÷ 10 = 627 assets/tier
```

This creates `.env.tier-1` through `.env.tier-10`, each with ~627 assets.

## Step 2: Update docker-compose.yml

Generate a new docker-compose with 10 services instead of 100:

```bash
python3 scripts/generate-docker-compose.py 10 > docker-compose.yml
```

Or manually edit: keep `agent-tier-1` through `agent-tier-10`, delete `agent-tier-11` onwards.

## Step 3: Restart Stack

```bash
docker-compose down
docker-compose up -d
```

## Expected Results

### Before (100 Tiers)
- Full scan: ~6,270 assets in parallel
- Peak FMP calls: ~15,750 concurrent (rate-limited to hell)
- Time to scan all assets: ~30-60 seconds (blocked by rate limits)
- Error rate: ~20-40% due to 429 errors

### After (10 Tiers + Optimizations)
- Full scan: 10 sequential tiers, each ~627 assets with 5 concurrency
- Peak FMP calls: ~25-30 actual requests (rate-limited at 12/sec = 720/min)
- Time to scan all assets: ~15 minutes total (6270 assets ÷ 10 tiers ÷ (2-3 calls/asset with caching))
- Error rate: <1% (rate limiter prevents overages)
- Cache hit rate: ~60-70% (same assets checked within 5-min window)

## Architecture Diagram

```
Tier 1 (627 assets)   ┐
Tier 2 (627 assets)   ├─→ Rate Limiter (750/min) ─→ FMP API
...                   │     + Cache (5-min TTL)
Tier 10 (627 assets)  ┘

Per-tier: CONCURRENCY=5 (5 assets processed in parallel per tier)
Between tiers: Sequential (tier 1 finishes, tier 2 starts ~90 seconds later)
Result: Smooth 720 calls/min, cache reduces actual API calls by 60-70%
```

## Monitoring

Check cache hit rate:
```bash
# In agent logs, look for "Cache hit" messages
docker logs signal-forge-breakout-agent-tier-1 | grep "Cache hit" | wc -l
```

## Rollback

If you need to go back to 100 tiers (not recommended):
```bash
git checkout docker-compose.yml
git checkout .env.tiers/
docker-compose up -d
```
