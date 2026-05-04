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
- `DATA_SOURCE` — `binance` (crypto) or `alpaca` (stocks)
- `CRON_SCHEDULE` — Standard cron format (default: hourly)
- `SCAN_ASSETS` — Which symbols to monitor

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

**Distributed tiers (60 agents + dashboard + postgres):**
```bash
# 1. Generate tier .env files from your base config
./scripts/generate-tier-envs.sh 50 60

# 2. Run all services
docker-compose up -d

# 3. Access dashboard
# http://localhost:3000

# 4. View logs
docker-compose logs -f agent-tier-1
docker-compose logs -f dashboard
```

**Parameters for tier generation:**
- `50` = assets per tier
- `60` = number of tiers
- Total assets scanned: 50 × 60 = 3,000

Adjust as needed:
```bash
./scripts/generate-tier-envs.sh 100 30   # 30 tiers × 100 assets
./scripts/generate-tier-envs.sh 25 120   # 120 tiers × 25 assets
```

### Optimized Setup: FMP API (750 calls/min limit)

If using Financial Modeling Prep (FMP) API with 6,270+ assets, use the rate-limited 10-tier config:

```bash
cd /Users/nipunsud/github/signal-forge
./scripts/generate-tier-envs.sh 627 10
python3 scripts/generate-docker-compose.py 10 > docker-compose.yml
docker-compose down && docker-compose up -d
```

This reduces from 100 parallel tiers to 10 sequential tiers with:
- **Global rate limiter** (750 calls/min, enforced across all instances)
- **Market data cache** (5-min TTL, ~60-70% fewer API calls)
- **Steady scan**: ~15 min full scan with <1% error rate (vs 20-40% with 100 tiers)

See [OPTIMIZATION-CHECKLIST.md](OPTIMIZATION-CHECKLIST.md) for details and monitoring.

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
