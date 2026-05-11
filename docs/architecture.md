# Signal Forge Architecture

## Core Principle

**Each agent is self-contained in `apps/`, shares common infra from `packages/core/`, everything deploys together.**

This allows rapid scaling from 1 agent to 10+ without refactoring.

---

## Monorepo Structure

```
signal-forge/
├── packages/
│   └── core/                    ← Shared infrastructure
│       ├── agent-base.ts        ← TradeAgent base class (all agents inherit)
│       ├── parser.ts            ← parseAgentResponse() (all agents use)
│       ├── types.ts             ← Shared interfaces (AgentResponse, Signal, etc.)
│       └── index.ts             ← Exports for all apps
│
├── apps/                        ← Self-contained agents
│   ├── breakout-agent/          ← Agent 1: Breakout detection
│   │   ├── src/
│   │   │   ├── agent.ts         ← Agent logic (inherits TradeAgent)
│   │   │   ├── tools/           ← Breakout-specific tools
│   │   │   │   ├── market-data.ts
│   │   │   │   └── breakout-logic.ts
│   │   │   ├── config.ts        ← Agent config (assets, schedule)
│   │   │   ├── email.ts         ← Alert delivery
│   │   │   ├── db.ts            ← DB client
│   │   │   └── index.ts         ← Entry point (scheduler + main loop)
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── sentiment-agent/         ← Agent 2: News sentiment (future)
│   │   ├── src/
│   │   │   ├── agent.ts
│   │   │   ├── tools/
│   │   │   │   ├── fetch-news.ts
│   │   │   │   └── analyze-sentiment.ts
│   │   │   └── ...
│   │   └── ...
│   │
│   ├── arbitrage-agent/         ← Agent 3: Price spreads (future)
│   │   ├── src/
│   │   │   ├── agent.ts
│   │   │   ├── tools/
│   │   │   │   ├── fetch-prices.ts
│   │   │   │   └── detect-arb.ts
│   │   │   └── ...
│   │   └── ...
│   │
│   └── trading-agent/           ← Agent 4: Execution (Phase 2)
│       ├── src/
│       │   ├── agent.ts
│       │   ├── tools/
│       │   │   ├── market-data.ts
│       │   │   ├── execute-order.ts
│       │   │   └── risk-management.ts
│       │   └── ...
│       └── ...
│
├── prisma/
│   └── schema.prisma            ← Shared database (one table per signal type)
│
├── scripts/
│   └── breakout-scanner.pine    ← Reference Pine Scripts
│
├── docs/
│   ├── architecture.md          ← This file
│   ├── adding-agents.md         ← How to add new agents
│   └── deployment.md            ← How to deploy all agents
│
├── .env.example                 ← One config for all agents
├── turbo.json                   ← Monorepo orchestration
└── package.json                 ← Root workspace config
```

---

## How Agents Work

### 1. **Inherits from Core**

```typescript
// apps/breakout-agent/src/agent.ts
import { TradeAgent } from "@signal-forge/core";

class BreakoutAgent extends TradeAgent {
  constructor() {
    super({
      name: "BreakoutAgent",
      description: "Detects bullish breakouts",
    });
  }

  async analyzeMarkets(assets: string[]) {
    // Tool-call → synthesis pattern
    // Uses parseAgentResponse() from core
  }
}
```

### 2. **Self-Contained Tools**

Each agent has its own tools folder. No cross-agent coupling:

```
breakout-agent/src/tools/
├── market-data.ts       ← Fetch OHLCV
├── breakout-logic.ts    ← Pine Script logic
└── correlations.ts      ← Optional: check related assets

sentiment-agent/src/tools/
├── fetch-news.ts        ← NewsAPI, RSS feeds
├── analyze-sentiment.ts ← NLP sentiment
└── cache-articles.ts    ← Optional: caching

trading-agent/src/tools/
├── execute-order.ts     ← Alpaca order API
├── risk-management.ts   ← Stop losses, sizing
└── monitor-position.ts  ← Track open trades
```

### 3. **Shared DB, Different Tables**

```prisma
// prisma/schema.prisma

model BreakoutSignal {
  id String @id
  asset String
  resistance Float
  confidence Float
  shouldAlert Boolean
  @@index([asset, createdAt])
}

model SentimentSignal {
  id String @id
  headline String
  sentiment Float // -1 to +1
  sources String[]
  confidence Float
  @@index([asset, createdAt])
}

model Trade {
  id String @id
  symbol String
  side String
  qty Int
  entryPrice Float
  exitPrice Float
  profitLoss Float
  @@index([symbol, createdAt])
}

// Generic table for new agents
model Signal {
  id String @id
  agentName String  // "BreakoutAgent", "SentimentAgent", etc.
  asset String
  signalType String
  confidence Float
  metadata Json     // Flexible for any agent
  @@index([agentName, asset])
}
```

