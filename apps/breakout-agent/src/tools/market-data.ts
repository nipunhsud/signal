import axios from "axios";
import { globalRateLimiter } from "./rate-limiter.js";
import { marketDataCache } from "./cache.js";

function calculateMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1];
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export interface MarketData {
  asset: string;
  assetType: "stock" | "etf"; // Indicator for stock vs ETF
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  avgVolume: number;
  timestamp: Date;
  highs: number[]; // Last 20 candles for Donchian
  lows: number[];
  // Moving averages
  ma20: number;
  ma50: number;
  ma150: number;
  ma200: number;
  // Consolidation (bars in range before breakout) - Type 1
  barsInRange?: number;
  consolidationRangePercent?: number; // % range of consolidation bars
  consolidationVolumePercent?: number; // consolidation avg volume as % of 20-bar avg
  // Setup consolidation (pre-breakout without breakout yet) - Type 2
  setupBarsInRange?: number;
  setupConsolidationRangePercent?: number;
  setupConsolidationVolumePercent?: number;
  setupInflectionCount?: number; // Number of direction changes in setup consolidation
  // 52-week high
  high52w?: number;
  // Earnings
  earningsGrowth?: number; // YoY earnings growth %
  // Fundamentals
  epsGrowthPct?: number;
  revenueGrowthPct?: number;
  epsBeat?: boolean;
  epsSurprisePct?: number;
  sector?: string;
  industry?: string;
  beta?: number;
  fedFundsRate?: number;
  // ETF-specific
  expenseRatio?: number; // Annual expense ratio %
  assetUnderManagement?: number; // AUM in millions
  etfCategory?: string; // ETF category/type
  // Prior base and breakout detection (Type 1 vs Type 3 classification)
  priorBaseDays?: number; // # of days in prior consolidation (bars[-60..-6])
  priorBaseRangePercent?: number; // % range of that base
  priorBreakoutBarsAgo?: number; // bars ago since a prior high-volume breakout was detected (0 = none found)
}

/**
 * Fetch market data from FMP (Financial Modeling Prep)
 */
export async function fetchMarketData(
  asset: string,
): Promise<MarketData> {
  return fetchFMPData(asset);
}


interface ConsolidationResult {
  barsInRange: number;
  consolidationRangePercent: number;
  consolidationVolumePercent: number; // avg consolidation volume as % of 20-bar avg
  inflectionCount?: number; // Number of direction changes (peaks/troughs) in consolidation
}

interface PriorBaseResult {
  priorBaseDays: number;
  priorBaseRangePercent: number;
}

interface PriorBreakoutResult {
  priorBreakoutBarsAgo: number;
}

function countInflections(bars: any[]): number {
  if (bars.length < 3) return 0;

  // Use closes to detect direction changes
  const closes = bars.map((b) => b.close);
  let inflections = 0;
  let prevDirection = closes[1] > closes[0] ? 1 : -1; // 1 = up, -1 = down

  for (let i = 2; i < closes.length; i++) {
    const currDirection = closes[i] > closes[i - 1] ? 1 : -1;
    if (currDirection !== prevDirection) {
      inflections++;
      prevDirection = currDirection;
    }
  }

  return inflections;
}

