# Adding New Agents to Signal Forge

Once you have the breakout agent running, adding a second agent is straightforward. This guide walks through the process.

---

## Quick Start: Copy → Customize

### **Step 1: Copy Template**

```bash
cd /Users/nipunsud/github/signal-forge
cp -r apps/breakout-agent apps/sentiment-agent
```

This gives you the full structure:

- `src/agent.ts` — Agent class
- `src/tools/` — Agent tools
- `src/config.ts` — Configuration
- `src/email.ts` — Alerts
- `package.json`, `tsconfig.json`

### **Step 2: Edit `package.json`**

```json
{
  "name": "sentiment-agent",
  "description": "News sentiment analysis agent"
  // ... rest stays same
}
```

### **Step 3: Implement Agent Logic**

Replace `src/agent.ts`:

```typescript
// apps/sentiment-agent/src/agent.ts
import { TradeAgent } from "@signal-forge/core";
import { fetchNews } from "./tools/fetch-news";
import { analyzeSentiment } from "./tools/analyze-sentiment";
import { sendEmail } from "./email";
import { db } from "./db";

export interface SentimentResult {
  asset: string;
  headline: string;
  sentiment: number; // -1 (bearish) to +1 (bullish)
  confidence: number;
  shouldAlert: boolean;
}

export class SentimentAgent extends TradeAgent {
  constructor() {
    super({
      name: "SentimentAgent",
      description: "Analyzes news sentiment for trading signals",
    });
  }

  async analyzeNews(assets: string[]): Promise<SentimentResult[]> {
    const results: SentimentResult[] = [];

    for (const asset of assets) {
      try {
        // Fetch relevant news
        const articles = await fetchNews(asset);

        for (const article of articles) {
          // Ask Gemini to analyze sentiment
          const prompt = `
Headline: ${article.headline}
Summary: ${article.summary}
Source: ${article.source}

Analyze this news for trading bias. Respond with JSON:
{
  "sentiment": -1 to 1,
  "confidence": 0-1,
  "reasoning": "..."
}
          `;

          const response = await this.run(prompt);
          const analysis = JSON.parse(response.decision);

          const result: SentimentResult = {
            asset,
            headline: article.headline,
            sentiment: analysis.sentiment,
            confidence: analysis.confidence,
            shouldAlert:
              Math.abs(analysis.sentiment) > 0.7 && analysis.confidence > 0.75,
          };

          results.push(result);

          // Store in DB
          await db.sentimentSignal.create({
            data: {
              asset,
              headline: article.headline,
              sentiment: result.sentiment,
              confidence: result.confidence,
              source: article.source,
            },
          });

          // Alert if strong signal
          if (result.shouldAlert) {
            await this.sendAlert(result);
          }
        }
      } catch (error) {
        console.error(`Error analyzing sentiment for ${asset}:`, error);
      }
    }

    return results;
  }

  async sendAlert(result: SentimentResult): Promise<void> {
    const bias = result.sentiment > 0 ? "BULLISH" : "BEARISH";
    const subject = `📰 ${bias} Sentiment: ${result.asset}`;
    const body = `
Headline: ${result.headline}
Sentiment: ${(result.sentiment * 100).toFixed(0)}%
Confidence: ${(result.confidence * 100).toFixed(0)}%

Time: ${new Date().toISOString()}
    `;

    await sendEmail(subject, body);
  }
}
```

### **Step 4: Add Tools**

Create tool files in `src/tools/`:

```typescript
// apps/sentiment-agent/src/tools/fetch-news.ts
import axios from "axios";

export interface Article {
  headline: string;
  summary: string;
  source: string;
  url: string;
  publishedAt: Date;
}

export async function fetchNews(asset: string): Promise<Article[]> {
  const apiKey = process.env.NEWSAPI_KEY;

  // Use NewsAPI, RSS feeds, or custom source
  const response = await axios.get("https://newsapi.org/v2/everything", {
    params: {
      q: asset,
      sortBy: "publishedAt",
      language: "en",
      pageSize: 10,
      apiKey,
    },
  });

  return response.data.articles.map((a: any) => ({
    headline: a.title,
    summary: a.description,
    source: a.source.name,
    url: a.url,
    publishedAt: new Date(a.publishedAt),
  }));
}
```

### **Step 5: Update Config**

Edit `src/config.ts`:

```typescript
export interface Config {
  assets: string[];
  newsSource: "newsapi" | "custom";
  sentimentThreshold: number; // alert threshold
  cronSchedule: string;
}

export function getConfig(): Config {
  return {
    assets: (process.env.SCAN_ASSETS || "BTC,ETH").split(","),
    newsSource: (process.env.NEWS_SOURCE || "newsapi") as "newsapi" | "custom",
    sentimentThreshold: parseFloat(process.env.SENTIMENT_THRESHOLD || "0.7"),
    cronSchedule: process.env.CRON_SCHEDULE || "*/30 * * * *", // every 30min
  };
}
```

