# Deployment Guide

Signal Forge runs all agents (breakout, sentiment, trading, etc.) in a single Railway deployment.

---

## Prerequisites

- GitHub account (push code)
- Railway account (free tier available)
- Postgres database (Railway provides)
- Environment secrets (API keys)

---

## Railway Deployment (Recommended)

### **1. Connect Repo to Railway**

```bash
# Push to GitHub first
git init
git add .
git commit -m "Initial commit: Signal Forge monorepo"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/signal-forge.git
git push -u origin main
```

Then on [railway.app](https://railway.app):
1. Click **New Project**
2. Select **Deploy from GitHub**
3. Authorize GitHub, select `signal-forge` repo
4. Railway auto-detects `package.json`, configures Node.js

### **2. Add Postgres Database**

In Railway dashboard:
1. Click **+ Add Service**
2. Select **Postgres**
3. Railway creates `DATABASE_URL` automatically

### **3. Set Environment Variables**

In Railway, **Variables** tab, add:

```
GEMINI_API_KEY=your-key
DATABASE_URL=postgres://...  # Auto-filled by Railway
EMAIL_SERVICE=gmail
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
ALERT_EMAIL=alerts@example.com

# Breakout Agent
SCAN_ASSETS=BTCUSDT,ETHUSDT
DATA_SOURCE=binance
CRON_SCHEDULE=0 * * * *

# Sentiment Agent (if enabled)
NEWSAPI_KEY=your-key
SENTIMENT_THRESHOLD=0.7

# Trading Agent (if enabled)
ALPACA_API_KEY=your-key
USE_PAPER_TRADING=true
```

### **4. Configure Build & Start**

Railway should auto-detect:
- **Build**: `npm install && npm run build`
- **Start**: `npm run dev`

If not, set manually:
- **Build Command**: `npm run build`
- **Start Command**: `npm run dev`

### **5. Setup Database**

In Railway **Deployments** tab, run migrations:

```bash
npx prisma migrate deploy
```

Or use **Dockerfile** approach (see below).

### **6. Deploy**

```bash
git push origin main
```

Railway auto-detects changes, rebuilds, redeploys. All agents start immediately.

---

## Docker Deployment (VPS/Self-Hosted)

For AWS, DigitalOcean, Render, etc.

### **Dockerfile**

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Build
COPY . .
RUN npm run build

# Prisma
RUN npx prisma generate

# Run all agents
CMD ["npm", "run", "dev"]
```

### **docker-compose.yml**

```yaml
version: '3.8'

services:
  app:
    build: .
    environment:
      DATABASE_URL: postgresql://user:password@db:5432/signal_forge
      GEMINI_API_KEY: ${GEMINI_API_KEY}
      EMAIL_USER: ${EMAIL_USER}
      EMAIL_PASS: ${EMAIL_PASS}
    depends_on:
      - db
    volumes:
      - .:/app
      - /app/node_modules

  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
      POSTGRES_DB: signal_forge
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

**Run:**

```bash
docker-compose up -d
docker-compose exec app npx prisma migrate deploy
```

---

## Environment Variables

### **Required**

```
GEMINI_API_KEY          # From Google AI Studio
DATABASE_URL            # Postgres connection string
EMAIL_USER              # Gmail or SendGrid account
EMAIL_PASS              # Gmail app password or SendGrid key
ALERT_EMAIL             # Where to send alerts
```

### **Breakout Agent**

```
SCAN_ASSETS=BTCUSDT,ETHUSDT    # Comma-separated
DATA_SOURCE=binance             # or alpaca
CRON_SCHEDULE=0 * * * *         # Hourly (standard cron)
```

### **Optional: Sentiment Agent**

```
NEWSAPI_KEY=...
SENTIMENT_THRESHOLD=0.7
```

### **Optional: Trading Agent**

```
ALPACA_API_KEY=...
ALPACA_BASE_URL=https://data.alpaca.markets
USE_PAPER_TRADING=true          # Start with paper trading!
MAX_POSITION_SIZE=100
STOP_LOSS_PCT=0.05
```

---

## Database Migration

First-time setup:

```bash
# Local development
npx prisma migrate dev --name init

# Production (Railway)
# Option 1: In Railway dashboard, run shell
npx prisma migrate deploy

# Option 2: In Dockerfile (auto-run)
RUN npx prisma migrate deploy
```

Subsequent schema changes:

```bash
# Local: make changes to schema.prisma
npx prisma migrate dev --name describe_change

# Commit & push
git add prisma/
git commit -m "schema: add trading signals table"
git push

# Railway auto-runs migrations on deploy
```

---

## Monitoring & Logs

### **Railway Logs**

In Railway dashboard:
1. Click **Deployments**
2. Select latest deployment
3. **Logs** tab shows all agent output

Example output:

```
[2025-01-15T10:00:00Z] Breakout agent running. Schedule: 0 * * * *
[2025-01-15T11:00:00Z] Starting breakout scan...
[2025-01-15T11:00:23Z] Found 2 signals
[2025-01-15T11:00:24Z] ✓ Alert: BTCUSDT - Confidence: 0.82
[2025-01-15T11:00:25Z] Email sent: Breakout Alert: BTCUSDT

[2025-01-15T11:15:00Z] Checking news sentiment...
[2025-01-15T11:15:18Z] Analyzed 45 articles
[2025-01-15T11:15:19Z] ✓ Alert: 📰 BULLISH Sentiment: ETH
```

### **Metrics**

Use Prisma Studio to browse signals:

```bash
npx prisma studio
```

Or query via script:

```sql
-- Total signals by agent
SELECT 
  agent_name, 
  COUNT(*) as count, 
  AVG(confidence) as avg_confidence
FROM signals
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY agent_name;

-- Alerts sent today
SELECT COUNT(*) FROM signals WHERE should_alert = true AND created_at > NOW() - INTERVAL '24 hours';

-- Breakouts in last week
SELECT asset, COUNT(*) FROM breakout_signals WHERE created_at > NOW() - INTERVAL '7 days' GROUP BY asset;
```

---

## Scaling: Running Multiple Agents

All agents run in parallel within one Railway dyno:

```
┌─────────────────────────────────────────┐
│        Signal Forge (1 Railway App)     │
├─────────────────────────────────────────┤
│ Breakout Agent    (runs every 1h)      │
│ Sentiment Agent   (runs every 30min)   │
│ Trading Agent     (runs every 5min)    │
│ Arbitrage Agent   (runs every 15min)   │
└─────────────────────────────────────────┘
          ↓
      Shared DB (Postgres)
      Shared Email (Gmail)
      Shared Gemini API
```

If one agent fails, others continue running.

### **Separate Deployments (if needed)**

If you need independent scaling:

```bash
# Deploy only breakout-agent
railway deploy --service breakout-agent

# Deploy only trading-agent  
railway deploy --service trading-agent
```

But keep shared infra (DB, email, API keys) in `.env`.

---

## Troubleshooting

### **Agent Not Running**

```bash
# Check logs
railway logs

# SSH into app
railway shell

# Verify env vars
echo $GEMINI_API_KEY
echo $DATABASE_URL

# Test agent directly
npm run build && npm run dev
```

### **Database Connection Error**

```bash
# Verify DATABASE_URL format
postgresql://user:password@host:port/dbname

# Test connection
psql $DATABASE_URL

# Rebuild connection pool
npx prisma db push
```

### **Email Not Sending**

- Gmail: Ensure **App Passwords** enabled (2FA required)
- SendGrid: Check API key + SMTP settings
- Test locally: `npm run dev` should log email attempts

### **Agent Timeout**

Agents default to 1000ms output tokens. If truncated:

```typescript
// apps/breakout-agent/src/agent.ts
super({
  maxTokens: 2000  // Increase if needed
})
```

### **High Memory Usage**

- Check for memory leaks in tools
- Limit concurrent requests: `pLimit(3)`
- Use `prisma.$disconnect()` on shutdown

---

## Cost Estimate

| Service | Cost | Notes |
|---------|------|-------|
| Railway | $5-20/mo | Includes Postgres, always-on |
| Gemini API | Free | 15 RPM for free tier, or ~$0.075/1M tokens |
| Email | Free | Gmail, SendGrid, Resend all have free tiers |
| Binance/Alpaca | Free | Real-time market data |
| **Total** | **~$10-30/mo** | Production-ready |

---

## CI/CD Pipeline (Optional)

Add GitHub Actions for auto-testing before deploy:

```yaml
# .github/workflows/test.yml
name: Test & Deploy

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      - run: npm ci
      - run: npm run build
      - run: npm run test  # if tests exist
```

---

## References

- [Railway Docs](https://docs.railway.app)
- [Prisma Migrations](https://www.prisma.io/docs/concepts/components/prisma-migrate)
- [Docker Compose](https://docs.docker.com/compose/)
- [Cron Format](https://crontab.guru/)
