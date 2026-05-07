# Breakout Agent Dashboard

Real-time stock breakout detection system with Type 1 (Fresh), Type 2 (Setup), and Type 3 (Extension) signal classification.

## Quick Start

### Prerequisites
- Node.js v18+
- PostgreSQL (local or remote)
- pm2 (process manager)

### Installation

```bash
npm install
npm run build

# Install pm2 globally (if not already installed)
npm install -g pm2
```

### Configuration

Create `.env` file with:
```
DATABASE_URL=postgresql://user@localhost:5432/signal_forge
FMP_API_KEY=your_fmp_key
CRON_SCHEDULE=0 11 * * *  # 11:00 AM ET daily
```

## Running with PM2

### Start Processes
```bash
pm2 start dist/index.js --name "breakout-agent-scheduler"
pm2 start "npm run dashboard" --name "breakout-dashboard"
pm2 save
```

### Monitor
```bash
pm2 status              # See all processes
pm2 logs               # View real-time logs
pm2 monit              # CPU/memory usage
pm2 delete all         # Stop all processes
```

### Auto-restart on Reboot
```bash
pm2 startup
pm2 save
```

## Signal Types

| Type | Name | Confidence | Description |
|------|------|-----------|-------------|
| **Type 1** | Fresh Breakout | 99% | Green cone: true breakout with meaningful consolidation |
| **Type 2** | Pre-Breakout Setup | 80-99% | Consolidation awaiting breakout (not yet broken out) |
| **Type 3** | Extension | ≤85% | Yellow dot: re-test of past breakout, still holding gains |

## Dashboard

Access at: **http://localhost:3000**

### Features
- Filter by signal type (Type 1/2/3)
- Confidence slider (85-99%)
- Asset search
- 30-day price chart with resistance/support lines
- Shortlist management
- Live signal updates (5-second refresh)

### Scheduled Scans
- **Time:** 11:00 AM ET daily (configurable via `CRON_SCHEDULE`)
- **Assets:** S&P 500 (configurable)
- **Data Source:** Financial Modeling Prep (FMP API)

## Development

```bash
npm run build         # TypeScript compile
npm run dev          # Watch mode + nodemon
npm run start        # Run agent once
npm run dashboard    # Run dashboard only (dev)
```

## Architecture

- **Agent** (`src/agent.ts`): Analyzes assets, generates signals
- **Breakout Logic** (`src/tools/breakout-logic.ts`): Pine Script green cone detection
- **Market Data** (`src/tools/market-data.ts`): FMP API + caching
- **Server** (`server.js`): Express API + static dashboard
- **Database** (`prisma/schema.prisma`): PostgreSQL with Prisma ORM

## API Endpoints

### GET `/api/signals`
Returns high/medium confidence signals sorted by confidence.

```json
{
  "highConfidence": [...],
  "mediumConfidence": [...],
  "stats": {
    "highConfidenceCount": 171,
    "mediumConfidenceCount": 22,
    "breakoutCount": 0,
    "extensionCount": 11,
    "setupCount": 182
  }
}
```

### GET `/api/candles/:symbol`
Historical price data (500 bars) for chart rendering.

### POST `/api/scan`
Trigger on-demand market scan (runs in background).

### GET/POST `/api/shortlist`
Manage saved assets.

## Troubleshooting

### Process Won't Start
```bash
pm2 logs breakout-agent-scheduler  # Check error logs
pm2 restart 0                       # Restart specific process
```

### Database Connection Error
```bash
# Verify PostgreSQL is running
psql -U nipunsud -d signal_forge -c "SELECT 1"
```

### High Memory Usage
- Reduce `TIER_SIZE` in config.ts
- Check FMP API rate limiting

## Future Enhancements

- [ ] Backtest historical signals
- [ ] Email alerts for Type 1 breakouts
- [ ] Mobile app for signal notifications
- [ ] Multi-timeframe analysis (daily/4h/1h)
- [ ] Custom consolidation detection rules