function calculateBarsInRange(allBars: any[]): ConsolidationResult {
  if (allBars.length < 6)
    return {
      barsInRange: 0,
      consolidationRangePercent: 0,
      consolidationVolumePercent: 0,
    };

  const currentBar = allBars[allBars.length - 1];
  const prev5Bars = allBars.slice(-6, -1); // Previous 5 bars before current

  if (prev5Bars.length < 3)
    return {
      barsInRange: 0,
      consolidationRangePercent: 0,
      consolidationVolumePercent: 0,
    };

  // Calculate average volume from last 20 bars for reference
  const avgVolume =
    allBars.slice(-20).reduce((sum: number, b: any) => sum + b.volume, 0) / 20;

  // Check if previous bars form consolidation (allow up to 15% range with sliding scale)
  const consolidationHigh = Math.max(...prev5Bars.map((b: any) => b.high));
  const consolidationLow = Math.min(...prev5Bars.map((b: any) => b.low));
  const consolidationRange = consolidationHigh - consolidationLow;
  const consolidationRangePercent =
    (consolidationRange / consolidationLow) * 100;

  // Calculate consolidation volume as % of 20-bar average (lower is better, penalty applied in breakout-logic.ts)
  const consolidationAvgVolume =
    prev5Bars.reduce((sum: number, b: any) => sum + b.volume, 0) /
    prev5Bars.length;
  const consolidationVolumePercent = (consolidationAvgVolume / avgVolume) * 100;

  // Current bar must break above consolidation
  const breaksAboveConsolidation = currentBar.close > consolidationHigh;
  if (!breaksAboveConsolidation)
    return {
      barsInRange: 0,
      consolidationRangePercent: 0,
      consolidationVolumePercent: 0,
    };

  // Current bar must have high volume (>= 1.2x average)
  const highVolume = currentBar.volume >= avgVolume * 1.2;
  if (!highVolume)
    return {
      barsInRange: 0,
      consolidationRangePercent: 0,
      consolidationVolumePercent: 0,
    };

  // All conditions met: return count, range %, and volume % (penalties applied in breakout-logic.ts)
  return {
    barsInRange: prev5Bars.length,
    consolidationRangePercent,
    consolidationVolumePercent,
  };
}

/**
 * Detect setup consolidations: loose recent consolidation without breakout yet
 * For Type 2 signals (pre-breakout setups)
 * Allows consolidations up to ~10% range with low volume (< 80%)
 */
function detectSetupConsolidation(allBars: any[]): ConsolidationResult {
  if (allBars.length < 10)
    return {
      barsInRange: 0,
      consolidationRangePercent: 0,
      consolidationVolumePercent: 0,
      inflectionCount: 0,
    };

  // Look at the last 10 bars to find consolidation
  const recentBars = allBars.slice(-10);
  const avgVolume =
    allBars.slice(-20).reduce((sum: number, b: any) => sum + b.volume, 0) / 20;

  // Find the longest consecutive consolidation in these 10 bars
  let maxConsolidationBars = 0;
  let bestConsolidationHigh = 0;
  let bestConsolidationLow = 0;
  let bestConsolidationVolume = 0;
  let bestWindowBars: any[] = [];

  // Check windows of different sizes, from longest to shortest
  for (let winSize = recentBars.length - 1; winSize >= 3; winSize--) {
    for (let i = 0; i <= recentBars.length - winSize; i++) {
      const windowBars = recentBars.slice(i, i + winSize);
      const high = Math.max(...windowBars.map((b: any) => b.high));
      const low = Math.min(...windowBars.map((b: any) => b.low));
      const rangePercent = ((high - low) / low) * 100;
      const volPercent =
        (windowBars.reduce((sum: number, b: any) => sum + b.volume, 0) /
          windowBars.length /
          avgVolume) *
        100;

      // Allow consolidation (< 12% range) with low volume (< 80%)
      // This captures handles and loose setups
      if (
        rangePercent < 12 &&
        volPercent < 80 &&
        winSize > maxConsolidationBars
      ) {
        maxConsolidationBars = winSize;
        bestConsolidationHigh = high;
        bestConsolidationLow = low;
        bestConsolidationVolume = volPercent;
        bestWindowBars = windowBars;
      }
    }
    // Stop once we found a valid consolidation
    if (maxConsolidationBars > 0) break;
  }

  // Only return if we found a consolidation (at least 3 bars)
  if (maxConsolidationBars >= 3) {
    return {
      barsInRange: maxConsolidationBars,
      consolidationRangePercent:
        ((bestConsolidationHigh - bestConsolidationLow) /
          bestConsolidationLow) *
        100,
      consolidationVolumePercent: bestConsolidationVolume,
      inflectionCount: countInflections(bestWindowBars),
    };
  }

  return {
    barsInRange: 0,
    consolidationRangePercent: 0,
    consolidationVolumePercent: 0,
    inflectionCount: 0,
  };
}

/**
 * Detect prior consolidation base (look back 80+ bars for a real base before recent movement)
 * For Type 1 validation: needs a real 12+ day base before the recent breakout
 */
