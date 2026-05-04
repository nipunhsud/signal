# Docker Setup for Signal Forge

Run multiple breakout agent tiers in parallel with Docker.

## Prerequisites

- Docker & Docker Compose installed
- PostgreSQL running (or use the included postgres service)

## Quick Start

### 1. Generate Tier Config Files

```bash
# Generate 60 tiers (3,000 assets total)
./scripts/generate-tier-envs.sh nasdaq 50 60

# Or for NYSE (3,000+ assets)
./scripts/generate-tier-envs.sh nyse 50 61

# Or for NSE (500 Indian stocks)
./scripts/generate-tier-envs.sh nse 50 10
```

This creates `.env.tiers/.env.tier-1` through `.env.tier-N`

### 2. Update Generated Env Files

Edit `.env.tiers/.env.tier-*` files to add:
- `GEMINI_API_KEY=your-key`
- `FMP_API_KEY=your-key` (if using FMP)
- `EMAIL_USER=` and `EMAIL_PASS=` (for alerts)

### 3. Create .env for Docker

```bash
cp .env.example .env.docker
```

Edit `.env.docker`:
```env
DB_USER=nipunsud
DB_PASSWORD=your-secure-password
COMPOSE_PROJECT_NAME=signal-forge
```

### 4. Start Services

```bash
# Start all services
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f agent-tier-1
docker-compose logs -f dashboard
```

## Configuration

### Run Specific Tiers Only

Edit `docker-compose.yml` and remove or comment out tier services you don't need.

### Adjust Tier Count

The included compose file runs **5 tiers** (250 assets). To run more:

1. Generate more tier files: `./scripts/generate-tier-envs.sh nasdaq 50 60`
2. Add more services to `docker-compose.yml`:

```yaml
agent-tier-6:
  build: ...
  env_file: .env.tiers/.env.tier-6
  # ... etc
```

Or use a script to auto-generate services.

### Database

- **Default**: Uses Docker postgres container, data persists in `postgres_data` volume
- **External**: Set `DATABASE_URL` in docker-compose.yml to connect to existing Postgres

## Monitoring

### Dashboard
- Access at `http://localhost:3000`
- Shows signals from all tiers in real-time

### Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f agent-tier-1

# Dashboard only
docker-compose logs -f dashboard

# Database
docker-compose logs -f postgres
```

### Database Queries

```bash
# Connect to database
docker-compose exec postgres psql -U nipunsud -d signal_forge

# View signals
SELECT asset, confidence, signalType FROM "BreakoutSignal" 
ORDER BY "createdAt" DESC LIMIT 20;

# Count signals per hour
SELECT DATE_TRUNC('hour', "createdAt"), COUNT(*) 
FROM "BreakoutSignal" 
GROUP BY DATE_TRUNC('hour', "createdAt") 
ORDER BY 1 DESC;
```

## Operations

### Start/Stop

```bash
# Start all
docker-compose up -d

# Stop all
docker-compose down

# Restart services
docker-compose restart agent-tier-1

# Rebuild (after code changes)
docker-compose up -d --build
```

### View Running Agents

```bash
docker-compose ps
```

### Check Agent Logs

```bash
# Last scan for each tier
docker-compose logs --tail 5 agent-tier-1
docker-compose logs --tail 5 agent-tier-2
```

### Troubleshooting

```bash
# Check if database is healthy
docker-compose logs postgres

# Check if agents can connect to database
docker-compose logs agent-tier-1 | grep -i database

# Rebuild images if code changed
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

## Performance

- **5 tiers × 50 assets = 250 assets scanned per hour** (concurrently)
- **50 tiers × 50 assets = 2,500 assets scanned per hour** (concurrently)
- Each tier runs independently on its own cron schedule

## Next Steps

1. Install Docker
2. Run setup steps above
3. Visit http://localhost:3000
4. Monitor signals in real-time
