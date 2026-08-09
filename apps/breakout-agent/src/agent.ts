import { fetchMarketData, fetchEarningsSurprise } from "./tools/market-data.js";
import { analyzeBreakout, analyzeSetup } from "./tools/breakout-logic.js";
import { screenSetupWinner, screenMovingWinners } from "./tools/winners-logic.js";
import { sendEmail } from "./email.js";
import { db } from "./db.js";
import { filterDelistedStocks } from "./tools/delistings.js";
import { getOrAnalyzeTranscript } from "./tools/transcript-analysis.js";
import { reviewSignal } from "./tools/ai-signal-review.js";
import { globalRateLimiter } from "./tools/rate-limiter.js";

// US market hours are always defined in America/New_York, regardless of
// container TZ. Returns `label` so callers can log the checked ET time.
export function marketStatus(date: Date = new Date()): {
  open: boolean;
  label: string;
} {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;

  const label = `${parts.hour}:${parts.minute} ${parts.weekday} ET`;
  const mins = parseInt(parts.hour, 10) * 60 + parseInt(parts.minute, 10);
  const isWeekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(parts.weekday);
  // 9:30 AM (570) - 4:00 PM (960) inclusive of 16:00 so the post-close scan
  // captures the settling close print.
  return { open: isWeekday && mins >= 570 && mins <= 960, label };
}

export function isMarketOpen(date: Date = new Date()): boolean {
  return marketStatus(date).open;
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

  async fetchAssetsFromFMP(mode: "stocks" | "etfs" = "stocks"): Promise<string[]> {
    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) throw new Error("FMP_API_KEY not set");

    const MIN_MARKET_CAP = parseInt(process.env.MIN_MARKET_CAP || "300000000"); // $300M default
    const MIN_VOLUME = parseInt(process.env.MIN_VOLUME || "100000"); // 100k shares default
    const MEGACAP_WATCH = ["NVDA", "MSFT", "ASML", "AMAT", "OPEN", "NBIS"];

    try {
      console.log(`[FMP] Fetching filtered US ${mode} (split queries for manageability)...`);
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
        : `https://financialmodelingprep.com/stable/company-screener?marketCapMoreThan=${MIN_MARKET_CAP}&volumeMoreThan=${MIN_VOLUME}&isEtf=false&isFund=false&isActivelyTrading=true&exchange=NASDAQ,NYSE,AMEX&limit=10000&apikey=${apiKey}`;
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

      // Only add megacap watch for stocks mode
      let allAssets = [...new Set(stockSymbols)];
      if (mode === "stocks") {
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

      // Filter out delisted stocks
      const activeAssets = await filterDelistedStocks(allAssets);
      console.log(`[FMP AUDIT] After delisting filter: ${activeAssets.length} ${assetType} (removed ${allAssets.length - activeAssets.length})`);

      // Check if any megacaps were filtered by delisting (stocks only)
      if (mode === "stocks") {
        const megacapsAfterFilter = MEGACAP_WATCH.filter((m) => activeAssets.includes(m));
        const megacapsFilteredOut = MEGACAP_WATCH.filter((m) => stockSymbols.includes(m) && !activeAssets.includes(m));
        if (megacapsFilteredOut.length > 0) {
          console.log(`[FMP AUDIT] Megacaps FILTERED OUT by delisting check: ${megacapsFilteredOut.join(", ")}`);
        }
        if (megacapsAfterFilter.length > 0) {
          console.log(`[FMP AUDIT] Megacaps IN final asset list: ${megacapsAfterFilter.join(", ")}`);
        }
      }

      return activeAssets;
    } catch (error) {
      console.error("[FMP] Asset fetch failed:", error);
      throw error;
    }
  }

  // 5 parallel tiers × 15 concurrency = 75 assets in flight (with sequential stocks/etfs scans)
  // Rate limiter (per-container from env, sum across tiers < 750/min) queues FMP calls fairly
  // Cache reduces actual API calls by 60-70%, so even safer
  async analyzeMarkets(assets: string[], mode: "stocks" | "etfs" = "stocks"): Promise<BreakoutResult[]> {
    const CONCURRENCY = 15;

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

    for (let i = 0; i < shardedAssets.length; i += CONCURRENCY) {
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
      const volumeIncreasing = volumeRatio > 1.3;

      // Fetch earnings transcript for Type 1/3 stock breakouts (cached per quarter).
      // Done up-front so we can boost confidence and persist the snapshot with the signal.
      let earnings: Awaited<ReturnType<typeof getOrAnalyzeTranscript>> = null;
      const isBreakoutStock =
        (breakoutAnalysis.breakoutType === "Type1" ||
          breakoutAnalysis.breakoutType === "Type3") &&
        data.assetType === "stock";
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

      const localReasoning = [
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
      const isActiveStreak =
        latestForAsset &&
        latestForAsset.breakoutType !== "unknown" &&
        latestForAsset.entryPrice != null &&
        lastRowAgeMs <= STREAK_MAX_GAP_MS;
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
              sector: breakoutAnalysis.sector,
              industry: breakoutAnalysis.industry,
              fedFundsRate: breakoutAnalysis.fedFundsRate,
              volumeRatio,
              expenseRatio: data.expenseRatio,
              assetUnderManagement: data.assetUnderManagement,
              etfCategory: data.etfCategory,
              breakoutType: breakoutAnalysis.breakoutType,
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

      // Store setup signals (Type 2 green cone) in Signal table with metadata.
      // Only tradable handles (tight + ≥5 bars) become per-row signals; loose
      // "base" setups feed the market-breadth aggregate written at scan-end.
      if (setupAnalysis.isSetup && setupAnalysis.qualifiesAsTradableHandle) {
        const setupReasoning = [
          `Setup Type: ${setupAnalysis.setupType}`,
          `MA Stack: ${breakoutAnalysis.maStack ? "Uptrend ✓" : "No uptrend ✗"}`,
          `Distance from MA20: ${setupAnalysis.distanceFromMA20.toFixed(2)}%`,
          `Consolidation: ${data.setupBarsInRange || 0} bars`,
          `Range: ${data.setupConsolidationRangePercent || 0}%`,
          `Volume: ${data.setupConsolidationVolumePercent || 0}% of avg`,
        ].join(" | ");

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

    // Type 1/1b/3 only alert during market hours (9:30am-4pm EDT, Mon-Fri)
    if ((latestRecord.breakoutType === "Type1" || latestRecord.breakoutType === "Type1b" || latestRecord.breakoutType === "Type3") && !isMarketOpen()) {
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

    const breakoutLabel = latestRecord.breakoutType === "Type1" ? "Fresh Breakout" : latestRecord.breakoutType === "Type1b" ? "Weak-Vol Breakout" : latestRecord.breakoutType === "Type3" ? "Extension Re-test" : "Breakout";
    const subject = `🚀 ${breakoutLabel}: ${result.asset} [${assetTypeIndicator}]`;
    const tradingViewUrl = `https://www.tradingview.com/chart/WgVJPfij/?symbol=${result.asset}`;

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
}