function detectPriorBase(allBars: any[]): PriorBaseResult {
  if (allBars.length < 100)
    return { priorBaseDays: 0, priorBaseRangePercent: 0 };

  // Scan a broader window: up to 80 bars back to capture consolidations
  const maxLookback = Math.min(100, allBars.length - 6);
  const priorWindow = allBars.slice(-maxLookback, -6);
  if (priorWindow.length < 12)
    return { priorBaseDays: 0, priorBaseRangePercent: 0 };

  // Find longest consecutive consolidation (min 12 bars) within 20% band
  let maxBaseBars = 0;
  let bestBaseHigh = 0;
  let bestBaseLow = 0;

  for (let winSize = priorWindow.length; winSize >= 12; winSize--) {
    for (let i = 0; i <= priorWindow.length - winSize; i++) {
      const windowBars = priorWindow.slice(i, i + winSize);
      const high = Math.max(...windowBars.map((b: any) => b.high));
      const low = Math.min(...windowBars.map((b: any) => b.low));
      const rangePercent = ((high - low) / low) * 100;

      if (rangePercent <= 20 && winSize > maxBaseBars) {
        maxBaseBars = winSize;
        bestBaseHigh = high;
        bestBaseLow = low;
      }
    }
    if (maxBaseBars > 0) break;
  }

  if (maxBaseBars >= 12) {
    return {
      priorBaseDays: maxBaseBars,
      priorBaseRangePercent: ((bestBaseHigh - bestBaseLow) / bestBaseLow) * 100,
    };
  }

  return { priorBaseDays: 0, priorBaseRangePercent: 0 };
}

/**
 * Detect prior high-volume breakout in the 60 bars before recent consolidation
 * Used to identify Type 3 (continuation after prior breakout) vs Type 1 (fresh breakout)
 */
function detectPriorBreakout(allBars: any[]): PriorBreakoutResult {
  if (allBars.length < 70) return { priorBreakoutBarsAgo: 0 };

  const priorWindow = allBars.slice(-65, -6);
  if (priorWindow.length < 20) return { priorBreakoutBarsAgo: 0 };

  let mostRecentBreakoutBarsAgo = 0;

  // Scan for high-volume breakout: close > rolling 20-bar high AND volume >= 1.5x rolling avg
  for (let i = 20; i < priorWindow.length; i++) {
    const bar = priorWindow[i];
    const historyBars = priorWindow.slice(Math.max(0, i - 20), i);
    const rollingHigh = Math.max(...historyBars.map((b: any) => b.high));
    const rollingAvgVol =
      historyBars.reduce((sum: number, b: any) => sum + b.volume, 0) /
      historyBars.length;

    if (bar.close > rollingHigh && bar.volume >= rollingAvgVol * 1.5) {
      // Found a prior breakout; record how many bars ago
      mostRecentBreakoutBarsAgo = priorWindow.length - 1 - i;
    }
  }

  return { priorBreakoutBarsAgo: mostRecentBreakoutBarsAgo };
}

async function fetchETFProfile(
  symbol: string,
  apiKey: string,
): Promise<{
  expenseRatio?: number;
  aum?: number;
  category?: string;
  isETF?: boolean;
}> {
  try {
    const etfData = await globalRateLimiter.execute(async () => {
      const res = await axios.get(
        `https://financialmodelingprep.com/stable/etf-info`,
        {
          params: { symbol, apikey: apiKey },
          timeout: 10000,
        },
      );
      return res.data;
    });

    if (etfData && Array.isArray(etfData) && etfData[0]) {
      const profile = etfData[0];
      return {
        expenseRatio: profile.expenseRatio
          ? parseFloat(profile.expenseRatio)
          : undefined,
        aum: profile.aum ? profile.aum : undefined,
        category: profile.etfCategory || profile.category,
        isETF: true,
      };
    }
  } catch {
    // Not an ETF or endpoint failed, try profile endpoint as fallback
  }
  return {};
}

let cachedFedRate: number | null = null;
let fedRateFetchTime = 0;