### **Step 6: Update Entry Point**

Edit `src/index.ts`:

```typescript
import "dotenv/config";
import cron from "node-cron";
import { SentimentAgent } from "./agent";
import { getConfig } from "./config";

const config = getConfig();
const agent = new SentimentAgent();

async function scan() {
  console.log(`[${new Date().toISOString()}] Checking news sentiment...`);
  try {
    const results = await agent.analyzeNews(config.assets);
    console.log(`Analyzed ${results.length} articles`);
  } catch (error) {
    console.error("Scan failed:", error);
  }
}

scan();
cron.schedule(config.cronSchedule, scan);
console.log(`Sentiment agent running. Schedule: ${config.cronSchedule}`);
```

### **Step 7: Add DB Schema**

Update `prisma/schema.prisma`:

```prisma
model SentimentSignal {
  id String @id @default(cuid())

  asset String
  headline String
  sentiment Float    // -1 to +1
  confidence Float
  source String

  shouldAlert Boolean @default(false)
  createdAt DateTime @default(now())

  @@index([asset, createdAt])
  @@index([sentiment])
}
```

### **Step 8: Update Env Config**

Add to `.env`:

```bash
# Sentiment Agent
NEWSAPI_KEY=your_key_here
NEWS_SOURCE=newsapi
SENTIMENT_THRESHOLD=0.7
```

### **Step 9: Test & Deploy**

```bash
# Install new dependencies
npm install

# Migrate DB with new schema
npx prisma migrate dev --name add_sentiment_signal

# Run both agents
npm run dev

# When ready
npm run build
git push  # Railway auto-deploys both agents
```

---

## Reusable Patterns

### **Inherit from TradeAgent**

All agents should extend `TradeAgent` from `@signal-forge/core`:

```typescript
class MyAgent extends TradeAgent {
  constructor() {
    super({
      name: "MyAgent",
      description: "Does X",
      model: "gemini-2.5-flash", // or other models
    });
  }
}
```

### **Use parseAgentResponse()**

Gemini responses are parsed by core utility:

```typescript
import { parseAgentResponse } from "@signal-forge/core";

const response = await this.run(prompt);
const parsed = parseAgentResponse(response.raw);
// parsed = { decision, signals, confidence, reasoning }
```

### **DB Client**

All agents use same Prisma client:

```typescript
import { db } from './db';

await db.sentimentSignal.create({ ... });
await db.trade.findMany({ ... });
await db.signal.create({ ... }); // generic table
```

### **Email Alerts**

Reuse email infrastructure:

```typescript
import { sendEmail } from "./email";

await sendEmail("Subject", "Body text");
```

---

## Checklist: Adding Agent #2

- [ ] `cp -r apps/breakout-agent apps/new-agent`
- [ ] Update `package.json` with new name
- [ ] Implement `src/agent.ts` with agent logic
- [ ] Add tools in `src/tools/`
- [ ] Update `src/config.ts` for agent-specific params
- [ ] Add DB schema to `prisma/schema.prisma`
- [ ] Add env vars to `.env`
- [ ] Run `npx prisma migrate dev`
- [ ] Run `npm run dev` and test
- [ ] Commit and push

**Time: ~30 minutes** (most of it is writing agent logic)

---

## Common Patterns

### **Multiple Assets**

```typescript
for (const asset of config.assets) {
  const result = await analyzeAsset(asset);
  if (result.shouldAlert) await sendAlert(result);
}
```

### **Polling (vs. Cron)**

If you need sub-minute precision, use event loops:

```typescript
async function poll() {
  while (true) {
    await scan();
    await sleep(30000); // 30 seconds
  }
}
```

### **Rate Limiting**

```typescript
import pLimit from "p-limit";
const limit = pLimit(3); // 3 concurrent requests

const promises = assets.map((a) => limit(() => analyze(a)));
await Promise.all(promises);
```

### **Conditional Alerts**

```typescript
const shouldAlert =
  result.confidence > 0.7 &&
  result.recentTrend !== "noise" &&
  !lastAlertWas(asset, "1h");
```

---

## Testing New Agent Locally

```bash
# Set fake data source or use paper trading
export DATA_SOURCE=paper
export USE_PAPER_TRADING=true

# Run single agent
npm run dev

# Check logs
tail -f /tmp/agent.log

# Query results
npx prisma studio  # Browse DB
```

---

## Questions?

See `architecture.md` for design decisions or `deployment.md` for production setup.