### 4. **One Config, All Agents**

```bash
# .env
GEMINI_API_KEY=...
DATABASE_URL=...
EMAIL_USER=...

# Agent 1: Breakout
SCAN_ASSETS=BTCUSDT,ETHUSDT
DATA_SOURCE=binance
CRON_SCHEDULE=0 * * * *  # hourly

# Agent 2: Sentiment
FETCH_NEWS=true
SENTIMENT_THRESHOLD=0.7

# Agent 3: Trading
ALPACA_API_KEY=...
USE_PAPER_TRADING=true
MAX_POSITION_SIZE=100
```

---

## Scaling Pattern: Adding a New Agent

### **5-Minute Checklist**

1. **Copy template**

   ```bash
   cp -r apps/breakout-agent apps/my-agent
   ```

2. **Edit `src/agent.ts`**
   - Change class name
   - Define tools needed
   - Update prompt logic

3. **Add tools in `src/tools/`**
   - Fetch data
   - Analyze data
   - Return structured result

4. **Add config in `.env`** (if new params needed)

5. **Update `prisma/schema.prisma`** (if new signal type)

   ```prisma
   model MySignal {
     id String @id
     asset String
     confidence Float
     metadata Json
   }
   ```

6. **Deploy**
   ```bash
   npm run build      # Builds all agents
   git push           # Railway auto-deploys
   ```

**That's it.** Agent runs 24/7 alongside others.

---

## Deployment Model

### **Single Deploy = All Agents**

```bash
# Local
npm install
npm run build
npm run dev        # All agents start in parallel

# Railway
git push → Railway detects monorepo
         → Installs deps
         → Builds all apps
         → Starts all agents
         → All write to same DB
         → All send alerts
```

### **No Separate Configs or Deploys**

- ❌ NOT: Agent A deployed to Railway, Agent B to Heroku
- ✅ YES: All agents in one Railway app, one codebase, one `.env`

### **Operational Benefits**

- One Postgres database → all signals in one place
- One cron scheduler → all agents run on schedule
- One logging → all agent logs in one stream
- One monitoring → watch all agents from one dashboard

---

## Tech Stack (Shared Across All Agents)

| Layer               | Tech                                         |
| ------------------- | -------------------------------------------- |
| **Agent Framework** | Gemini 2.5 Flash (via @google/generative-ai) |
| **Runtime**         | Node.js 18+                                  |
| **Scheduling**      | node-cron (hourly, 4h, daily, etc.)          |
| **Database**        | Prisma + Postgres                            |
| **Monorepo**        | Turborepo (pnpm workspaces)                  |
| **Data Sources**    | Binance, Alpaca, NewsAPI, custom APIs        |
| **Alerts**          | Nodemailer (email, optional: webhooks)       |
| **IaC**             | Railway (or Docker for VPS)                  |

---

## Future Roadmap

### **Phase 1: Signals Only** ✅ In Progress

- Breakout agent detects signals
- Email alerts
- Manual trading based on alerts
- Test accuracy before automation

### **Phase 2: Paper Trading**

- Add TradingAgent with Alpaca paper mode
- Execute orders with fake money
- Validate signals in real market
- Build logs and P&L tracking

### **Phase 3: Real Trading**

- Flip `USE_PAPER_TRADING=false`
- Add risk management: stop losses, position sizing, daily loss limits
- Add monitoring: watch positions, close on targets
- Add performance dashboard

### **Phase 4: Multi-Agent Coordination**

- Sentiment agent feeds into breakout agent
- Arbitrage agent feeds into trading agent
- Macro agent provides context for all
- Agents vote on high-conviction setups

---

## Key Design Decisions

### **Why Monorepo?**

- ✅ Shared patterns (`TradeAgent`, `parseAgentResponse`)
- ✅ Single DB for all signals
- ✅ One deploy = all agents live
- ✅ Easy to add agents (copy → modify)
- ❌ No agent isolation (one bad agent could affect others)

### **Why Self-Contained Agents?**

- ✅ Each agent is independently testable
- ✅ Clear responsibility boundaries
- ✅ Reusable tools (market-data in multiple agents)
- ✅ Easy to disable/enable individual agents
- ✅ Multiple teams can work on different agents

### **Why Prisma + Postgres?**

- ✅ Type-safe queries across all agents
- ✅ Extensible schema (add tables for new agents)
- ✅ Free tier available (Railway includes)
- ✅ Backup + restore easy

---

## References

- [Turborepo Docs](https://turbo.build)
- [Prisma Schema](https://www.prisma.io/docs/concepts/components/prisma-schema)
- [node-cron](https://github.com/kelektiv/node-cron)
- [Gemini API](https://ai.google.dev)