async function getFedRate(apiKey: string): Promise<number> {
  const now = Date.now();
  if (cachedFedRate !== null && now - fedRateFetchTime < 24 * 60 * 60 * 1000) {
    return cachedFedRate;
  }

  try {
    const data = await globalRateLimiter.execute(async () => {
      const res = await axios.get(
        `https://financialmodelingprep.com/stable/economics-indicators`,
        {
          params: { name: 'FEDFUNDS', apikey: apiKey },
          timeout: 10000,
        },
      );
      return res.data;
    });

    if (data && Array.isArray(data) && data[0]) {
      cachedFedRate = parseFloat(data[0].value) || 5.25;
      fedRateFetchTime = now;
      return cachedFedRate;
    }
  } catch (error) {
    console.warn("Failed to fetch Fed rate, using fallback");
  }
  return 5.25;
}

async function fetchFMPData(symbol: string): Promise<MarketData> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) throw new Error("FMP_API_KEY not set");

  // Delisting already filtered at universe level in agent.ts via filterDelistedStocks
  // Skip per-stock check to avoid rate limit exhaustion

  const cacheKey = `market:${symbol}`;
  const cached = marketDataCache.get<MarketData>(cacheKey);
  if (cached) {
    console.log(`Cache hit for ${symbol}`);
    return cached;
  }

  let retries = 3;
  let lastError: any;

  while (retries > 0) {
    try {
      const data = await globalRateLimiter.execute(async () => {
        const priceResponse = await axios.get(
          `https://financialmodelingprep.com/stable/historical-price-eod/full`,
          {
            params: { symbol, apikey: apiKey, limit: 250 },
            timeout: 10000,
          },
        );
        return priceResponse.data;
      });

      // Response is directly an array, not wrapped in {historical: [...]}
      const historicalData = Array.isArray(data) ? data : data.historical;
      if (!historicalData || historicalData.length === 0) {
        throw new Error(`No data found for ${symbol}`);
      }

      const allBars = historicalData.reverse().map((d: any) => ({
        date: d.date,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
        volume: d.volume,
      }));

      // Skip if latest data is > 5 days old
      const latestDate = new Date(allBars[allBars.length - 1].date);
      const daysSinceLastData = (Date.now() - latestDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceLastData > 5) {
        throw new Error(`[STALE] ${symbol}: last data from ${latestDate.toISOString().split('T')[0]} (${daysSinceLastData.toFixed(1)} days ago)`);
      }

      const closes = allBars.map((b: any) => b.close);
      const ma20 = calculateMA(closes, 20);
      const ma50 = calculateMA(closes, 50);
      const ma150 = calculateMA(closes, 150);
      const ma200 = calculateMA(closes, 200);

      const bars = allBars.slice(-21);
      const latest = bars[bars.length - 1];
      const history = bars.slice(0, 20);

      const highs = history.map((b: any) => b.high);
      const lows = history.map((b: any) => b.low);
      const avgVolume =
        history.reduce((sum: number, b: any) => sum + b.volume, 0) /
        history.length;

      // Calculate barsInRange: count consecutive bars in consolidation before breakout (Type 1)
      const consolidationResult = calculateBarsInRange(allBars);

      // Detect setup consolidation: tight consolidation without breakout (Type 2)
      const setupConsolidationResult = detectSetupConsolidation(allBars);

      // Detect prior base and prior breakout for Type 1 vs Type 3 classification
      const priorBaseResult = detectPriorBase(allBars);
      const priorBreakoutResult = detectPriorBreakout(allBars);

      // Calculate 52-week high from ~250 days of data (~1 trading year)
      const high52w = Math.max(...allBars.map((b: any) => b.high));

      let earningsGrowth = 0;
      let epsGrowthPct: number | undefined;
      let revenueGrowthPct: number | undefined;
      let epsBeat: boolean | undefined;
      let epsSurprisePct: number | undefined;
      let sector: string | undefined;
      let industry: string | undefined;
      let beta: number | undefined;

      try {
        const earningsData = await globalRateLimiter.execute(async () => {
          const earningsRes = await axios.get(
            `https://financialmodelingprep.com/stable/income-statement`,
            {
              params: { symbol, apikey: apiKey, limit: 2 },
              timeout: 10000,
            },
          );
          return earningsRes.data;
        });

        if (earningsData && earningsData.length >= 2) {
          const current = earningsData[0].netIncome || 0;
          const previous = earningsData[1].netIncome || 1;
          earningsGrowth = ((current - previous) / Math.abs(previous)) * 100;
        }
      } catch {
        // earnings optional
      }

      try {
        const qtrEarningsData = await globalRateLimiter.execute(async () => {
          const qtrRes = await axios.get(
            `https://financialmodelingprep.com/stable/income-statement`,
            {
              params: { symbol, period: 'quarter', apikey: apiKey, limit: 5 },
              timeout: 10000,
            },
          );
          return qtrRes.data;
        });

        if (qtrEarningsData && qtrEarningsData.length >= 2) {
          const currentEps = qtrEarningsData[0].eps || 0;
          const previousEps = qtrEarningsData[1].eps || 0.01;
          epsGrowthPct =
            ((currentEps - previousEps) / Math.abs(previousEps)) * 100;

          const currentRev = qtrEarningsData[0].revenue || 0;
          const previousRev = qtrEarningsData[1].revenue || 1;
          revenueGrowthPct =
            ((currentRev - previousRev) / Math.abs(previousRev)) * 100;
        }
      } catch {
        // optional
      }

      // Skip earnings surprises during initial scan - only fetch if high confidence alert detected
      // This reduces API calls by ~15% (only ~5-10 assets per hour need surprises)
      // epsBeat and epsSurprisePct will be fetched later if asset triggers alert

      let assetType: "stock" | "etf" = "stock";
      let expenseRatio: number | undefined;
      let assetUnderManagement: number | undefined;
      let etfCategory: string | undefined;

      // Try to fetch ETF profile first to detect if it's an ETF
      const etfProfile = await fetchETFProfile(symbol, apiKey);
      if (
        etfProfile.isETF ||
        etfProfile.aum !== undefined ||
        etfProfile.expenseRatio !== undefined
      ) {
        assetType = "etf";
        expenseRatio = etfProfile.expenseRatio;
        assetUnderManagement = etfProfile.aum;
        etfCategory = etfProfile.category;
      }

      // ETF sector mapping (cached, no API call needed)
      const etfSectorMap: Record<string, { sector: string; industry: string }> =
        {
          // Semiconductor/Chip ETFs
          SOX: { sector: "Semiconductors", industry: "Semiconductor Equipment & Materials" },
          XSD: { sector: "Semiconductors", industry: "Semiconductor Equipment & Materials" },
          SOXL: { sector: "Semiconductors", industry: "Semiconductor Equipment & Materials" },
          QQQ: { sector: "Technology", industry: "Software & Tech Services" },
          XLK: { sector: "Technology", industry: "Software & Tech Services" },
          XSLV: { sector: "Technology", industry: "Software & Tech Services" },
          CIBR: { sector: "Technology", industry: "Software & Tech Services" },
          SOXX: { sector: "Semiconductors", industry: "Semiconductor Equipment & Materials" },
          XLV: { sector: "Healthcare", industry: "Healthcare Services" },
          XLY: { sector: "Consumer Cyclical", industry: "Consumer Services" },
          XLE: { sector: "Energy", industry: "Oil & Gas" },
          XLI: { sector: "Industrials", industry: "Industrial Services" },
          XLF: { sector: "Financial Services", industry: "Financial" },
          XLRE: { sector: "Real Estate", industry: "Real Estate" },
          XLP: { sector: "Consumer Defensive", industry: "Consumer Staples" },
          XLU: { sector: "Utilities", industry: "Utilities" },
          SPY: { sector: "Broad Market", industry: "S&P 500" },
          IVV: { sector: "Broad Market", industry: "S&P 500" },
          VOO: { sector: "Broad Market", industry: "S&P 500" },
          VTI: { sector: "Broad Market", industry: "US Total Market" },
          SPTM: { sector: "Broad Market", industry: "US Total Market" },
          THRO: { sector: "Broad Market", industry: "US Total Market" },
          DXJ: { sector: "International Equity", industry: "Japan" },
          HEWJ: { sector: "International Equity", industry: "Japan" },
          EWJ: { sector: "International Equity", industry: "Japan" },
          JPXN: { sector: "International Equity", industry: "Japan" },
          SCHJ: { sector: "International Equity", industry: "Japan" },
          PSUS: { sector: "Alternative Strategies", industry: "Holding Company" },
          FPAC: { sector: "Alternative Strategies", industry: "SPAC" },
        };

      if (assetType === "etf" && etfSectorMap[symbol]) {
        sector = etfSectorMap[symbol].sector;
        industry = etfSectorMap[symbol].industry;
      } else {
        // Single /profile/ call for stocks: fetch ETF type + sector/industry in one request
        try {
          const profileData = await globalRateLimiter.execute(async () => {
            const profileRes = await axios.get(
              `https://financialmodelingprep.com/stable/profile`,
              {
                params: { symbol, apikey: apiKey },
                timeout: 10000,
              },
            );
            return profileRes.data;
          });

          if (profileData && profileData.length > 0) {
            const profile = profileData[0];
            // Detect ETF from profile if not already detected
            if (!assetType || assetType === "stock") {
              if (profile.isEtf || profile.type === "etf") {
                assetType = "etf";
              }
            }
            // Extract sector/industry (use cached map if ETF)
            if (assetType === "etf" && etfSectorMap[symbol]) {
              sector = etfSectorMap[symbol].sector;
              industry = etfSectorMap[symbol].industry;
            } else {
              sector = profile.sector;
              industry = profile.industry;
            }
            beta = profile.beta;
            // Handle null sector
            if (!sector) {
              console.warn(`⚠️ ${symbol}: FMP profile returned null sector (${profile.companyName || symbol})`);
              sector = 'Unclassified';
              industry = industry || 'Unclassified';
            }
          } else {
            console.warn(`⚠️ ${symbol}: FMP profile returned empty data`);
            sector = 'Unclassified';
            industry = 'Unclassified';
          }
        } catch (err: any) {
          console.warn(`⚠️ ${symbol}: FMP profile fetch failed: ${err?.message || err}`);
          sector = 'Unclassified';
          industry = 'Unclassified';
        }
      }

      // Ensure sector/industry are never undefined
      if (!sector) sector = 'Unclassified';
      if (!industry) industry = 'Unclassified';

      const fedFundsRate = await getFedRate(apiKey);

      const result: MarketData = {
        asset: symbol,
        assetType,
        open: latest.open,
        high: latest.high,
        low: latest.low,
        close: latest.close,
        volume: latest.volume,
        avgVolume,
        timestamp: new Date(),
        highs,
        lows,
        ma20,
        ma50,
        ma150,
        ma200,
        barsInRange: consolidationResult.barsInRange,
        consolidationRangePercent:
          consolidationResult.consolidationRangePercent,
        consolidationVolumePercent:
          consolidationResult.consolidationVolumePercent,
        setupBarsInRange: setupConsolidationResult.barsInRange,
        setupConsolidationRangePercent:
          setupConsolidationResult.consolidationRangePercent,
        setupConsolidationVolumePercent:
          setupConsolidationResult.consolidationVolumePercent,
        setupInflectionCount:
          setupConsolidationResult.inflectionCount,
        high52w,
        earningsGrowth,
        epsGrowthPct,
        revenueGrowthPct,
        epsBeat,
        epsSurprisePct,
        sector,
        industry,
        beta,
        fedFundsRate,
        expenseRatio,
        assetUnderManagement,
        etfCategory,
        priorBaseDays: priorBaseResult.priorBaseDays,
        priorBaseRangePercent: priorBaseResult.priorBaseRangePercent,
        priorBreakoutBarsAgo: priorBreakoutResult.priorBreakoutBarsAgo,
      };

      marketDataCache.set(cacheKey, result);
      return result;
    } catch (error: any) {
      lastError = error;
      if (error.response?.status === 429) {
        retries--;
        if (retries > 0) {
          const delay = Math.pow(2, 3 - retries) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
      }
      break;
    }
  }

  console.error(
    `Failed to fetch FMP data for ${symbol} after retries:`,
    lastError,
  );
  throw lastError;
}

