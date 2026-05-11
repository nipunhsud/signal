# Signal Forge 🚀

Multi-agent trading signal platform. Start with breakout detection, scale to many agents.

## Architecture

```
packages/core/       → Shared agent infrastructure (TradeAgent, parser, types)
apps/breakout-agent/ → First agent (breakout detection with Gemini validation)
prisma/             → Shared database schema (extensible for future agents)
scripts/            → Pine Scripts reference (breakout-scanner.pine)
```

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:

- `GEMINI_API_KEY` — Get from [Google AI Studio](https://aistudio.google.com)
- `DATABASE_URL` — Postgres connection (Railway, Supabase, local)
- `EMAIL_*` — Gmail app password or SendGrid key
- `SCAN_ASSETS` — Comma-separated (e.g., `BTCUSDT,ETHUSDT`)

### 3. Setup Database

```bash
cd apps/breakout-agent
npx prisma migrate dev --name init
npx prisma generate
```

### 4. Run Breakout Agent

```bash
npm run dev
```

Scans assets every hour (or per `CRON_SCHEDULE`), stores signals in DB, sends email alerts.

## Adding a New Agent

1. Create `apps/new-agent/`
2. Copy structure from `apps/breakout-agent/`
3. Implement your agent logic in `src/agent.ts`
4. Add tools in `src/tools/`
5. Add DB schema to `prisma/schema.prisma` if needed
6. Deploy alongside breakout agent

## Environment Variables

See `.env.example` for full reference.

**Key configs:**

- `DATA_SOURCE` — `fmp` (Financial Modeling Prep), `binance` (crypto), or `alpaca` (stocks)
- `CRON_SCHEDULE` — Standard cron format (default: hourly)
- `SCAN_ASSETS` — Which symbols to monitor (CSV list)

**FMP Screener filtering (parallel Docker tier setup):**

- `MIN_MARKET_CAP` — Minimum market cap in dollars (default: `300000000` = $300M)
- `MIN_VOLUME` — Minimum average daily volume in shares (default: `100000`)
- `DYNAMIC_ASSETS` — Set to `true` to fetch filtered universe from FMP

**Sharding & rate limiting (for 5-tier parallel scan):**

- `SHARD_INDEX` — Which tier this is (0-4, set per `.env.tiers/.env.tier-N`)
- `SHARD_TOTAL` — Total number of tiers (default: `5`)
- `RATE_LIMIT_PER_MIN` — API calls per minute for this container (default: `140`)

## Docker Troubleshooting

**Docker not running:**

```bash
# Start Docker Desktop
open /Applications/Docker.app
```

**Build fails with "Module '@prisma/client' not found":**

- Dockerfile runs `prisma generate` before TypeScript compilation
- If still failing: rebuild with `docker-compose down && docker-compose up -d --build`

**Build fails with "Command 'build' not found":**

- Dockerfile copies full monorepo structure (pnpm-workspace.yaml, packages/, prisma/)
- Uses `pnpm -F breakout-agent build` to build only the agent app

## Deployment

### Railway

1. Push to GitHub
2. Connect repo to Railway
3. Set env vars from `.env.example`
4. Add Postgres add-on
5. Deploy

Agent runs 24/7, sends alerts as signals fire.

### Docker (Local/VPS)

**Single agent:**

```bash
docker build -t signal-forge .
docker run -d --env-file .env signal-forge
```

**Parallel 5-tier scan with FMP (750 calls/min limit):**

The fastest way to scan 3,000+ liquid US stocks (~26 minutes total):

```bash
# Start all 5 tiers with PM2 for persistent monitoring
pm2 start ecosystem.config.js
pm2 logs signal-forge-scan
pm2 save
```

Or run directly without PM2:

```bash
docker-compose up --build agent-tier-1 agent-tier-2 agent-tier-3 agent-tier-4 agent-tier-5
```

**How it works:**

- **FMP Screener filters** assets to: market cap >$300M + avg volume >100k shares
- **Universe reduced**: ~15,908 → ~3,000 liquid stocks (80% fewer API calls)
- **5 Docker containers** process shards in parallel (modulo sharding for even distribution)
- **Per-container rate limit**: 140 calls/min × 5 = 700/min total (under 750 hard cap)
- **Estimated scan time**: ~26 minutes for full filtered universe
- **Cache layer**: 5-min TTL reduces actual API calls by 60-70%

**Access dashboard:**

```bash
# http://localhost:3000
```

**View logs:**

```bash
# With PM2
pm2 logs signal-forge-scan -f

# Or with docker-compose
docker-compose logs -f agent-tier-1
```

**Customize filters:**
Edit `.env.tiers/.env.tier-{1..5}`:

```bash
MIN_MARKET_CAP=500000000  # $500M instead of $300M
MIN_VOLUME=200000         # 200k instead of 100k
```

Then restart:

```bash
pm2 restart signal-forge-scan
```

**Rescan with fresh database:**

When asked to rescan, always rebuild Docker images to clear the Prisma client cache:

```bash
pm2 stop signal-forge-scan
docker-compose down
docker-compose build --no-cache agent-tier-1 agent-tier-2 agent-tier-3 agent-tier-4 agent-tier-5
pm2 start ecosystem.config.js
pm2 logs signal-forge-scan
```

The `--no-cache` flag ensures Prisma client regenerates with the latest schema, preventing "column does not exist" errors.

## Tech Stack

- **Agent Framework** — Gemini 2.5 Flash + Node.js
- **Scheduling** — node-cron
- **Database** — Prisma + Postgres
- **Data** — Binance/Alpaca APIs
- **Email** — Nodemailer
- **Monorepo** — Turborepo

## References

- Pine Script: `scripts/breakout-scanner.pine` (original TradingView indicator)
- Agent patterns: Similar to SmartShop's CatalogAgent/HesitationAgent
