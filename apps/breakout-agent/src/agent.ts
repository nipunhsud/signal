import { fetchMarketData, fetchEarningsSurprise, fetchRecentEarnings, primeQuotes, setFmpDisabled } from "./tools/market-data.js";
import { analyzeBreakout, analyzeSetup } from "./tools/breakout-logic.js";
import { screenSetupWinner, screenMovingWinners } from "./tools/winners-logic.js";
import { sendEmail } from "./email.js";
import { postXThread } from "./x-post.js";
import { classifyShelf, cheatGate } from "../shelf.js";
// @ts-ignore — plain JS at the app root
import { activityWords } from "../activity.js";

// Sector rank at scan time: sectors of the fresh universe ordered by the
// median RS score of their names (the same roll-up the Sectors tab shows).
// Cached per process for 30 minutes; a scan pass stamps every signal with
// the sector's rank and the sector count so the row, the chat and the trader
// can prefer names in leading sectors without another query.
let sectorRankCache: { region: string; expires: number; ranks: Map<string, number>; count: number } | null = null;
async function sectorRankFor(region: string, sector: string | null | undefined): Promise<{ rank: number | null; count: number | null }> {
  if (!sector || sector === "Unclassified") return { rank: null, count: null };
  if (!sectorRankCache || sectorRankCache.region !== region || sectorRankCache.expires < Date.now()) {
    try {
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const rows = await db.assetReturn.findMany({ where: { region, assetType: "stock", updatedAt: { gte: dayAgo } }, select: { sector: true, rsScore: true } });
      const by = new Map<string, number[]>();
      for (const r of rows) { const k = r.sector || "Unclassified"; if (!by.has(k)) by.set(k, []); by.get(k)!.push(r.rsScore); }
      const med = (v: number[]) => { const a = v.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : -Infinity; };
      const ordered = [...by.entries()].filter(([, v]) => v.length >= 3).map(([k, v]) => [k, med(v)] as const).sort((x, y) => y[1] - x[1]);
      const ranks = new Map<string, number>(); ordered.forEach(([k], i) => ranks.set(k, i + 1));
      sectorRankCache = { region, expires: Date.now() + 30 * 60 * 1000, ranks, count: ordered.length };
    } catch (e: any) {
      console.warn("[sector rank] failed:", e?.message);
      return { rank: null, count: null };
    }
  }
  const rank = sectorRankCache.ranks.get(sector) ?? null;
  return { rank, count: rank == null ? null : sectorRankCache.count };
}
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

