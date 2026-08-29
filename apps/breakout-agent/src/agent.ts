import { fetchMarketData, fetchEarningsSurprise, fetchRecentEarnings, primeQuotes, setFmpDisabled } from "./tools/market-data.js";
import { analyzeBreakout, analyzeSetup } from "./tools/breakout-logic.js";
import { screenSetupWinner, screenMovingWinners } from "./tools/winners-logic.js";
import { sendEmail } from "./email.js";
import { postXThread } from "./x-post.js";
import { db } from "./db.js";
import { filterDelistedStocks } from "./tools/delistings.js";
import { getOrAnalyzeTranscript } from "./tools/transcript-analysis.js";
import { reviewSignal } from "./tools/ai-signal-review.js";
import { globalRateLimiter } from "./tools/rate-limiter.js";

export type Region = "US" | "IN";

// Market hours are defined in the exchange's own timezone, regardless of
// container TZ. US: 9:30-16:00 ET. IN (NSE): 9:15-15:30 IST.
const MARKET_HOURS: Record<Region, { tz: string; open: number; close: number; suffix: string }> = {
  // close inclusive of the last minute so the post-close scan captures the settling close print.
  US: { tz: "America/New_York", open: 570, close: 960, suffix: "ET" },
  IN: { tz: "Asia/Kolkata", open: 555, close: 930, suffix: "IST" },
};

// Region of a symbol: NSE/BSE tickers carry a .NS/.BO suffix; everything else is US.
export function regionOf(symbol: string): Region {
  return /\.(NS|BO)$/i.test(symbol) ? "IN" : "US";
}

// TradingView needs an exchange prefix for Indian tickers — FMP's .NS/.BO suffix
// doesn't resolve there. Map .NS→NSE:, .BO→BSE:; US symbols pass through.
export function tradingViewSymbol(symbol: string): string {
  if (/\.NS$/i.test(symbol)) return "NSE:" + symbol.replace(/\.NS$/i, "");
  if (/\.BO$/i.test(symbol)) return "BSE:" + symbol.replace(/\.BO$/i, "");
  return symbol;
}

// Returns `label` so callers can log the checked exchange-local time.
export function marketStatus(date: Date = new Date(), region: Region = "US"): {
  open: boolean;
  label: string;
} {
  const h = MARKET_HOURS[region];
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: h.tz,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;

  const label = `${parts.hour}:${parts.minute} ${parts.weekday} ${h.suffix}`;
  const mins = parseInt(parts.hour, 10) * 60 + parseInt(parts.minute, 10);
  const isWeekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(parts.weekday);
  return { open: isWeekday && mins >= h.open && mins <= h.close, label };
}

export function isMarketOpen(date: Date = new Date(), region: Region = "US"): boolean {
  return marketStatus(date, region).open;
}

const SECTOR_TAILWINDS: Record<string, string> = {
  Technology: "AI adoption & cloud expansion",
  Semiconductors: "AI chip demand cycle",
  Healthcare: "GLP-1 drug cycle & aging demographics",
  Energy: "Energy transition & LNG demand",
  Financials: "Rate normalization cycle",
  "Consumer Cyclical": "Post-rate-cut spending recovery",
  Industrials: "Reshoring & infrastructure spend",
};

function getSectorTailwind(sector: string): string {
  return (
    Object.entries(SECTOR_TAILWINDS).find(([k]) => sector.includes(k))?.[1] ??
    ""
  );
}

export interface BreakoutResult {
  asset: string;
  timestamp: Date;
  resistance: number;
  support: number;
  currentPrice: number;
  volume: number;
  avgVolume: number;
  confidence: number;
  reasoning: string;
  shouldAlert: boolean;
  breakoutType?: string;
}

export class BreakoutAgent {
  // Per-scan tallies for market-breadth reporting. Reset at the start of each
  // analyzeMarkets call and persisted to MarketBreadth at the end.
  private breadthBaseCount = 0;
  private breadthHandleCount = 0;
  private breadthTotalScanned = 0;

  // Screener universe cached per trading day: membership churns daily at most,
  // yet the uncached ~2-3MB screener payload was re-downloaded on every
  // 15-minute scan (x2 modes) — pure bandwidth waste.
  private universeCache = new Map<string, { date: string; symbols: string[] }>();

  async fetchAssetsFromFMP(mode: "stocks" | "etfs" = "stocks"): Promise<string[]> {
    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) throw new Error("FMP_API_KEY not set");

    const cacheDate = new Date().toISOString().slice(0, 10);
    const cachedUniverse = this.universeCache.get(mode);
    if (cachedUniverse && cachedUniverse.date === cacheDate && cachedUniverse.symbols.length > 0) {
      console.log(`[FMP] Universe cache hit for ${mode}: ${cachedUniverse.symbols.length} symbols (fetched earlier today)`);
      return cachedUniverse.symbols;
    }

    const MIN_MARKET_CAP = parseInt(process.env.MIN_MARKET_CAP || "300000000"); // $300M default
    const MIN_VOLUME = parseInt(process.env.MIN_VOLUME || "100000"); // 100k shares default
    const MEGACAP_WATCH = ["NVDA", "MSFT", "ASML", "AMAT", "OPEN", "NBIS"];
    // REGION selects the exchange universe. IN = NSE (symbols come back .NS-suffixed).
    const region = (process.env.REGION || "US") as Region;
    const EXCHANGES = region === "IN" ? "NSE" : "NASDAQ,NYSE,AMEX";