// The alert window: market hours plus a post-close grace period. The official
// close prints in the closing auction after the bell, so a scan at 16:00:00
// sees a pre-close quote; DE 2026-09-01 closed $676.08 over a $674.19 pivot
// and the email went out at 16:00 the NEXT day at $698. The post-close pass
// (POST_CLOSE_CRON, default 16:15 ET / 15:45 IST) runs inside this window and
// alerts on the settled close the same day.
export const POST_CLOSE_GRACE_MIN = 45;
export function isAlertWindow(date: Date = new Date(), region: Region = "US"): boolean {
  const st = marketStatus(date, region);
  if (st.open) return true;
  const h = MARKET_HOURS[region];
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: h.tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const mins = parseInt(parts.hour, 10) * 60 + parseInt(parts.minute, 10);
  const isWeekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(parts.weekday);
  return isWeekday && mins > h.close && mins <= h.close + POST_CLOSE_GRACE_MIN;
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
  // Why names dropped out of this pass, by reason. A pass that silently lost
  // half its universe looked normal until this was counted (Sep 2026: TWLO's
  // 21 Sep close never evaluated; ~55% of US stocks unscanned on 23 Sep).
  private scanMisses = new Map<string, number>();
  private noteMiss(reason: string) {
    this.scanMisses.set(reason, (this.scanMisses.get(reason) || 0) + 1);
  }

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
        ? `https://financialmodelingprep.com/stable/company-screener?isEtf=true&isFund=false&isActivelyTrading=true&limit=10000&apikey=${apiKey}`
        : `https://financialmodelingprep.com/stable/company-screener?marketCapMoreThan=${MIN_MARKET_CAP}&isEtf=false&isFund=false&isActivelyTrading=true&exchange=${EXCHANGES}&limit=10000&apikey=${apiKey}`;
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

      // Liquidity on our own stored average, not the screener's volume. The
      // screener's volumeMoreThan tests TODAY's volume so far, and the universe
      // is fetched at the 10:00 scan and cached for the day: on 23 Sep 2026 it
      // dropped 1,559 of 2,766 US stocks (median 709k shares/day, all liquid)
      // for the whole session. Names with no stored bars stay in, get seeded,
      // and are judged on their average from the next day.
      const minAvgVol = mode === "etfs" ? 10_000 : MIN_VOLUME;
      try {
        const since = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const avgs = await db.$queryRaw<{ symbol: string; av: number }[]>`
          SELECT symbol, AVG(volume)::float AS av FROM (
            SELECT symbol, volume, ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
            FROM "DailyBar" WHERE symbol = ANY(${allAssets}) AND date > ${since}
          ) x WHERE rn <= 20 GROUP BY symbol`;
        const thin = new Set(avgs.filter((r) => r.av < minAvgVol).map((r) => r.symbol));
        console.log(`[FMP] Liquidity: ${thin.size} of ${allAssets.length} ${assetType} under ${minAvgVol.toLocaleString()} avg shares (stored 20-day); ${allAssets.length - avgs.length} unseeded kept`);
        allAssets = allAssets.filter((sym) => !thin.has(sym));
      } catch (e: any) {
        console.warn(`[FMP] Liquidity filter skipped (${e?.message}); scanning the unfiltered screener list`);
      }

      console.log(`[FMP AUDIT] Before delisting filter: ${allAssets.length} ${assetType} (${mode === "stocks" ? "added " + (MEGACAP_WATCH.filter(m => !stockSymbols.includes(m)).length || 0) + " missing megacaps" : "no filtering"})`);

      const elapsed = Date.now() - startTime;
      const filterDesc = mode === "etfs" ? "avg vol >10k" : `market cap >$${(MIN_MARKET_CAP / 1e6).toFixed(0)}M, avg vol >${MIN_VOLUME.toLocaleString()}`;
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
    this.scanMisses.clear();

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

    const misses = [...this.scanMisses.entries()].sort((a, b) => b[1] - a[1]);
    const missed = misses.reduce((n, [, c]) => n + c, 0);
    console.log(
      `[Coverage ${mode}] ${this.breadthTotalScanned}/${shardedAssets.length} analyzed, ${missed} missed` +
        (missed ? `: ${misses.map(([r, c]) => `${c}× ${r}`).join(" · ")}` : ""),
    );

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
          this.noteMiss(errorMsg.match(/\[[A-Z]+\]/)?.[0] || "no data");
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
        breakoutAnalysis.baseGrade
          ? `Grade ${breakoutAnalysis.baseGrade} (${{ S: "63% hist. win — 16wk+ tight sky base", "A+": "58% hist. win — 5wk+ tight sky base", A: "55% hist. win — blue-sky base" }[breakoutAnalysis.baseGrade]}) · ${(breakoutAnalysis.baseBarsCount / 5).toFixed(0)}wk base, ${breakoutAnalysis.baseDepthPct.toFixed(1)}% deep, pivot $${breakoutAnalysis.basePivot.toFixed(2)} · ${breakoutAnalysis.volumeTag} volume`
          : null,
        breakoutAnalysis.cohort ? `Cohort ${breakoutAnalysis.cohort} (${{ S: "67% hist. win — sky+16wk+2x vol", A: "57-60% hist. win — blue sky", B: "47% hist. win — long base + volume", C: "29-41% hist. win — baseline grade" }[breakoutAnalysis.cohort]})` : null,
        premiumVolume ? `🔥 Premium volume (${volumeRatio.toFixed(1)}x avg)` : null,
        breakoutAnalysis.isVcp
          ? `VCP ✓ (ATR ${breakoutAnalysis.atrPercent.toFixed(1)}%, contraction ${breakoutAnalysis.contractionRatio.toFixed(2)}, expansion ${breakoutAnalysis.expansionRatio.toFixed(1)}x)`
          : null,
        breakoutAnalysis.isBlueSky ? "Blue Sky ✓ (base at 52w high)" : null,
        rsRating != null
          ? `RS: ${rsRating}${rsRating >= 89 ? " (leader)" : rsRating >= 80 ? " (strong)" : rsRating < 50 ? " (laggard)" : ""}`
          : null,
        breakoutAnalysis.trendTemplate
          ? "Trend template ✓"
          : `Trend template ✗${!breakoutAnalysis.ma200Rising ? " (200MA falling)" : breakoutAnalysis.pctAbove52wLow < 30 ? ` (${breakoutAnalysis.pctAbove52wLow.toFixed(0)}% off the 52w low)` : ""}`,
        breakoutAnalysis.deepBase
          ? `Deep base ${breakoutAnalysis.baseDepthPct.toFixed(0)}%, cleared the pivot by ${breakoutAnalysis.pivotClearancePct.toFixed(1)}% (entry is the close, not the pivot)${breakoutAnalysis.deepBasePremium ? ", tight coil and dry base" : ""}`
          : null,
        breakoutAnalysis.activity
          ? `Activity ${breakoutAnalysis.activity.score}/10 (${breakoutAnalysis.activity.acc} up / ${breakoutAnalysis.activity.dist} down heavy days, ${breakoutAnalysis.activity.bigUp} print${breakoutAnalysis.activity.bigUp === 1 ? "" : "s"})`
          : null,
        breakoutAnalysis.pivotTightPct > 0
          ? `Pivot range ${breakoutAnalysis.pivotTightPct.toFixed(1)}%${breakoutAnalysis.pivotTightPct < 5 ? " (tight)" : breakoutAnalysis.pivotTightPct >= 12 ? " (loose)" : ""}`
          : null,
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

      // Graded breakout (Sep 2026 system): today CLOSED above the X-ray base
      // pivot and the base grades S/A+/A. Computed here so the frozen-entry
      // logic below can use the base pivot as the entry on a fresh flip.
      const isGradedBreakout =
        breakoutAnalysis.baseGrade !== null &&
        breakoutAnalysis.gradedBreakoutToday &&
        breakoutAnalysis.liquidityOk;
      // Cheat entry (Sep 2026): the close cleared a tight shelf INSIDE a base
      // that would grade (blue sky, <=25% deep, above the 200MA) but has not
      // resolved. Minervini's early entry. Alerted, counted and labelled as
      // its own kind (low cheat / cheat / handle), never dressed as a pivot
      // close. Gate lives in shelf.js (pure, tested).
      const shelf = cheatGate({
        isGradedBreakout,
        baseGrade: breakoutAnalysis.baseGrade,
        gradedBreakoutToday: breakoutAnalysis.gradedBreakoutToday,
        liquidityOk: breakoutAnalysis.liquidityOk,
        volumeOk: breakoutAnalysis.volumeOk,
        bullishCandle: breakoutAnalysis.bullishCandle,
        cleanConsolidation: data.cleanConsolidation ?? false,
        close: data.close,
        resistance: breakoutAnalysis.resistance,
        basePivot: breakoutAnalysis.basePivot,
        baseDepthPct: breakoutAnalysis.baseDepthPct,
      });
      const isCheatBreakout = shelf != null;
      // Deep base: the 25-35% band the grade's depth cut drops, alertable on a
      // 2x close through the pivot (docs/depth-cut-study.md). Same trigger as a
      // graded breakout — the close above the base pivot — so it freezes the
      // pivot as the entry the same way.
      const isDeepBreakout =
        breakoutAnalysis.deepBase &&
        breakoutAnalysis.gradedBreakoutToday &&
        breakoutAnalysis.liquidityOk;
      const pivotBreakout = isGradedBreakout || isDeepBreakout;
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
        (["Type1", "Type1b", "Type3"].includes(latestForAsset.breakoutType) ||
          (latestForAsset as any).baseGrade != null) &&
        latestForAsset.entryPrice != null &&
        lastRowAgeMs <= STREAK_MAX_GAP_MS &&
        !stopBreached &&
        // A shelf (cheat) entry does not freeze the pivot close that follows:
        // when the base resolves, that is a new episode with the pivot as entry.
        !(
          pivotBreakout &&
          breakoutAnalysis.basePivot > 0 &&
          (latestForAsset.entryPrice as number) < breakoutAnalysis.basePivot * 0.999
        );
      // Fresh flip: entry = the X-ray base pivot when today is a graded
      // breakout (the level the whole base actually resolved through), else
      // the 20-bar Donchian resistance as before.
      // An entry freezes only when today's close actually cleared the level.
      // The rolling Donchian high can be a spike no one traded through (a gap
      // bar's own high: MRNA 2026-08-19 set $176.66 while price sat at $146),
      // and freezing it produced phantom "stopped out" rows. Graded breakouts
      // clear their pivot by definition; other flips wait for a close above.
      // A deep-base alert freezes the BREAKOUT CLOSE, not the pivot. The rule
      // requires the close to clear the pivot by 3%+ and the average qualifier
      // clears it by 6.6%, so the pivot is a level the price has already left
      // and no reader could get. The study measures this kind from the close
      // too, so the entry, the 7% fail level and every reported return line up
      // with the evidence. Graded breakouts keep the pivot: their close sits
      // within a couple of percent of it.
      const flipLevel = isDeepBreakout
        ? data.close
        : isGradedBreakout && breakoutAnalysis.basePivot > 0
          ? breakoutAnalysis.basePivot
          : breakoutAnalysis.resistance;
      const levelCleared = pivotBreakout || data.close >= flipLevel * 0.995;
      const entryPrice: number | null = isActiveStreak
        ? (latestForAsset!.entryPrice as number)
        : levelCleared
          ? flipLevel
          : null;
      const stopLoss: number | null = isActiveStreak
        ? (latestForAsset!.stopLoss as number)
        : entryPrice != null
          ? entryPrice * 0.93
          : null;

      // Alerts (graded system, Sep 2026 — replaces the Type1/Type1b/grace
      // gates): actionable = today CLOSED above the X-ray base pivot AND the
      // base grades S/A+/A (blue-sky pivot, <=25% deep, above the 200MA).
      // Full-history validation (210k breakouts, 1970s-2026): S 62.6% win /
      // 11.6% stop-touch · A+ 57.7%/22.6% · A 54.8%/32.1% vs 32.1% win for
      // everything unqualified. Volume no longer gates — quiet breakouts from
      // graded bases WIN MORE with HALF the stop risk (57.5%/22.0%); volume
      // travels as volumeTag in the labels. The close-above-pivot trigger
      // replaces the intrabar Donchian poke (57.0% win vs 22.8%; 81% of pokes
      // are traps). Type1/Type3/EP classification continues for tracking, the
      // dashboard, and streak bookkeeping — it just no longer decides emails.
      // Quality floor on top of the setup gates (Sep 2026): an email needs
      // BOTH a relative-strength rank of 89 or better (the name outperforms
      // 89% of the scanned market — Minervini's "90% of my trades start at
      // RS 89+", and the band where the Minervini study's profit factor
      // stepped up to 2.20) AND confidence 80%+. Type 1 confidence is floored
      // at 80% upstream, so RS is the condition that decides; a name with no
      // RS rank yet does not email. Everything else stays on the dashboard.
      const qualityOk = rsRating != null && rsRating >= 89 && confidence >= 0.8;
      const shouldAlert = (isGradedBreakout || isCheatBreakout || isDeepBreakout) && qualityOk;

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

      // Persist classified breakouts AND graded breakouts. A graded breakout
      // can carry breakoutType "unknown" (IBIT 2026-09-01: real base breakout,
      // MA stack still inverted) — it must still persist or sendAlert finds no
      // record. Green-cone signals failing both systems are dropped as before.
      // The session after a graded base cleared its pivot, still above it.
      // Persisted even when no email goes out (the grace window's 2% ceiling,
      // or a pivot close the scans never saw): TWLO cleared $258.35 on 21 Sep
      // and the dashboard had no row for it until the late email.
      const gbNow = data.gradedBase;
      const clearedLastSession =
        breakoutAnalysis.baseGrade != null &&
        gbNow?.sessionsSinceBreakout === 1 &&
        data.close > (gbNow?.pivot ?? Infinity);
      const isMeaningfulBreakout =
        breakoutAnalysis.breakoutType !== "unknown" || isGradedBreakout || isCheatBreakout || isDeepBreakout || clearedLastSession;

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
          const sectorInfo = await sectorRankFor(regionOf(asset), breakoutAnalysis.sector);
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
              isReclaim: !!data.gradedBase?.reclaim,
              baseBreakoutDate: data.gradedBase?.status === "breakout" ? data.gradedBase.breakoutDate ?? null : null,
              baseBreakoutVolRatio: data.gradedBase?.status === "breakout" ? data.gradedBase.breakoutVolRatio ?? null : null,
              cohort: breakoutAnalysis.cohort,
              baseGrade: breakoutAnalysis.baseGrade,
              volumeTag: breakoutAnalysis.volumeTag,
              basePivot: breakoutAnalysis.basePivot > 0 ? breakoutAnalysis.basePivot : null,
              baseBars: breakoutAnalysis.baseBarsCount > 0 ? breakoutAnalysis.baseBarsCount : null,
              baseDepthPct: breakoutAnalysis.baseDepthPct > 0 ? breakoutAnalysis.baseDepthPct : null,
              trendTemplate: breakoutAnalysis.trendTemplate,
              pivotTightPct: breakoutAnalysis.pivotTightPct > 0 ? breakoutAnalysis.pivotTightPct : null,
              deepBase: breakoutAnalysis.deepBase,
              activityScore: breakoutAnalysis.activity?.score ?? null,
              activityAcc: breakoutAnalysis.activity?.acc ?? null,
              activityDist: breakoutAnalysis.activity?.dist ?? null,
              activityBigUp: breakoutAnalysis.activity?.bigUp ?? null,
              activityUdv: breakoutAnalysis.activity?.udv ?? null,
              activityObv: breakoutAnalysis.activity?.obv ?? null,
              sectorRank: sectorInfo.rank,
              sectorCount: sectorInfo.count,
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
          // Email at >=5x (was >=10x): the full-history re-study (11.5k events,
          // Sep 2026) showed the 5-10x band OUTPERFORMS the >=10x tail —
          // ~52.7% win / +5.9% mean vs 50.4% / +4.94% — so the 10x bar was
          // filtering out the better half of the signal.
          const epAlert = volumeRatio >= 5;
          await db.breakoutSignal.create({
            data: {
              asset,
              assetType: mode === "etfs" ? "etf" : "stock",
              confidence: epAlert ? 0.85 : 0.75,
              agentDecision: `Episodic pivot: up ${dayGainPct.toFixed(1)}% on ${volumeRatio.toFixed(1)}x average volume, a catalyst repricing. Closed at ${data.close.toFixed(2)}; the event-day low is ${data.low.toFixed(2)} (${Math.abs(((data.low - data.close) / data.close) * 100).toFixed(1)}% below). No trend requirement for this class, and these move a lot both ways.`,
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

      // ── Gap retest (GR): the catalyst gap held and the stock turned back up ──
      // Study (Sep 2026, docs/minervini-rules-study.md): 9,474 events 1985-2026,
      // 56.2% win / 46.4% stop-touch / PF 3.69 / 41.3% reach +20% in 60 bars,
      // above the pivot entry's PF in every decade. Tracked as its own kind;
      // emails only when GAP_RETEST_ALERT=true, so the ledger can judge it first.
      if (breakoutAnalysis.gapRetestToday && breakoutAnalysis.liquidityOk && breakoutAnalysis.gapRetest) {
        const gr = breakoutAnalysis.gapRetest;
        const grSince = new Date(`${gr.gapDate}T00:00:00Z`);
        const grExisting = await db.breakoutSignal.findFirst({
          where: { asset, breakoutType: "GR", createdAt: { gte: grSince } },
        });
        if (!grExisting) {
          const grAlert = process.env.GAP_RETEST_ALERT === "true";
          await db.breakoutSignal.create({
            data: {
              asset,
              assetType: mode === "etfs" ? "etf" : "stock",
              confidence: 0.8,
              agentDecision: `Gap retest: gapped up ${gr.gapPct.toFixed(1)}% on ${gr.gapDate} on ${gr.gapVolumeRatio.toFixed(1)}x average volume, pulled back ${gr.pullbackPct.toFixed(1)}% without filling the gap, and today closed above the prior day's high at ${data.close.toFixed(2)}. Just under half of these touch the fail level within 20 bars; two in five reach +20% within 60.`,
              shouldAlert: grAlert,
              resistance: breakoutAnalysis.resistance,
              support: breakoutAnalysis.support,
              currentPrice: data.close,
              entryPrice: data.close,
              stopLoss: data.close * 0.93,
              breakoutType: "GR",
              volumeRatio: gr.gapVolumeRatio,
              sector: breakoutAnalysis.sector,
              industry: breakoutAnalysis.industry,
              rsRating,
              isBlueSky: breakoutAnalysis.isBlueSky,
              liquidityOk: breakoutAnalysis.liquidityOk,
              baseGrade: breakoutAnalysis.baseGrade,
              basePivot: breakoutAnalysis.basePivot > 0 ? breakoutAnalysis.basePivot : null,
              baseBars: breakoutAnalysis.baseBarsCount > 0 ? breakoutAnalysis.baseBarsCount : null,
              baseDepthPct: breakoutAnalysis.baseDepthPct > 0 ? breakoutAnalysis.baseDepthPct : null,
              trendTemplate: breakoutAnalysis.trendTemplate,
              signalDate: data.timestamp,
            },
          });
          console.log(`↩ GR ${asset}: gap ${gr.gapDate} +${gr.gapPct.toFixed(1)}%, pullback ${gr.pullbackPct.toFixed(1)}%, turn today${grAlert ? " (ALERT)" : ""}`);
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
      // Symbols and prices stripped so one cause buckets as one reason.
      const msg = String((error as any)?.message || error).replace(/\b[A-Z]{1,5}(\.[A-Z]{1,3})?\b/g, "X").replace(/[\d.]+/g, "N");
      this.noteMiss(msg.slice(0, 60));
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

    // ALL alerts wait for the alert window: market hours (US 9:30-16:00 ET /
    // NSE 9:15-15:30 IST, Mon-Fri) plus the post-close grace period, so the
    // settled close can email the same day. Was type-gated — a graded breakout
    // persisted on an "unknown"-type row slipped past and could email on a
    // weekend scan.
    if (!isAlertWindow(new Date(), regionOf(result.asset))) {
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

    // One alert per base episode. An asset emails when its graded base
    // resolves, then lives on the dashboard as a tracked extension — a second
    // email requires a NEW base (different pivot). The old ±2% price-drift
    // re-alert is gone: price drifting through a band is not a chart event
    // and carried no information (VLO 2026: first alert Jul 16, real base
    // breakout Aug 11 unalerted, then a drift re-fire Aug 31 — all noise).
    if (existingAlert) {
      const prevPivot = (existingAlert as any).basePivot as number | null;
      const curPivot = (latestRecord as any).basePivot as number | null;
      const sameBase =
        prevPivot != null && curPivot != null && Math.abs(prevPivot - curPivot) < 0.01;
      // Legacy alerts (pre-grade rows have no pivot): treat any alert in the
      // last 45 days as the same episode so the cutover doesn't replay them.
      const legacySameEpisode =
        prevPivot == null &&
        existingAlert.alertSentAt != null &&
        Date.now() - new Date(existingAlert.alertSentAt).getTime() <
          45 * 24 * 60 * 60 * 1000;
      // A cheat (shelf) alert and the pivot close of the same base are two
      // events: the second is allowed. Two shelves in one base are not.
      const prevWasShelf =
        existingAlert.entryPrice != null && prevPivot != null && existingAlert.entryPrice < prevPivot * 0.999;
      const nowPivot =
        latestRecord.entryPrice != null && curPivot != null && latestRecord.entryPrice >= curPivot * 0.999;
      if ((sameBase && !(prevWasShelf && nowPivot)) || legacySameEpisode) {
        console.log(
          `⊘ Skip ${result.asset}: base already alerted (pivot $${prevPivot?.toFixed(2) ?? "legacy"}) — tracking as extension`,
        );
        return;
      }
      console.log(
        `↻ New episode ${result.asset}: new base pivot $${curPivot?.toFixed(2)} (prev $${prevPivot?.toFixed(2) ?? "n/a"})`,
      );
    }

    // Voice: .claude/skills/dataquant-voice/SKILL.md — report what the screen
    // saw, no recommendation. Subject is the fact; body is levels + why.
    const rec = latestRecord as any;
    const isExt = latestRecord.breakoutType === "Type3";
    const isEp = latestRecord.breakoutType === "EP";
    const weeks = rec.baseBars ? Math.round(rec.baseBars / 5) : null;
    const baseBits = [
      rec.baseGrade ? `grade ${rec.baseGrade}` : rec.deepBase ? "deep base" : null,
      weeks ? `${weeks}-week base` : null,
      rec.deepBase && rec.baseDepthPct ? `${Number(rec.baseDepthPct).toFixed(0)}% deep` : null,
    ].filter(Boolean);
    // A deep base is a different bet from a graded one and the email says so.
    const deepLine = rec.deepBase
      ? `This one is a deep base, ${rec.baseDepthPct ? Number(rec.baseDepthPct).toFixed(0) + "% " : ""}under its pivot at the low, which the grade rules exclude at 25%. It cleared that pivot decisively on real volume, which is what separates the band, and the level above is the close it cleared at — not the pivot, which the price has already left. Over 1,057 of these since 1985, 53% were positive 20 bars on, 52% touched the fail level, and 34% ran 20% or more within 60 bars, against 14% for graded breakouts. Bigger winners, more failures.`
      : null;
    // Shelf (cheat) entry: the emailed level sits inside a base that has not resolved.
    const shelfNow = classifyShelf({
      level: latestRecord.entryPrice,
      basePivot: rec.basePivot,
      baseDepthPct: rec.baseDepthPct,
      price: result.currentPrice,
    });
    const what = isEp
      ? "repriced on a catalyst"
      : shelfNow
        ? "closed above a shelf inside its base"
        : rec.isReclaim
          ? "closed back above a failed breakout's high on light volume"
        : isExt
          ? "is holding past its pivot"
          : "closed above its pivot";
    // The breakout bar's volume rides in the subject once it is 1.5x or more:
    // RS and the clearing bar's volume are what the studies found predictive.
    const boVol = rec.baseBreakoutVolRatio as number | null;
    const volBit = boVol != null && boVol >= 1.5 && !isEp ? ` on ${boVol.toFixed(1)}× volume` : "";
    const subject = `${result.asset} ${what}${volBit}${baseBits.length ? " · " + baseBits.join(" · ") : ""}`;
    const tradingViewUrl = `https://www.tradingview.com/chart/WgVJPfij/?symbol=${encodeURIComponent(tradingViewSymbol(result.asset))}`;

    // Levels: the frozen pivot and its fail level (7% below), snapshotted when
    // the close first cleared it. Never the rolling Donchian value.
    const pivotVal = latestRecord.entryPrice ?? result.resistance;
    const failVal = latestRecord.stopLoss ?? pivotVal * 0.93;
    const pctPast = pivotVal > 0 ? ((result.currentPrice - pivotVal) / pivotVal) * 100 : null;

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
        const toneWord = ta.tone === "bullish" ? "bullish" : ta.tone === "bearish" ? "bearish" : "neutral";
        const guideWord =
          ta.guidanceDirection === "raised" ? "guidance went up"
          : ta.guidanceDirection === "lowered" ? "guidance came down"
          : ta.guidanceDirection === "maintained" ? "guidance held"
          : "no guidance given";
        transcriptSection = `
Earnings call, Q${ta.quarter} ${ta.year}
The call read ${toneWord} (${ta.toneScore >= 0 ? "+" : ""}${ta.toneScore.toFixed(2)}) and ${guideWord}.
${ta.summary}
${highlights.length ? highlights.map((h) => "  + " + h).join("\n") : ""}
${risks.length ? risks.map((r) => "  - " + r).join("\n") : ""}
`.replace(/\n{3,}/g, "\n\n");
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
Second read (${review.rating}/10)
${review.strength}
Worth watching: ${review.watchFor}
`;
      }
    }

    const fmt = (v: number) => "$" + v.toFixed(2);
    const pad = (k: string, v: string) => `${k.padEnd(12)}${v}`;
    const activityLine = rec.activityScore != null
      ? `${rec.activityScore}/10 — ${activityWords({ score: rec.activityScore, acc: rec.activityAcc ?? 0, dist: rec.activityDist ?? 0, bigUp: rec.activityBigUp ?? 0, udv: rec.activityUdv ?? null, obv: rec.activityObv ?? null, points: { net: 0, bigUp: 0, udv: 0, obv: 0 } })}`
      : null;
    const sectorLine = rec.sectorRank != null && rec.sectorCount ? `${latestRecord.sector || "unknown"} — ranked ${rec.sectorRank} of ${rec.sectorCount} sectors` : null;
    const baseLine = [
      rec.baseGrade ? `grade ${rec.baseGrade}` : null,
      weeks ? `${weeks} weeks` : null,
      rec.baseDepthPct ? `${Number(rec.baseDepthPct).toFixed(0)}% deep` : null,
      latestRecord.volumeRatio ? `volume ${latestRecord.volumeRatio.toFixed(1)}x` : null,
    ].filter(Boolean).join(" · ");
    const levelWord = shelfNow ? "shelf" : "pivot";
    const levels = [
      pad(shelfNow ? "Shelf" : "Pivot", pivotVal > 0 ? fmt(pivotVal) : "n/a"),
      pad("Close", fmt(result.currentPrice) + (pctPast != null ? `  (${pctPast >= 0 ? "+" : ""}${pctPast.toFixed(1)}% vs the ${levelWord})` : "")),
      pad("Fail level", failVal > 0 ? fmt(failVal) + `  (7% below the ${levelWord})` : "n/a"),
      shelfNow ? pad("Base pivot", `${fmt(shelfNow.basePivot)}  (${shelfNow.pctBelowPivot.toFixed(1)}% above the close, not cleared yet)`) : null,
      shelfNow ? pad("Entry", `${shelfNow.label.toLowerCase()}, ${shelfNow.posPct}% of the way up the base`) : null,
      baseLine ? pad("Base", baseLine) : null,
      activityLine ? pad("Activity", activityLine) : null,
      pad("Sector", sectorLine || `${latestRecord.sector || "unknown"}${latestRecord.industry ? " / " + latestRecord.industry : ""}`),
      pad("Confidence", `${(result.confidence * 100).toFixed(0)}%`),
      latestRecord.assetType === "etf" && latestRecord.expenseRatio ? pad("Expense", `${latestRecord.expenseRatio}%`) : null,
    ].filter(Boolean).join("\n");

    const body = `${result.asset} ${what}.

${levels}
${deepLine ? "\n" + deepLine + "\n" : ""}

Why the screen flagged it
${result.reasoning}
${aiReviewSection}${transcriptSection}
Chart   ${tradingViewUrl}
Screen  ${dqLink(result.asset)}

Screen output for research, not advice.
`;

    await sendEmail(subject, body);

    // Stamp the row that was emailed — only that row. The ledger (/api/alerts,
    // the Saturday receipts, the Backtest tab) reads the entry, fail level and
    // grade off the stamped row, so an asset-wide stamp would blur which
    // episode went out. A new base (new pivot) is a new alert with its own date.
    await db.breakoutSignal.update({
      where: { id: latestRecord.id },
      data: {
        alertSentAt: now,
        lastAlertPrice: result.currentPrice,
        lastAlertAt: now,
      },
    });

    console.log(`✓ Alert sent: ${result.asset} @ $${result.currentPrice}`);
  }

  // ── X use case 1: the daily tease ─────────────────────────────────────────
  // Once a day after the close: ONE graded fresh breakout, one line. Voice in
  // .claude/skills/dataquant-voice/SKILL.md. Extensions never tease (they are
  // not what the screen is for); ungraded rows never tease. Runs on the
  // shard-0 tier only (gated in index.ts), reads the shared DB.
  async postXSignalTeasers(): Promise<void> {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0); // container TZ is America/New_York
    const maxPerDay = parseInt(process.env.X_TEASER_MAX || "1");

    const postedToday = await db.breakoutSignal.findMany({
      where: { xPostedAt: { gte: startOfToday } },
      distinct: ["asset"],
      select: { asset: true },
    });
    const postedSet = new Set(postedToday.map((r) => r.asset));

    const candidates = await db.breakoutSignal.findMany({
      where: { lastAlertAt: { gte: startOfToday } },
      orderBy: { createdAt: "desc" },
      distinct: ["asset"],
    });

    const gradeRank: Record<string, number> = { S: 3, "A+": 2, A: 1 };
    const qualifying = candidates
      .filter((s) => {
        const r = s as any;
        return (
          !postedSet.has(s.asset) &&
          regionOf(s.asset) === "US" && // X audience is US — never tease NSE/BSE names
          s.breakoutType !== "EP" &&
          // Graded OR deep-base: a deep-base alert carries no grade, and the
          // grade gate used to hide the whole kind from the tease.
          (gradeRank[r.baseGrade] != null || r.deepBase === true) &&
          s.entryPrice != null
        );
      })
      .sort((a, b) => ((gradeRank[(b as any).baseGrade] ?? 0) - (gradeRank[(a as any).baseGrade] ?? 0)) || b.confidence - a.confidence)
      .slice(0, maxPerDay);

    if (qualifying.length === 0) {
      console.log("⊘ X tease: no graded or deep-base breakout today");
      return;
    }

    for (const s of qualifying) {
      const r = s as any;
      const weeks = r.baseBars ? Math.round(r.baseBars / 5) : null;
      const shelfT = classifyShelf({ level: s.entryPrice, basePivot: r.basePivot, baseDepthPct: r.baseDepthPct, price: s.currentPrice });
      const lead = shelfT
        ? `$${s.asset} closed above a shelf today, $${(s.entryPrice as number).toFixed(2)}, ${shelfT.posPct}% of the way up a grade ${r.baseGrade} base that has not resolved.`
        : `$${s.asset} closed above its pivot today, $${(s.entryPrice as number).toFixed(2)}. ` +
          `Grade ${r.baseGrade} base${weeks ? `, ${weeks} weeks long` : ""}.`;
      const reply = `Why it graded ${r.baseGrade}, and the rest of today's screen: ${dqLink(s.asset)}`;
      const posted = await postXThread([lead, reply]);
      if (posted) {
        await db.breakoutSignal.updateMany({ where: { asset: s.asset }, data: { xPostedAt: now } });
        console.log(`✓ X tease posted: ${s.asset} (grade ${r.baseGrade})`);
      }
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
      `Thirty days of the screen: ${s.totalSignals} breakouts, ` +
      `${s.winRate.toFixed(0)}% were past their pivot twenty days later, ` +
      `average ${fmtPct(s.avgReturn)} with exits at the fail level. ` +
      `Median ${fmtPct(s.medianReturn)}.`;

    const tierLines = (data.byTier || [])
      .filter((t: any) => t.count > 0)
      .map((t: any) => `${t.label}: ${t.count}, ${t.winRate.toFixed(0)}% past the pivot, ${fmtPct(t.avgReturn)} average.`);

    const thread = [lead];
    if (tierLines.length) thread.push(...chunkLines(["By confidence tier.", ...tierLines], 270));
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
      // The breakout in one clause, the call in one sentence. No label pairs.
      const cross = (c.entryPrice ?? c.resistance).toFixed(2);
      const brk =
        c.breakoutType === "Type3"
          ? `$${ta.asset} is holding past its $${cross} pivot.`
          : `$${ta.asset} closed above its $${cross} pivot.`;
      const guideWord =
        ta.guidanceDirection === "raised" ? "guidance went up"
        : ta.guidanceDirection === "lowered" ? "guidance came down"
        : ta.guidanceDirection === "maintained" ? "guidance held"
        : "no guidance was given";
      const lead = `${brk} The Q${ta.quarter} ${ta.year} call read ${ta.tone} and ${guideWord}.`;

      const thread = [lead, truncate(ta.summary, 270)];
      if (highlights.length) thread.push(...chunkLines(["What management said.", ...highlights], 270));
      if (risks.length) thread.push(...chunkLines(["What to keep an eye on.", ...risks], 270));
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
          ? ` Revenue ${fmtB(e.revenueActual)} against ${fmtB(e.revenueEstimated)}, a ${e.revenueActual >= e.revenueEstimated ? "beat" : "miss"}.`
          : "";
      const card =
        `$${s.asset} reported. EPS ${e.epsActual.toFixed(2)} against ${e.epsEstimated.toFixed(2)} expected, ` +
        `a ${beat ? "beat" : "miss"} of ${fmtPct(e.epsSurprisePct).replace("+", "")}.` +
        revLine +
        ` It is on the screen.`;

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

const fmtScore = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(2);
const fmtPct = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(1) + "%";
const fmtB = (v: number) => "$" + (v / 1e9).toFixed(1) + "B";
const truncate = (s: string, n: number) =>
  s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
// Per-ticker deep link, e.g. dataquant.ai/$hpe
const dqLink = (asset: string) => `dataquant.ai/$${asset.toLowerCase()}`;
// Final reply for a thread: where the rest lives. The link stays OUT of the
// lead tweet (link-in-reply preserves lead-tweet reach). asset omitted → homepage.
const ctaReply = (asset?: string) =>
  `Base grades, the 2-year X-ray and the full screen: ${asset ? dqLink(asset) : "dataquant.ai"}. Screen output for research, not advice.`;