    try {
      console.log(`[FMP] Fetching filtered ${region} ${mode} (split queries for manageability)...`);
      const startTime = Date.now();

      interface ScreenerResult {
        symbol: string;
        exchangeShortName?: string;
      }

      // Query stocks or ETFs based on mode
      const isEtf = mode === "etfs";
      const assetType = isEtf ? "ETFs" : "stocks";
      console.log(`  [FMP] Querying actively-traded ${assetType} with isEtf=${isEtf} filter...`);

      const screenerUrl = isEtf
        ? `https://financialmodelingprep.com/stable/company-screener?volumeMoreThan=10000&isEtf=true&isFund=false&isActivelyTrading=true&limit=10000&apikey=${apiKey}`
        : `https://financialmodelingprep.com/stable/company-screener?marketCapMoreThan=${MIN_MARKET_CAP}&volumeMoreThan=${MIN_VOLUME}&isEtf=false&isFund=false&isActivelyTrading=true&exchange=${EXCHANGES}&limit=10000&apikey=${apiKey}`;
      const assetsRes = await globalRateLimiter.execute(() => fetch(screenerUrl));

      let stockSymbols: string[] = [];
      if (assetsRes.ok) {
        const assetsData = (await assetsRes.json()) as ScreenerResult[];
        stockSymbols = (Array.isArray(assetsData) ? assetsData : [])
          .map((s) => s.symbol)
          .filter(Boolean)
          .filter((s) => !s.match(/\.(TO|L|V|TSX|CN|IN|HK|SG|AU)$/i)); // Exclude non-US country codes
        console.log(`    ✓ ${assetType}: ${assetsData.length} records → ${stockSymbols.length} unique symbols`);
      } else {
        console.warn(`  [FMP] ${assetType} query failed (${assetsRes.status}), skipping`);
      }

      // Only add megacap watch for US stocks mode (the watchlist is US tickers)
      let allAssets = [...new Set(stockSymbols)];
      if (mode === "stocks" && region === "US") {
        const megacapsInScreener = MEGACAP_WATCH.filter((m) => allAssets.includes(m));
        const megacapsMissing = MEGACAP_WATCH.filter((m) => !allAssets.includes(m));
        if (megacapsInScreener.length > 0) {
          console.log(`[FMP AUDIT] Megacaps IN screener: ${megacapsInScreener.join(", ")}`);
        }
        if (megacapsMissing.length > 0) {
          console.log(`[FMP AUDIT] Megacaps MISSING from screener: ${megacapsMissing.join(", ")} — adding manually`);
          allAssets = [...new Set([...allAssets, ...megacapsMissing])];
        }
      }

      console.log(`[FMP AUDIT] Before delisting filter: ${allAssets.length} ${assetType} (${mode === "stocks" ? "added " + (MEGACAP_WATCH.filter(m => !stockSymbols.includes(m)).length || 0) + " missing megacaps" : "no filtering"})`);

      const elapsed = Date.now() - startTime;
      const filterDesc = mode === "etfs" ? "vol >10k" : `market cap >$${(MIN_MARKET_CAP / 1e6).toFixed(0)}M, vol >${MIN_VOLUME}k`;
      console.log(
        `[FMP] Fetched ${allAssets.length} US ${assetType} (${filterDesc}) in ${elapsed}ms`,
      );

      // Filter out delisted stocks. The delist check is US-shaped (FMP US endpoints),
      // so skip it for IN — the NSE screener's isActivelyTrading already gates this.
      // ponytail: no IN delist cleanup yet; add if stale .NS rows appear.
      const activeAssets = region === "US" ? await filterDelistedStocks(allAssets) : allAssets;
      console.log(`[FMP AUDIT] After delisting filter: ${activeAssets.length} ${assetType} (removed ${allAssets.length - activeAssets.length})`);

      // Check if any megacaps were filtered by delisting (US stocks only)
      if (mode === "stocks" && region === "US") {
        const megacapsAfterFilter = MEGACAP_WATCH.filter((m) => activeAssets.includes(m));
        const megacapsFilteredOut = MEGACAP_WATCH.filter((m) => stockSymbols.includes(m) && !activeAssets.includes(m));
        if (megacapsFilteredOut.length > 0) {
          console.log(`[FMP AUDIT] Megacaps FILTERED OUT by delisting check: ${megacapsFilteredOut.join(", ")}`);
        }
        if (megacapsAfterFilter.length > 0) {
          console.log(`[FMP AUDIT] Megacaps IN final asset list: ${megacapsAfterFilter.join(", ")}`);
        }
      }

      if (activeAssets.length > 0) this.universeCache.set(mode, { date: cacheDate, symbols: activeAssets });
      return activeAssets;
    } catch (error) {
      console.error("[FMP] Asset fetch failed:", error);
      // Stale universe beats a skipped scan when the screener endpoint hiccups.
      if (cachedUniverse && cachedUniverse.symbols.length > 0) {
        console.warn(`[FMP] Falling back to ${cachedUniverse.date} cached universe (${cachedUniverse.symbols.length} ${mode})`);
        return cachedUniverse.symbols;
      }
      throw error;
    }
  }

  // 5 parallel tiers × 15 concurrency = 75 assets in flight (with sequential stocks/etfs scans)
  // Rate limiter (per-container from env, sum across tiers < 750/min) queues FMP calls fairly
  // Cache reduces actual API calls by 60-70%, so even safer
  async analyzeMarkets(assets: string[], mode: "stocks" | "etfs" = "stocks"): Promise<BreakoutResult[]> {
    const CONCURRENCY = 15;

    // Admin FMP kill switch: the dashboard writes a RuntimeFlag row; every scan
    // cycle re-reads it so all tiers flip to Yahoo-only data within one cycle.
    try {
      const flag = await db.runtimeFlag.findUnique({ where: { key: "fmp_disabled" } });
      if (flag) setFmpDisabled(flag.value === "true");
    } catch {
      /* table may not exist mid-rollout — keep current mode */
    }

    // Reset per-scan breadth counters
    this.breadthBaseCount = 0;
    this.breadthHandleCount = 0;
    this.breadthTotalScanned = 0;

    // Sort assets for consistent order across all tiers (fixes sharding when FMP returns different order)
    const sortedAssets = [...assets].sort();

    // Sharding: divide work across containers
    const SHARD_INDEX = parseInt(process.env.SHARD_INDEX || "0");
    const SHARD_TOTAL = parseInt(process.env.SHARD_TOTAL || "1");
    const shardedAssets = sortedAssets.filter(
      (_, i) => i % SHARD_TOTAL === SHARD_INDEX,
    );

    console.log(
      `[Shard ${SHARD_INDEX}/${SHARD_TOTAL}] Analyzing ${shardedAssets.length}/${assets.length} assets`,
    );

    const results: BreakoutResult[] = [];

    // Prime live quotes in 100-symbol batch calls just ahead of the workers —
    // one batch request replaces ~100 per-asset /stable/quote calls, and the
    // rolling window keeps quotes inside their short TTL for slow scans.
    const fmpKey = process.env.FMP_API_KEY || "";
    let primedThrough = 0;

    for (let i = 0; i < shardedAssets.length; i += CONCURRENCY) {
      if (i >= primedThrough && fmpKey) {
        await primeQuotes(shardedAssets.slice(i, i + 100), fmpKey);
        primedThrough = i + 100;
      }
      const batch = shardedAssets.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map((asset) => this.analyzeAsset(asset, mode)),
      );
      for (const r of settled) {
        if (r.status === "fulfilled" && r.value) results.push(r.value);
      }
    }

    try {
      await db.marketBreadth.create({
        data: {
          mode,
          baseCount: this.breadthBaseCount,
          handleCount: this.breadthHandleCount,
          totalScanned: this.breadthTotalScanned,
        },
      });
      console.log(
        `[Breadth ${mode}] bases=${this.breadthBaseCount}, handles=${this.breadthHandleCount}, scanned=${this.breadthTotalScanned}`,
      );
    } catch (err: any) {
      console.warn(`[Breadth ${mode}] persist failed:`, err?.message);
    }

    return results;
  }

  private async analyzeAsset(
    asset: string,
    mode: "stocks" | "etfs" = "stocks",
  ): Promise<BreakoutResult | null> {
    try {
      let data;
      try {
        data = await fetchMarketData(asset);
      } catch (error: any) {
        const errorMsg = error?.message || "";
        // Skip delisted stocks, stale data, or stocks with no data available
        if (
          errorMsg.includes("[DELISTED]") ||
          errorMsg.includes("[STALE]") ||
          errorMsg.includes("No data found")
        ) {
          console.warn(`⊘ ${asset}: ${errorMsg}`);
          return null;
        }
        // Re-throw other errors
        throw error;
      }

      // Set assetType based on scan mode (source of truth from FMP screener)
      // Stocks screener (isEtf=false) → all are stocks
      // ETFs screener (isEtf=true) → all are ETFs
      // Don't override with profile detection - trust the screener classification
      data.assetType = mode === "etfs" ? "etf" : "stock";

      // Contribute this asset's trailing returns to the cross-sectional RS store.
      // The universe is split across tier containers, so ranking must go through
      // the DB: every shard upserts its slice, percentile queries read the union.
      const rsScore =
        0.5 * (data.return3mPct ?? 0) +
        0.3 * (data.return1mPct ?? 0) +
        0.2 * (data.return1wPct ?? 0);
      if (
        data.return3mPct != null ||
        data.return1mPct != null ||
        data.return1wPct != null
      ) {
        // Sector memory: Yahoo-mode scans have no profile data, so (a) never
        // overwrite a known sector with null/Unclassified, and (b) reuse the
        // remembered sector for this scan's signal rows — the upsert's return
        // value gives it back for free.
        const knowsSector = !!data.sector && data.sector !== "Unclassified";
        try {
          const arRow = await db.assetReturn.upsert({
            where: { asset },
            create: {
              asset,
              assetType: data.assetType,
              region: regionOf(asset),
              sector: knowsSector ? data.sector : null,
              rsScore,
              return1wPct: data.return1wPct,
              return1mPct: data.return1mPct,
              return3mPct: data.return3mPct,
            },
            update: {
              assetType: data.assetType,
              region: regionOf(asset),
              sector: knowsSector ? data.sector : undefined,
              rsScore,
              return1wPct: data.return1wPct,
              return1mPct: data.return1mPct,
              return3mPct: data.return3mPct,
            },
          });
          if (!knowsSector && arRow.sector) {
            data.sector = arRow.sector;
          }
        } catch (e: any) {
          console.warn(`[RS] upsert ${asset} failed:`, e?.message);
        }
      }

      // Check for recent prior alert (last 5 days): if found, force Type 3 to avoid duplicate Type 1 alerts
      const fiveDaysAgo = new Date();
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
      const priorAlert = await db.breakoutSignal.findFirst({
        where: {
          asset,
          alertSentAt: { gte: fiveDaysAgo },
        },
        orderBy: { alertSentAt: "desc" },
      });

      if (priorAlert) {
        // Force signal to be Type 3 extension so it inherits Type 1 confidence.
        // extensionPriorBreakoutBarsAgo > 0 routes through the extension branch in
        // analyzeBreakout, which uses the Type 1 formula (not the degraded continuation).
        data.priorBaseDays = 0;
        data.priorBreakoutBarsAgo = 1;
        if (!data.extensionPriorBreakoutBarsAgo) {
          data.extensionPriorBreakoutBarsAgo = 1;
        }
      }

      const breakoutAnalysis = analyzeBreakout(data);
      const setupAnalysis = analyzeSetup(data, breakoutAnalysis);

      // Breadth tally: every asset that reaches setup analysis counts as
      // scanned. Split base vs handle so the dashboard can show both.
      this.breadthTotalScanned += 1;
      if (setupAnalysis.isSetup) {
        if (setupAnalysis.setupType === "handle") {
          this.breadthHandleCount += 1;
        } else if (setupAnalysis.setupType === "base") {
          this.breadthBaseCount += 1;
        }
      }

      // MissionWinners-style fundamentals+setup screen. Independent of breakout
      // logic — uses the same market data, no additional API calls.
      const winnerSetup = screenSetupWinner(data);
      if (winnerSetup.qualifies && winnerSetup.tier) {
        try {
          const setupData = {
            tier: winnerSetup.tier,
            confidence: winnerSetup.confidence,
            currentPrice: winnerSetup.currentPrice,
            high52w: winnerSetup.high52w,
            distFrom52wHighPct: winnerSetup.distFrom52wHighPct,
            ma50: winnerSetup.ma50,
            ma200: winnerSetup.ma200,
            maStacked: winnerSetup.maStacked,
            epsGrowthPct: winnerSetup.epsGrowthPct,
            revenueGrowthPct: winnerSetup.revenueGrowthPct,
            sector: data.sector,
            industry: data.industry,
            signalDate: data.timestamp,
            createdAt: new Date(),
          };
          await db.winnerSignal.upsert({
            where: { asset_screenType: { asset, screenType: "setup" } },
            create: { asset, screenType: "setup", ...setupData },
            update: setupData,
          });
        } catch (err: any) {
          console.warn(`[Winners] ${asset} persist failed:`, err?.message);
        }
      }

      // Moving Winners: same fundamentals gate, ranked by trailing return over
      // 1w / 1m / 3m windows. One row per qualifying window.
      const movingWinners = screenMovingWinners(data);
      for (const mw of movingWinners) {
        try {
          const screenType = `moving-${mw.window}`;
          const movingData = {
            tier: mw.tier,
            confidence: mw.confidence,
            currentPrice: mw.currentPrice,
            returnPct: mw.returnPct,
            high52w: mw.high52w,
            distFrom52wHighPct: mw.distFrom52wHighPct,
            ma50: mw.ma50,
            ma200: mw.ma200,
            maStacked: mw.maStacked,
            epsGrowthPct: mw.epsGrowthPct,
            revenueGrowthPct: mw.revenueGrowthPct,
            sector: data.sector,
            industry: data.industry,
            signalDate: data.timestamp,
            createdAt: new Date(),
          };
          await db.winnerSignal.upsert({
            where: { asset_screenType: { asset, screenType } },
            create: { asset, screenType, ...movingData },
            update: movingData,
          });
        } catch (err: any) {
          console.warn(`[Winners moving-${mw.window}] ${asset} persist failed:`, err?.message);
        }
      }

      const volumeRatio = data.volume / data.avgVolume;
      // Volume tiers (2,074-base study): outcomes scale with breakout volume —
      // 1.2x barely clears noise, ≥2x is where the mean jumps, ≥4x is best.
      const premiumVolume = volumeRatio >= 4;
      const volumeIncreasing = volumeRatio > 1.3;

      // Fetch earnings transcript for Type 1/3 stock breakouts (cached per quarter).
      // Done up-front so we can boost confidence and persist the snapshot with the signal.
      let earnings: Awaited<ReturnType<typeof getOrAnalyzeTranscript>> = null;
      const isBreakoutStock =
        (breakoutAnalysis.breakoutType === "Type1" ||
          breakoutAnalysis.breakoutType === "Type3") &&
        data.assetType === "stock" &&
        regionOf(asset) === "US"; // FMP has no NSE/BSE transcripts — skip the wasted call
      if (isBreakoutStock) {
        try {
          earnings = await getOrAnalyzeTranscript(asset);
        } catch (err: any) {
          console.warn(`[Transcript] ${asset} analysis failed:`, err?.message);
        }
      }

      let confidence = breakoutAnalysis.confidence;

      // Type 1 (fresh breakout from real base): apply extension penalty
      if (
        breakoutAnalysis.breakoutType === "Type1" &&
        breakoutAnalysis.resistance > 0
      ) {
        const extensionFromResistance =
          ((data.close - breakoutAnalysis.resistance) /
            breakoutAnalysis.resistance) *
          100;
        if (extensionFromResistance > 1) {
          if (extensionFromResistance <= 3) {
            confidence -= (extensionFromResistance - 1) * 0.01; // -1% per 1% above 1%
          } else if (extensionFromResistance <= 5) {
            confidence -= 0.02 + (extensionFromResistance - 3) * 0.015; // steeper
          } else {
            confidence -= 0.023 + (extensionFromResistance - 5) * 0.02; // even steeper for >5%
          }
          confidence = Math.max(0.8, confidence); // Type 1 floor at 80%
        }
      } else if (breakoutAnalysis.breakoutType === "Type3") {
        // Type 3 (continuation): use pre-calculated confidence, no further adjustments
        // Confidence already degraded in analyzeBreakout based on bars ago
      } else if (breakoutAnalysis.breakoutSignal) {
        // Non-green-cone breakout signal: apply additional adjustments
        if (breakoutAnalysis.maStackTurning && volumeIncreasing)
          confidence += 0.1;
        if (breakoutAnalysis.earningsGrowth > 10) confidence += 0.08;

        // Boost/penalize based on proximity to 52-week high
        const distFrom52wHigh =
          breakoutAnalysis.high52w > 0
            ? ((breakoutAnalysis.high52w - data.close) /
                breakoutAnalysis.high52w) *
              100
            : null;

        if (distFrom52wHigh !== null) {
          if (distFrom52wHigh <= 10) {
            confidence += 0.08; // within 10% of 52w high — near breakout territory
          } else if (distFrom52wHigh > 35) {
            confidence -= 0.15; // far below 52w high — weak setup
          }
        }

        // Penalize if too far above 20-day MA (extended run-up)
        const distFromMA20 =
          ((data.close - breakoutAnalysis.ma20) / breakoutAnalysis.ma20) * 100;
        if (distFromMA20 > 1) {
          if (distFromMA20 <= 3) {
            confidence -= 0.02; // 1-3% above MA20 = -2%
          } else {
            confidence -= 0.04; // >3% above MA20 = -4%
          }
        }

        // Penalize if extended far above breakout resistance (original entry point)
        if (breakoutAnalysis.resistance > 0) {
          const extensionFromResistance =
            ((data.close - breakoutAnalysis.resistance) /
              breakoutAnalysis.resistance) *
            100;
          if (extensionFromResistance > 2) {
            if (extensionFromResistance <= 5) {
              confidence -= (extensionFromResistance - 2) * 0.01; // -1% per 1% above 2%
            } else {
              confidence -= 0.03 + (extensionFromResistance - 5) * 0.015; // steeper for >5%
            }
          }
        }

        confidence = Math.min(0.95, Math.max(0.2, confidence));
      }

      // Earnings-based confidence adjustment (Type 1/3 stocks only).
      // Strong bullish tone + raised guidance is the highest-conviction combo.
      if (earnings) {
        const confidenceBefore = confidence;
        if (earnings.toneScore >= 0.8) confidence += 0.05;
        else if (earnings.toneScore >= 0.5) confidence += 0.03;
        else if (earnings.toneScore <= -0.3) confidence -= 0.05;

        if (earnings.guidanceDirection === "raised") confidence += 0.04;
        else if (earnings.guidanceDirection === "lowered") confidence -= 0.04;

        // Respect existing floor (80% for Type 1) and cap at 99%.
        const floor = breakoutAnalysis.breakoutType === "Type1" ? 0.8 : 0.2;
        confidence = Math.min(0.99, Math.max(floor, confidence));

        const delta = confidence - confidenceBefore;
        if (Math.abs(delta) >= 0.005) {
          console.log(
            `[Earnings] ${asset} Q${earnings.quarter} ${earnings.year}: ${earnings.tone} (${earnings.toneScore.toFixed(2)}), guidance ${earnings.guidanceDirection} → confidence ${(delta * 100 >= 0 ? "+" : "")}${(delta * 100).toFixed(1)}%`,
          );
        }
      }

      const isValid = breakoutAnalysis.maStack && breakoutAnalysis.volumeOk;

      const macroContext = breakoutAnalysis.fedFundsRate
        ? breakoutAnalysis.fedFundsRate > 4.5
          ? `Fed ${breakoutAnalysis.fedFundsRate.toFixed(2)}% — headwind for growth`
          : breakoutAnalysis.fedFundsRate > 2.5
            ? `Fed ${breakoutAnalysis.fedFundsRate.toFixed(2)}% — neutral`
            : `Fed ${breakoutAnalysis.fedFundsRate.toFixed(2)}% — tailwind for growth`
        : "Macro: unavailable";

      const sectorTailwind = getSectorTailwind(breakoutAnalysis.sector || "");

      const distFrom52wHigh =
        breakoutAnalysis.high52w > 0
          ? ((breakoutAnalysis.high52w - data.close) /
              breakoutAnalysis.high52w) *
            100
          : null;

      // RS percentile (1-99) vs the fresh universe — only for rows that will be
      // persisted/shown, to keep the count queries off the hot path for the
      // hundreds of unremarkable assets per scan.
      let rsRating: number | null = null;
      if (
        breakoutAnalysis.breakoutType !== "unknown" ||
        setupAnalysis.qualifiesAsTradableHandle
      ) {
        try {
          const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
          // Per-market percentile: an NSE stock ranks vs the Indian universe
          const whereFresh = {
            assetType: data.assetType || "stock",
            region: regionOf(asset),
            updatedAt: { gte: dayAgo },
          };
          const [below, total] = await Promise.all([
            db.assetReturn.count({
              where: { ...whereFresh, rsScore: { lt: rsScore } },
            }),
            db.assetReturn.count({ where: whereFresh }),
          ]);
          // Need a real universe before a percentile means anything
          if (total >= 20) {
            rsRating = Math.min(99, Math.max(1, Math.round((below / total) * 99)));
          }
        } catch (e: any) {
          console.warn(`[RS] rank ${asset} failed:`, e?.message);
        }
      }

      const localReasoning = [
        breakoutAnalysis.cohort ? `Cohort ${breakoutAnalysis.cohort} (${{ S: "67% hist. win — sky+16wk+2x vol", A: "57-60% hist. win — blue sky", B: "47% hist. win — long base + volume", C: "29-41% hist. win — baseline grade" }[breakoutAnalysis.cohort]})` : null,
        premiumVolume ? `🔥 Premium volume (${volumeRatio.toFixed(1)}x avg)` : null,
        breakoutAnalysis.isVcp
          ? `VCP ✓ (ATR ${breakoutAnalysis.atrPercent.toFixed(1)}%, contraction ${breakoutAnalysis.contractionRatio.toFixed(2)}, expansion ${breakoutAnalysis.expansionRatio.toFixed(1)}x)`
          : null,
        breakoutAnalysis.isBlueSky ? "Blue Sky ✓ (base at 52w high)" : null,
        rsRating != null ? `RS: ${rsRating}` : null,
        breakoutAnalysis.upDownVolumeRatio > 0
          ? `U/D Vol: ${breakoutAnalysis.upDownVolumeRatio.toFixed(1)}x`
          : null,
        breakoutAnalysis.failedPokes > 0
          ? `Failed pokes: ${breakoutAnalysis.failedPokes}`
          : null,
        `MA Stack: ${breakoutAnalysis.maStack ? "Uptrend ✓" : "No uptrend ✗"}`,
        `Vol: ${volumeRatio.toFixed(1)}x${volumeIncreasing ? " ✓" : ""}`,
        distFrom52wHigh !== null
          ? `52wH: ${distFrom52wHigh.toFixed(1)}% below`
          : null,
        `EPS: ${breakoutAnalysis.epsGrowthPct !== 0 ? (breakoutAnalysis.epsGrowthPct > 0 ? "+" : "") + breakoutAnalysis.epsGrowthPct.toFixed(1) + "%" : "N/A"}`,
        `Rev: ${breakoutAnalysis.revenueGrowthPct !== 0 ? (breakoutAnalysis.revenueGrowthPct > 0 ? "+" : "") + breakoutAnalysis.revenueGrowthPct.toFixed(1) + "%" : "N/A"}`,
        breakoutAnalysis.epsBeat !== false
          ? `EPS: ${breakoutAnalysis.epsBeat ? "Beat" : "Miss"} ${breakoutAnalysis.epsSurprisePct !== 0 ? (breakoutAnalysis.epsSurprisePct > 0 ? "+" : "") + breakoutAnalysis.epsSurprisePct.toFixed(1) + "%" : ""}`
          : null,
        `Sector: ${breakoutAnalysis.sector || "Unknown"}${breakoutAnalysis.industry ? " / " + breakoutAnalysis.industry : ""}`,
        `Macro: ${macroContext}`,
        sectorTailwind ? `Tailwind: ${sectorTailwind}` : null,
      ]
        .filter(Boolean)
        .join(" | ");

      // Frozen trade setup: inherit entryPrice/stopLoss across a continuous
      // Type1/Type3 streak. Recompute only on a fresh flip. Hoisted above the
      // alert gate so the grace window below can test distance-from-entry on
      // first observation.
      //
      // A streak ENDS on a gap: a stock can break out, pull back, re-base, and
      // break out again weeks later (AVT: late-May move, then Aug) — that second
      // breakout is a new episode deserving its own entry and its own alert. If
      // the last signal row is stale (>5 days — survives weekends/holidays but
      // not a multi-week pullback or a scan outage), treat this flip as fresh:
      // recompute entry and re-enable the grace alert. Without this the frozen
      // entry from breakout #1 would stick forever and #2 would never notify.
      const STREAK_MAX_GAP_MS = 5 * 24 * 60 * 60 * 1000;
      const latestForAsset = await db.breakoutSignal.findFirst({
        where: { asset },
        orderBy: { createdAt: "desc" },
      });
      const lastRowAgeMs = latestForAsset
        ? Date.now() - new Date(latestForAsset.createdAt).getTime()
        : Infinity;
      // A streak also ENDS when price closes below the frozen stop: that trade
      // is over, and any later signal is a NEW episode needing a fresh entry.
      // Without this, dead episodes inherit stale entries forever — worst case
      // a stock split (SFBS 2:1, Aug 2026) leaves a pre-split $92 entry against
      // split-adjusted $44 prices, rendering a phantom -52% "stopped" row.
      const stopBreached =
        latestForAsset?.stopLoss != null && data.close <= latestForAsset.stopLoss;
      const isActiveStreak =
        latestForAsset &&
        ["Type1", "Type1b", "Type3"].includes(latestForAsset.breakoutType) &&
        latestForAsset.entryPrice != null &&
        lastRowAgeMs <= STREAK_MAX_GAP_MS &&
        !stopBreached;
      const entryPrice = isActiveStreak
        ? (latestForAsset!.entryPrice as number)
        : breakoutAnalysis.resistance;
      const stopLoss = isActiveStreak
        ? (latestForAsset!.stopLoss as number)
        : entryPrice * 0.93;

      // Alerts: Type1 (fresh breakout) and Type1b (weak-vol clean breakout).
      // Type1b already passed goodStructure + cleanConsolidation + hasGoodPriorBase
      // in classification, so trust it — the isValid/breakoutSignal gates would
      // reject it because both require volumeOk which Type1b lacks by definition.
      const isType1Breakout = breakoutAnalysis.breakoutType === "Type1";
      const isType1bBreakout = breakoutAnalysis.breakoutType === "Type1b";

      // Grace window: detectPriorBreakout reads raw candles, so a real breakout
      // that fired while this asset wasn't being scanned comes back as Type3
      // (ago>0) the first time we finally observe it — and Type3 never emails, so
      // the alert is lost. Recover it: on the FIRST observation of a Type3 whose
      // breakout is only a bar or two old and price is still within 5% of entry
      // (the actionable re-entry zone), fire the breakout alert once. The
      // !isActiveStreak gate guarantees "once" — the next scan is a continuation.
      const barsAgo = data.extensionPriorBreakoutBarsAgo || 0;
      const pctAboveEntry =
        entryPrice > 0 ? ((data.close - entryPrice) / entryPrice) * 100 : Infinity;
      const isFreshlyCaughtExtension =
        breakoutAnalysis.breakoutType === "Type3" &&
        !isActiveStreak &&
        breakoutAnalysis.maStack &&
        breakoutAnalysis.liquidityOk &&
        barsAgo >= 1 &&
        barsAgo <= 2 &&
        pctAboveEntry >= 0 &&
        pctAboveEntry <= 5;

      // Alert-all-with-ranking: every qualifying Type1 emails, graded by its
      // evidence cohort (S 67% win / A 57-60% / B 47% / C 29-41% historical) —
      // the grade travels in the subject so the reader can prioritize, instead
      // of a hard volume gate silently hiding C-tier signals.
      const shouldAlert =
        (isType1Breakout &&
          isValid &&
          breakoutAnalysis.maStack &&
          breakoutAnalysis.breakoutSignal) ||
        isType1bBreakout ||
        isFreshlyCaughtExtension;

      // Debug logging for breakout classification
      if (breakoutAnalysis.pineScriptGreen) {
        const reasons = [];
        if (breakoutAnalysis.breakoutType !== "Type1")
          reasons.push(`Type ${breakoutAnalysis.breakoutType}`);
        if (
          breakoutAnalysis.breakoutType === "Type3" &&
          breakoutAnalysis.priorBreakoutBarsAgo > 0
        ) {
          reasons.push(
            `riding ${breakoutAnalysis.priorBreakoutBarsAgo} bars old breakout`,
          );
        }
        if (!breakoutAnalysis.liquidityOk)
          reasons.push(`illiquid (vol:${(data.avgVolume || 0).toFixed(0)})`);
        if (!isValid)
          reasons.push(
            `invalid (maStack:${breakoutAnalysis.maStack} volumeOk:${breakoutAnalysis.volumeOk})`,
          );
        if (!breakoutAnalysis.breakoutSignal)
          reasons.push("no breakout signal");
        if (breakoutAnalysis.breakoutType === "Type3" && !shouldAlert) {
          console.log(
            `⊘ ${asset}: Type 3 continuation (${reasons.join(", ")}) — tracked but not alerted`,
          );
        } else if (!shouldAlert && reasons.length) {
          console.log(
            `⚠ ${asset} green cone detected but no alert: ${reasons.join(", ")}`,
          );
        }
      }

      const result: BreakoutResult = {
        asset,
        timestamp: new Date(),
        resistance: breakoutAnalysis.resistance,
        support: breakoutAnalysis.support,
        currentPrice: data.close,
        volume: data.volume,
        avgVolume: data.avgVolume,
        confidence,
        reasoning: localReasoning,
        shouldAlert,
      };

      // Only persist classified breakouts. Green-cone signals that failed the
      // Type 1/3 rules (e.g. bad-base fall-through) are intentionally dropped.
      const isMeaningfulBreakout = breakoutAnalysis.breakoutType !== "unknown";

      if (isMeaningfulBreakout) {
        const latestBreakout = await db.breakoutSignal.findFirst({
          where: { asset, breakoutType: breakoutAnalysis.breakoutType },
          orderBy: { createdAt: "desc" },
        });

        const isUnchanged =
          latestBreakout &&
          Math.abs(latestBreakout.currentPrice - result.currentPrice) < 0.01 &&
          Math.abs(latestBreakout.resistance - result.resistance) < 0.01 &&
          Math.abs(latestBreakout.support - result.support) < 0.01 &&
          latestBreakout.shouldAlert === shouldAlert;
        // entryPrice / stopLoss / latestForAsset / isActiveStreak computed above.

        if (!isUnchanged) {
          // epsBeat/epsSurprisePct aren't fetched during the broad scan (cost).
          // Fetch here — only for persisted, changed, meaningful breakouts —
          // so the Beat & Raise panel has real beat data to screen on.
          const surprise = process.env.FMP_API_KEY
            ? await fetchEarningsSurprise(asset, process.env.FMP_API_KEY)
            : null;

          await db.breakoutSignal.create({
            data: {
              asset,
              assetType: mode === "etfs" ? "etf" : "stock",
              confidence,
              agentDecision: localReasoning,
              shouldAlert,
              resistance: result.resistance,
              support: result.support,
              currentPrice: result.currentPrice,
              entryPrice,
              stopLoss,
              pineScriptGreen: breakoutAnalysis.pineScriptGreen,
              barsInRange: breakoutAnalysis.barsInRange || 0,
              bullishCandle: breakoutAnalysis.bullishCandle,
              epsGrowthPct: breakoutAnalysis.epsGrowthPct,
              revenueGrowthPct: breakoutAnalysis.revenueGrowthPct,
              epsBeat: surprise?.epsBeat ?? breakoutAnalysis.epsBeat,
              epsSurprisePct:
                surprise?.epsSurprisePct ?? breakoutAnalysis.epsSurprisePct,
              // Sector fallback chain: this scan's data → the asset's own most
              // recent signal row. Covers Yahoo-mode scans AND assets whose
              // AssetReturn sector was erased before the sector-memory fix.
              sector:
                breakoutAnalysis.sector && breakoutAnalysis.sector !== "Unclassified"
                  ? breakoutAnalysis.sector
                  : latestForAsset?.sector && latestForAsset.sector !== "Unclassified"
                    ? latestForAsset.sector
                    : breakoutAnalysis.sector,
              industry: breakoutAnalysis.industry,
              fedFundsRate: breakoutAnalysis.fedFundsRate,
              volumeRatio,
              expenseRatio: data.expenseRatio,
              assetUnderManagement: data.assetUnderManagement,
              etfCategory: data.etfCategory,
              breakoutType: breakoutAnalysis.breakoutType,
              isVcp: breakoutAnalysis.isVcp,
              rsRating,
              upDownVolumeRatio: breakoutAnalysis.upDownVolumeRatio || null,
              failedPokes: breakoutAnalysis.failedPokes,
              isBlueSky: breakoutAnalysis.isBlueSky,
              coilRatio: breakoutAnalysis.coilRatio || null,
              isStaircase: breakoutAnalysis.isStaircase,
              cohort: breakoutAnalysis.cohort,
              priorBaseDays: breakoutAnalysis.priorBaseDays,
              priorBaseRangePercent: breakoutAnalysis.priorBaseRangePercent,
              priorBreakoutBarsAgo: breakoutAnalysis.priorBreakoutBarsAgo,
              extensionPriorBreakoutBarsAgo: data.extensionPriorBreakoutBarsAgo || 0,
              liquidityOk: breakoutAnalysis.liquidityOk,
              signalDate: data.timestamp,
              earningsTone: earnings?.tone ?? null,
              earningsToneScore: earnings?.toneScore ?? null,
              earningsGuidance: earnings?.guidanceDirection ?? null,
              earningsQuarter: earnings?.quarter ?? null,
              earningsYear: earnings?.year ?? null,
            },
          });
        }
      }

      // ── Episodic Pivot (EP): catalyst-class signal, separate from Type1 ──
      // Trigger (validated on the 523-event study): volume >= 5x average AND
      // day gain >= 8% on a green candle. NO trend requirement — EPs work BEST
      // in broken stocks (below-200MA cohort: 50.4% win, +18.4% mean; post-
      // crash: +42.4%). Entry = event close, stop = event day LOW (wider than
      // -8%; different risk class, never blended into breakout stats).
      const dayGainPct =
        data.prevClose && data.prevClose > 0
          ? ((data.close - data.prevClose) / data.prevClose) * 100
          : 0;
      const isEp =
        volumeRatio >= 5 &&
        dayGainPct >= 8 &&
        data.close > data.open &&
        breakoutAnalysis.liquidityOk;
      if (isEp) {
        const epToday = await db.breakoutSignal.findFirst({
          where: {
            asset,
            breakoutType: "EP",
            createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
          },
        });
        if (!epToday) {
          const epAlert = volumeRatio >= 10; // study: >=10x is the strong cohort
          await db.breakoutSignal.create({
            data: {
              asset,
              assetType: mode === "etfs" ? "etf" : "stock",
              confidence: epAlert ? 0.85 : 0.75,
              agentDecision: `⚡ Episodic Pivot: +${dayGainPct.toFixed(1)}% on ${volumeRatio.toFixed(1)}x avg volume — catalyst repricing. Entry ${data.close.toFixed(2)}, stop = day low ${data.low.toFixed(2)} (${(((data.low - data.close) / data.close) * 100).toFixed(1)}%). Catalyst class: no trend requirement, wider risk, size accordingly.`,
              shouldAlert: epAlert,
              resistance: breakoutAnalysis.resistance,
              support: breakoutAnalysis.support,
              currentPrice: data.close,
              entryPrice: data.close,
              stopLoss: data.low,
              breakoutType: "EP",
              volumeRatio,
              sector: breakoutAnalysis.sector,
              industry: breakoutAnalysis.industry,
              rsRating,
              isBlueSky: breakoutAnalysis.isBlueSky,
              liquidityOk: breakoutAnalysis.liquidityOk,
              signalDate: data.timestamp,
            },
          });
          console.log(`⚡ EP ${asset}: +${dayGainPct.toFixed(1)}% on ${volumeRatio.toFixed(1)}x vol${epAlert ? " (ALERT)" : ""}`);
        }
      }

      // Store setup signals (Type 2 green cone) in Signal table with metadata.
      // Only tradable handles (tight + ≥5 bars) become per-row signals; loose
      // "base" setups feed the market-breadth aggregate written at scan-end.
      if (setupAnalysis.isSetup && setupAnalysis.qualifiesAsTradableHandle) {
        const setupReasoning = [
          `Setup Type: ${setupAnalysis.setupType}`,
          `MA Stack: ${breakoutAnalysis.maStack ? "Uptrend ✓" : "No uptrend ✗"}`,
          `Distance from MA20: ${setupAnalysis.distanceFromMA20.toFixed(2)}%`,
          `Pivot: ${setupAnalysis.distanceToPivotPct.toFixed(1)}% above price`,
          rsRating != null ? `RS: ${rsRating}` : null,
          `Consolidation: ${data.setupBarsInRange || 0} bars`,
          `Range: ${data.setupConsolidationRangePercent || 0}%`,
          `Volume: ${data.setupConsolidationVolumePercent || 0}% of avg`,
        ]
          .filter(Boolean)
          .join(" | ");

        const setupSignalType = `setup-${setupAnalysis.setupType}`;
        const latestSetup = await db.signal.findFirst({
          where: { asset, signalType: setupSignalType },
          orderBy: { createdAt: "desc" },
        });

        const latestSetupMeta = (latestSetup?.metadata ?? {}) as Record<
          string,
          unknown
        >;
        const latestCurrentPrice =
          typeof latestSetupMeta.currentPrice === "number"
            ? (latestSetupMeta.currentPrice as number)
            : null;
        const latestMa20 =
          typeof latestSetupMeta.ma20 === "number"
            ? (latestSetupMeta.ma20 as number)
            : null;

        const isSetupUnchanged =
          latestSetup &&
          Math.abs((latestSetup.confidence || 0) - setupAnalysis.confidence) <
            0.001 &&
          latestCurrentPrice !== null &&
          Math.abs(latestCurrentPrice - data.close) < 0.01 &&
          latestMa20 !== null &&
          Math.abs(latestMa20 - (data.ma20 || 0)) < 0.01;

        if (!isSetupUnchanged) {
          await db.signal.create({
            data: {
              agentName: "BreakoutAgent",
              asset,
              signalType: setupSignalType,
              confidence: setupAnalysis.confidence,
              shouldAlert: setupAnalysis.confidence > 0.85,
              metadata: {
                assetType: mode === "etfs" ? "etf" : "stock",
                expenseRatio: data.expenseRatio,
                etfCategory: data.etfCategory,
                setupType: setupAnalysis.setupType,
                distanceFromMA20: setupAnalysis.distanceFromMA20,
                distanceToPivotPct: setupAnalysis.distanceToPivotPct,
                rsRating,
                distancePenalty: setupAnalysis.distancePenalty,
                ma20: data.ma20,
                currentPrice: data.close,
                barsInRange: data.setupBarsInRange,
                setupConsolidationRangePercent:
                  data.setupConsolidationRangePercent,
                setupConsolidationVolumePercent:
                  data.setupConsolidationVolumePercent,
                sector: breakoutAnalysis.sector || 'Unclassified',
                industry: breakoutAnalysis.industry || 'Unclassified',
                agentDecision: setupReasoning,
              },
            },
          });
        }
      }

      return result;
    } catch (error) {
      console.error(`Error analyzing ${asset}:`, error);
      return null;
    }
  }

  async sendAlert(result: BreakoutResult): Promise<void> {
    // Verify the record was persisted to database before sending alert
    const latestRecord = await db.breakoutSignal.findFirst({
      where: { asset: result.asset },
      orderBy: { createdAt: "desc" },
    });

    if (!latestRecord) {
      console.error(
        `❌ CRITICAL: Cannot send alert for ${result.asset} — record not found in database. DB write may have failed.`,
      );
      return;
    }

    // Stopped out: price closed at/below the frozen stop — the trade is dead,
    // don't alert on it (it still shows on the dashboard, flagged).
    if (latestRecord.stopLoss != null && result.currentPrice <= latestRecord.stopLoss) {
      console.log(
        `⊘ Skip alert ${result.asset}: stopped out (${result.currentPrice} ≤ stop ${latestRecord.stopLoss})`,
      );
      return;
    }

    // Type 1/1b/3 only alert during market hours (US 9:30-16:00 ET / NSE 9:15-15:30 IST, Mon-Fri)
    if ((latestRecord.breakoutType === "Type1" || latestRecord.breakoutType === "Type1b" || latestRecord.breakoutType === "Type3" || latestRecord.breakoutType === "EP") && !isMarketOpen(new Date(), regionOf(result.asset))) {
      console.log(
        `⊘ Skip ${latestRecord.breakoutType} alert ${result.asset}: Outside market hours — queued for next market open`,
      );
      return;
    }

    // Check if we already sent an alert for this asset
    const existingAlert = await db.breakoutSignal.findFirst({
      where: { asset: result.asset, alertSentAt: { not: null } },
      orderBy: { alertSentAt: "desc" },
    });

    const now = new Date();

    // If alert was already sent, only re-alert if price moved ±2% or more (for extensions, check gained ≥3%)
    if (existingAlert && existingAlert.lastAlertPrice) {
      const priceChange =
        Math.abs(
          (result.currentPrice - existingAlert.lastAlertPrice) /
            existingAlert.lastAlertPrice,
        ) * 100;
      const isExtension = latestRecord.breakoutType === "Type3";
      const threshold = isExtension ? 3 : 2; // Extensions require 3% movement
      const shouldRealert = priceChange >= threshold;

      if (!shouldRealert) {
        console.log(
          `⊘ Skip re-alert ${result.asset}: Price change ${priceChange.toFixed(2)}% < ${threshold}% threshold`,
        );
        return;
      }

      console.log(
        `↻ Re-alert ${result.asset}: Price moved ${priceChange.toFixed(2)}% (from $${existingAlert.lastAlertPrice} to $${result.currentPrice})`,
      );
    }

    // Get asset type and breakout type from database record
    const assetTypeIndicator =
      latestRecord.assetType === "etf" ? "📊 ETF" : "📈 STOCK";
    const etfInfo =
      latestRecord.assetType === "etf" && latestRecord.expenseRatio
        ? `\nExpense Ratio: ${latestRecord.expenseRatio}%`
        : "";

    const breakoutLabel = latestRecord.breakoutType === "Type1" ? (latestRecord.isVcp ? "Type1 VCP Breakout" : "Fresh Breakout") : latestRecord.breakoutType === "Type1b" ? "Weak-Vol Breakout" : latestRecord.breakoutType === "Type3" ? "Extension Re-test" : latestRecord.breakoutType === "EP" ? "⚡ Episodic Pivot (catalyst)" : "Breakout";
    const grade = (latestRecord as any).cohort ? `[${(latestRecord as any).cohort}] ` : '';
    const subject = `${grade}${(latestRecord.volumeRatio ?? 0) >= 4 ? '🔥 ' : ''}🚀 ${breakoutLabel}: ${result.asset} [${assetTypeIndicator}]`;
    const tradingViewUrl = `https://www.tradingview.com/chart/WgVJPfij/?symbol=${encodeURIComponent(tradingViewSymbol(result.asset))}`;

    // Trade setup for Type 1 & Type 3 — read frozen entry/stop that were
    // snapshotted at the moment breakoutType first flipped from unknown.
    const entryPriceVal = latestRecord.entryPrice ?? result.resistance;
    const stopLossVal = latestRecord.stopLoss ?? entryPriceVal * 0.93;
    const buyPoint = entryPriceVal > 0 ? entryPriceVal.toFixed(2) : "N/A";
    const stopLoss = stopLossVal > 0 ? stopLossVal.toFixed(2) : "N/A";
    const riskReward = entryPriceVal > 0 && stopLossVal > 0
      ? ((result.currentPrice - stopLossVal) / (entryPriceVal - stopLossVal)).toFixed(2)
      : "N/A";

    // Pull cached earnings transcript analysis (if any) for stock signals
    let transcriptSection = "";
    if (latestRecord.assetType === "stock") {
      const ta = await db.transcriptAnalysis.findFirst({
        where: { asset: result.asset },
        orderBy: [{ year: "desc" }, { quarter: "desc" }],
      });
      if (ta) {
        const risks = (ta.riskFlags as string[]) || [];
        const highlights = (ta.highlights as string[]) || [];
        transcriptSection = `
═══ EARNINGS CALL (Q${ta.quarter} ${ta.year}) ═══
Tone: ${ta.tone} (${ta.toneScore.toFixed(2)}) | Guidance: ${ta.guidanceDirection}
${ta.summary}
${highlights.length ? "+ " + highlights.join(" | ") : ""}
${risks.length ? "⚠ " + risks.join(" | ") : ""}
`;
      }
    }

    // AI second-opinion review (gated by AI_ASSISTANCE=true env, fails open)
    let aiReviewSection = "";
    if (latestRecord.breakoutType === "Type1" || latestRecord.breakoutType === "Type3") {
      const review = await reviewSignal({
        asset: result.asset,
        breakoutType: latestRecord.breakoutType as "Type1" | "Type3",
        currentPrice: result.currentPrice,
        resistance: result.resistance,
        support: result.support,
        confidence: result.confidence,
        volumeRatio: latestRecord.volumeRatio ?? 0,
        sector: latestRecord.sector,
        industry: latestRecord.industry,
        epsGrowthPct: latestRecord.epsGrowthPct ?? null,
        revenueGrowthPct: latestRecord.revenueGrowthPct ?? null,
        priorBaseDays: latestRecord.priorBaseDays ?? null,
        priorBaseRangePct: latestRecord.priorBaseRangePercent ?? null,
        priorBreakoutBarsAgo: latestRecord.priorBreakoutBarsAgo ?? null,
      });
      if (review) {
        aiReviewSection = `
═══ AI REVIEW (${review.rating}/10) ═══
Strength: ${review.strength}
Watch for: ${review.watchFor}
`;
      }
    }

    const body = `
Asset: ${result.asset} ${assetTypeIndicator}
Type: ${breakoutLabel}
Current Price: $${result.currentPrice}
Confidence: ${(result.confidence * 100).toFixed(0)}%${etfInfo}

═══ TRADE SETUP ═══
Buy Point (Entry): $${buyPoint}
Stop Loss: $${stopLoss}
Support: $${result.support.toFixed(2)}
Risk/Reward: ${riskReward}

═══ ANALYSIS ═══
Resistance: $${result.resistance.toFixed(2)}
Reasoning: ${result.reasoning}
${aiReviewSection}${transcriptSection}
TradingView: ${tradingViewUrl}

Source: Signal Forge - Breakout Agent
Time: ${result.timestamp.toISOString()}
    `;

    await sendEmail(subject, body);

    // Update alert tracking
    await db.breakoutSignal.updateMany({
      where: { asset: result.asset },
      data: {
        alertSentAt: existingAlert?.alertSentAt || now,
        lastAlertPrice: result.currentPrice,
        lastAlertAt: now,
      },
    });

    console.log(`✓ Alert sent: ${result.asset} @ $${result.currentPrice}`);
  }

  // ── X use case 1: automated signal teasers ────────────────────────────────
  // A few times a day, post the top 1-2 fresh high-confidence breakouts as
  // teasers: reveal the cross price + AI earnings tone/guidance (organic hook),
  // withhold the stop/R:R (the paid product). Runs on the shard-0 tier only
  // (gated in index.ts), reads the shared DB, so it covers every tier's signals.
  // Pilot bar: confidence ≥ 95%, or ≥ 85% with raised guidance.
  async postXSignalTeasers(): Promise<void> {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0); // container TZ is America/New_York
    const maxPerDay = parseInt(process.env.X_TEASER_MAX || "2");

    // Tickers already teased today — don't repeat, even though newer scan rows
    // for the same asset carry xPostedAt = null.
    const postedToday = await db.breakoutSignal.findMany({
      where: { xPostedAt: { gte: startOfToday } },
      distinct: ["asset"],
      select: { asset: true },
    });
    const postedSet = new Set(postedToday.map((r) => r.asset));

    // Latest alerted row per asset that fired today, best confidence first.
    const candidates = await db.breakoutSignal.findMany({
      where: { lastAlertAt: { gte: startOfToday } },
      orderBy: { createdAt: "desc" },
      distinct: ["asset"],
    });

    const qualifying = candidates
      .filter(
        (s) =>
          !postedSet.has(s.asset) &&
          regionOf(s.asset) === "US" && // X audience is US — never tease NSE/BSE names
          (s.confidence >= 0.95 ||
            (s.confidence >= 0.85 && s.earningsGuidance === "raised")),
      )
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, maxPerDay);

    if (qualifying.length === 0) {
      console.log("⊘ X teasers: no qualifying signals this window");
      return;
    }

    const tweets = qualifying.map((s) => {
      const cross = s.entryPrice ?? s.resistance;
      const setup = s.breakoutType === "Type3" ? "Extension" : "Actionable";
      const earnings =
        s.earningsTone && s.earningsToneScore != null
          ? `AI Earnings — Tone: ${capitalize(s.earningsTone)} (${fmtScore(s.earningsToneScore)})` +
            (s.earningsGuidance && s.earningsGuidance !== "none"
              ? ` · Guidance: ${capitalize(s.earningsGuidance)}`
              : "") +
            "\n"
          : "";
      // No link in the lead — it moves to the final CTA reply below.
      return `🚀 Breakout: $${s.asset} crossed $${cross.toFixed(2)} · ${setup}\n` + earnings.trimEnd();
    });

    const posted = await postXThread([...tweets, ctaReply()]);
    if (posted) {
      const assets = qualifying.map((s) => s.asset);
      await db.breakoutSignal.updateMany({
        where: { asset: { in: assets } },
        data: { xPostedAt: now },
      });
      console.log(`✓ X teasers posted (${assets.length}): ${assets.join(", ")}`);
    }
  }

  // ── X use case 2: transparent performance audit ───────────────────────────
  // Monthly recap. Reuses the dashboard's /api/backtest engine (real forward
  // returns from cached FMP closes) so we never post invented numbers — wins
  // AND losses, capped at the 8% stop. No dedup needed (runs once a month).
  async postXPerformanceAudit(): Promise<void> {
    const base = process.env.DASHBOARD_URL || "http://dashboard:3000";
    let data: any;
    try {
      const res = await fetch(
        `${base}/api/backtest?type=Type1&lookback=30&horizon=20`,
      );
      if (!res.ok) throw new Error(`backtest HTTP ${res.status}`);
      data = await res.json();
    } catch (e) {
      console.error("X audit: backtest fetch failed:", (e as Error).message);
      return;
    }

    const s = data?.summary;
    if (!s || !s.totalSignals) {
      console.log("⊘ X audit: no evaluated signals in window");
      return;
    }

    const lead =
      `📊 DataQuant performance audit — trailing 30 days\n` +
      `Signals: ${s.totalSignals} · Win rate: ${s.winRate.toFixed(0)}% · Avg/trade: ${fmtPct(s.avgReturn)} (8% stop)\n` +
      `Median: ${fmtPct(s.medianReturn)}\n` +
      `We publish wins AND losses. Not advice`;

    const tierLines = (data.byTier || [])
      .filter((t: any) => t.count > 0)
      .map(
        (t: any) =>
          `${t.label}: ${t.count} signals · ${t.winRate.toFixed(0)}% win · ${fmtPct(t.avgReturn)} avg`,
      );

    const thread = [lead];
    if (tierLines.length) {
      thread.push(...chunkLines(["By confidence tier:", ...tierLines], 270));
    }
    thread.push(ctaReply());
    await postXThread(thread);
  }

  // ── X use case 3: earnings breakdown thread (single best) ─────────────────
  // Once a day, post ONE AI earnings breakdown — the highest-confidence breakout
  // with raised guidance and the most bullish tone. Posting only the single best
  // name keeps X quota low and sneak-peeks just our strongest pick (entry/stop
  // still withheld) instead of leaking the whole breakout watchlist. Selection
  // is driven by the signal (confidence lives on BreakoutSignal); the full
  // breakdown comes from TranscriptAnalysis. Dedup via xPostedAt (once/quarter).
  async postXEarningsThreads(): Promise<void> {
    const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // last 3 days of alerts

    // Best raised-guidance breakout first: confidence, then earnings tone.
    // Exclude Type1b (clean breakout on WEAK volume) — only real volume-backed
    // breakouts get the sneak peek.
    const candidates = await db.breakoutSignal.findMany({
      where: {
        lastAlertAt: { gte: since },
        earningsGuidance: "raised",
        breakoutType: { not: "Type1b" },
      },
      orderBy: [{ confidence: "desc" }, { earningsToneScore: "desc" }],
    });

    const seen = new Set<string>();
    for (const c of candidates) {
      if (seen.has(c.asset)) continue;
      seen.add(c.asset);

      // Full breakdown lives on TranscriptAnalysis; skip if this asset's latest
      // earnings was already posted (xPostedAt set) or we have no analysis.
      const ta = await db.transcriptAnalysis.findFirst({
        where: { asset: c.asset, xPostedAt: null },
        orderBy: [{ year: "desc" }, { quarter: "desc" }],
      });
      if (!ta) continue;

      const highlights = (ta.highlights as string[]) || [];
      const risks = (ta.riskFlags as string[]) || [];
      const guidance =
        ta.guidanceDirection && ta.guidanceDirection !== "none"
          ? ` · Guidance: ${capitalize(ta.guidanceDirection)}`
          : "";

      // Reveal the breakout too (this is the top pick): cross price + volume
      // confirmation for Type1, or extension for Type3. Stop/R:R still withheld.
      const cross = (c.entryPrice ?? c.resistance).toFixed(2);
      const brk =
        c.breakoutType === "Type3"
          ? `🚀 $${ta.asset} extension — holding above $${cross}`
          : `🚀 $${ta.asset} broke out $${cross} on strong volume`;
      const lead =
        `${brk}\n` +
        `📞 Q${ta.quarter} ${ta.year} earnings — Tone: ${capitalize(ta.tone)} (${fmtScore(ta.toneScore)})${guidance}`;

      const thread = [lead, truncate(ta.summary, 270)];
      if (highlights.length) {
        thread.push(
          ...chunkLines(["✅ Highlights", ...highlights.map((h) => `• ${h}`)], 270),
        );
      }
      if (risks.length) {
        thread.push(
          ...chunkLines(["⚠️ Risk flags", ...risks.map((r) => `• ${r}`)], 270),
        );
      }
      thread.push(ctaReply(ta.asset));

      const posted = await postXThread(thread);
      if (posted) {
        await db.transcriptAnalysis.update({
          where: { id: ta.id },
          data: { xPostedAt: new Date() },
        });
        console.log(
          `✓ X earnings thread posted (best): $${ta.asset} conf ${(c.confidence * 100).toFixed(0)}% tone ${fmtScore(ta.toneScore)}`,
        );
      }
      return; // one per run — the single best
    }

    console.log("⊘ X earnings: no raised-guidance breakout with a fresh analysis");
  }

  // ── X use case 4: earnings-calendar-timed intercept ───────────────────────
  // When a ticker we already have a recent signal on reports earnings TODAY,
  // post a fast EPS/revenue beat-miss card timed to the print (attention peaks
  // then). Watchlist = our own recent signals — no whole-market calendar pull,
  // so it stays cheap on FMP bandwidth. Dedup via earningsPostedAt (once/asset/day).
  async postXEarningsCalendar(): Promise<void> {
    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) return;
    const now = new Date();
    const since = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    // Earnings are quarterly, so dedup per-quarter (not per-day): once we've
    // posted a card for an asset, don't post another for ~30 days. This also
    // stops the yesterday-grace match from double-posting across two runs.
    const dedupBefore = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const maxPerRun = parseInt(process.env.X_EARNINGS_CAL_MAX || "3");

    // Watchlist: distinct assets alerted in the last 10 days we haven't already
    // posted an earnings card for this quarter.
    const rows = await db.breakoutSignal.findMany({
      where: {
        lastAlertAt: { gte: since },
        OR: [{ earningsPostedAt: null }, { earningsPostedAt: { lt: dedupBefore } }],
      },
      orderBy: [{ confidence: "desc" }],
      distinct: ["asset"],
    });

    let posted = 0;
    for (const s of rows) {
      if (posted >= maxPerRun) break;
      const e = await fetchRecentEarnings(s.asset, apiKey);
      if (!e) continue; // hasn't reported today

      const beat = e.epsActual >= e.epsEstimated;
      const revLine =
        e.revenueActual != null && e.revenueEstimated != null
          ? `\n• Revenue: ${fmtB(e.revenueActual)} vs ${fmtB(e.revenueEstimated)} est (${e.revenueActual >= e.revenueEstimated ? "Beat" : "Miss"})`
          : "";
      const card =
        `${beat ? "📈" : "📉"} $${s.asset} reported earnings — EPS ${beat ? "Beat" : "Miss"} ${fmtPct(e.epsSurprisePct)}\n` +
        `• EPS: ${e.epsActual.toFixed(2)} vs ${e.epsEstimated.toFixed(2)} est` +
        revLine +
        `\nWe flagged this breakout.`;

      const ok = await postXThread([card, ctaReply(s.asset)]);
      if (ok) {
        await db.breakoutSignal.updateMany({
          where: { asset: s.asset },
          data: { earningsPostedAt: now },
        });
        posted++;
        console.log(`✓ X earnings-calendar card posted: $${s.asset} EPS ${beat ? "Beat" : "Miss"}`);
      }
    }
    if (posted === 0)
      console.log("⊘ X earnings-calendar: no watchlist ticker reported today");
  }
}

// Pack lines into as few tweets as possible without any tweet exceeding maxLen.
function chunkLines(lines: string[], maxLen: number): string[] {
  const chunks: string[] = [];
  let cur = "";
  for (const line of lines) {
    if (cur && cur.length + 1 + line.length > maxLen) {
      chunks.push(cur);
      cur = line;
    } else {
      cur = cur ? `${cur}\n${line}` : line;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const fmtScore = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(2);
const fmtPct = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(1) + "%";
const fmtB = (v: number) => "$" + (v / 1e9).toFixed(1) + "B";
const truncate = (s: string, n: number) =>
  s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
// Per-ticker deep link, e.g. dataquant.ai/$hpe
const dqLink = (asset: string) => `dataquant.ai/$${asset.toLowerCase()}`;
// Final reply for a thread: bookmark CTA + the link kept OUT of the lead tweet
// (link-in-reply preserves lead-tweet reach — the strongest lever in X ranking).
// asset omitted → homepage link.
const ctaReply = (asset?: string) =>
  `🔖 Bookmark this for market open.\n` +
  `Full entry, stop & R:R → ${asset ? dqLink(asset) : "dataquant.ai"} · Not advice`;
