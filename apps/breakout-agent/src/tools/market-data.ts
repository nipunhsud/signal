import axios from 'axios';
import https from 'https';
import { globalRateLimiter } from './rate-limiter.js';
import { marketDataCache } from './cache.js';

const ibAgent = new https.Agent({ rejectUnauthorized: false });

function calculateMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1];
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export interface MarketData {
  asset: string;
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
  // Consolidation (bars in range before breakout)
  barsInRange?: number;
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
}

/**
 * Fetch market data from Binance (crypto), Alpaca (stocks), or IB Client Portal API
 */
export async function fetchMarketData(
  asset: string,
  source: 'binance' | 'alpaca' | 'ibkr' | 'fmp' = 'binance',
  ibkrBaseUrl?: string
): Promise<MarketData> {
  if (source === 'binance') {
    return fetchBinanceData(asset);
  } else if (source === 'alpaca') {
    return fetchAlpacaData(asset);
  } else if (source === 'fmp') {
    return fetchFMPData(asset);
  } else {
    return fetchIBKRData(asset, ibkrBaseUrl || 'https://localhost:5000');
  }
}

async function fetchBinanceData(symbol: string): Promise<MarketData> {
  try {
    // Fetch 1h candles (last 21 for 20-period analysis + current)
    const response = await axios.get(
      `https://api.binance.com/api/v3/klines`,
      {
        params: {
          symbol: symbol.includes('USDT') ? symbol : `${symbol}USDT`,
          interval: '1h',
          limit: 21,
        },
      }
    );

    const candles = response.data.map((k: any[]) => ({
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[7]),
    }));

    const latest = candles[candles.length - 1];
    const highs = candles.slice(0, 20).map((c: any) => c.high);
    const lows = candles.slice(0, 20).map((c: any) => c.low);
    const avgVolume =
      candles.slice(0, 20).reduce((sum: number, c: any) => sum + c.volume, 0) / 20;

    return {
      asset: symbol,
      open: latest.open,
      high: latest.high,
      low: latest.low,
      close: latest.close,
      volume: latest.volume,
      avgVolume,
      timestamp: new Date(),
      highs,
      lows,
      ma20: latest.close,
      ma50: latest.close,
      ma150: latest.close,
      ma200: latest.close,
    };
  } catch (error) {
    console.error(`Failed to fetch Binance data for ${symbol}:`, error);
    throw error;
  }
}

async function fetchAlpacaData(symbol: string): Promise<MarketData> {
  const apiKey = process.env.ALPACA_API_KEY;
  const baseUrl = process.env.ALPACA_BASE_URL || 'https://data.alpaca.markets';

  try {
    const response = await axios.get(`${baseUrl}/v2/stocks/${symbol}/bars`, {
      params: {
        timeframe: '1h',
        limit: 21,
        sort: 'desc',
      },
      headers: {
        'APCA-API-KEY-ID': apiKey,
      },
    });

    const candles = response.data.bars
      .reverse()
      .map((b: any) => ({
        open: b.o,
        high: b.h,
        low: b.l,
        close: b.c,
        volume: b.v,
      }));

    const latest = candles[candles.length - 1];
    const highs = candles.slice(0, 20).map((c: any) => c.high);
    const lows = candles.slice(0, 20).map((c: any) => c.low);
    const avgVolume =
      candles.slice(0, 20).reduce((sum: number, c: any) => sum + c.volume, 0) / 20;

    return {
      asset: symbol,
      open: latest.open,
      high: latest.high,
      low: latest.low,
      close: latest.close,
      volume: latest.volume,
      avgVolume,
      timestamp: new Date(),
      highs,
      lows,
      ma20: latest.close,
      ma50: latest.close,
      ma150: latest.close,
      ma200: latest.close,
    };
  } catch (error) {
    console.error(`Failed to fetch Alpaca data for ${symbol}:`, error);
    throw error;
  }
}

function calculateBarsInRange(allBars: any[]): number {
  if (allBars.length < 6) return 0;

  // Look at the last 30 bars max to find consolidation
  const lookback = Math.min(30, allBars.length);
  const recentBars = allBars.slice(-lookback);

  if (recentBars.length < 2) return 0;

  // Find the consolidation range: look for the tightest range in recent bars
  // Strategy: count consecutive bars that stay within a tight range
  // Start from the earliest bar and find a consolidation zone

  let maxConsecutiveInRange = 0;

  // Try different starting points to find the longest consolidation
  for (let startIdx = 0; startIdx < recentBars.length - 1; startIdx++) {
    // Define range from this bar onwards
    const rangeHigh = Math.max(...recentBars.slice(startIdx).map((b: any) => b.high));
    const rangeLow = Math.min(...recentBars.slice(startIdx).map((b: any) => b.low));

    // Count consecutive bars within this range working backwards
    let consecutiveInRange = 0;
    for (let i = startIdx; i < recentBars.length; i++) {
      const bar = recentBars[i];
      // Bar is in range if high <= rangeHigh AND low >= rangeLow
      if (bar.high <= rangeHigh && bar.low >= rangeLow) {
        consecutiveInRange++;
      } else {
        // First bar outside range ends the consolidation count
        break;
      }
    }

    // Track the longest consolidation found
    if (consecutiveInRange >= 5) {
      maxConsecutiveInRange = Math.max(maxConsecutiveInRange, consecutiveInRange);
    }
  }

  return maxConsecutiveInRange;
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
        `https://financialmodelingprep.com/api/v4/economic?name=FEDFUNDS`,
        {
          params: { apikey: apiKey },
          timeout: 10000,
        }
      );
      return res.data;
    });

    if (data && Array.isArray(data) && data[0]) {
      cachedFedRate = parseFloat(data[0].value) || 5.25;
      fedRateFetchTime = now;
      return cachedFedRate;
    }
  } catch (error) {
    console.warn('Failed to fetch Fed rate, using fallback');
  }
  return 5.25;
}

async function fetchFMPData(symbol: string): Promise<MarketData> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) throw new Error('FMP_API_KEY not set');

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
          `https://financialmodelingprep.com/api/v3/historical-price-full/${symbol}`,
          {
            params: { apikey: apiKey, limit: 250 },
            timeout: 10000,
          }
        );
        return priceResponse.data;
      });

      const historicalData = data.historical;
      if (!historicalData || historicalData.length === 0) {
        throw new Error(`No data found for ${symbol}`);
      }

      const allBars = historicalData
        .reverse()
        .map((d: any) => ({
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
          volume: d.volume,
        }));

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
      const avgVolume = history.reduce((sum: number, b: any) => sum + b.volume, 0) / history.length;

      // Calculate barsInRange: count consecutive bars in consolidation before breakout
      const barsInRange = calculateBarsInRange(allBars);

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
            `https://financialmodelingprep.com/api/v3/income-statement/${symbol}`,
            {
              params: { apikey: apiKey, limit: 2 },
              timeout: 10000,
            }
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
            `https://financialmodelingprep.com/api/v3/income-statement/${symbol}?period=quarter`,
            {
              params: { apikey: apiKey, limit: 5 },
              timeout: 10000,
            }
          );
          return qtrRes.data;
        });

        if (qtrEarningsData && qtrEarningsData.length >= 2) {
          const currentEps = qtrEarningsData[0].eps || 0;
          const previousEps = qtrEarningsData[1].eps || 0.01;
          epsGrowthPct = ((currentEps - previousEps) / Math.abs(previousEps)) * 100;

          const currentRev = qtrEarningsData[0].revenue || 0;
          const previousRev = qtrEarningsData[1].revenue || 1;
          revenueGrowthPct = ((currentRev - previousRev) / Math.abs(previousRev)) * 100;
        }
      } catch {
        // optional
      }

      try {
        const surpriseData = await globalRateLimiter.execute(async () => {
          const surpriseRes = await axios.get(
            `https://financialmodelingprep.com/api/v3/earnings-surprises/${symbol}`,
            {
              params: { apikey: apiKey, limit: 1 },
              timeout: 10000,
            }
          );
          return surpriseRes.data;
        });

        if (surpriseData && surpriseData.length > 0) {
          const actual = surpriseData[0].actualEarningResult || 0;
          const estimated = surpriseData[0].estimatedEarning || 0.01;
          epsBeat = actual > estimated;
          epsSurprisePct = ((actual - estimated) / Math.abs(estimated)) * 100;
        }
      } catch {
        // optional
      }

      try {
        const profileData = await globalRateLimiter.execute(async () => {
          const profileRes = await axios.get(
            `https://financialmodelingprep.com/api/v3/profile/${symbol}`,
            {
              params: { apikey: apiKey },
              timeout: 10000,
            }
          );
          return profileRes.data;
        });

        if (profileData && profileData.length > 0) {
          sector = profileData[0].sector;
          industry = profileData[0].industry;
          beta = profileData[0].beta;
        }
      } catch {
        // optional
      }

      const fedFundsRate = await getFedRate(apiKey);

      const result: MarketData = {
        asset: symbol,
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
        barsInRange,
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
      };

      marketDataCache.set(cacheKey, result);
      return result;
    } catch (error: any) {
      lastError = error;
      if (error.response?.status === 429) {
        retries--;
        if (retries > 0) {
          const delay = Math.pow(2, 3 - retries) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }
      break;
    }
  }

  console.error(`Failed to fetch FMP data for ${symbol} after retries:`, lastError);
  throw lastError;
}

async function fetchIBKRData(symbol: string, baseUrl: string): Promise<MarketData> {
  try {
    const config = {
      timeout: 10000,
      ...(baseUrl.startsWith('https') && { httpsAgent: ibAgent }),
    };

    // Step 1: resolve symbol → conid
    const searchResp = await axios.get(`${baseUrl}/v1/api/iserver/secdef/search`, {
      ...config,
      params: { symbol, secType: 'STK', name: false },
    });

    const contracts = searchResp.data as Array<{ conid: string; companyName: string }>;
    if (!contracts.length) throw new Error(`No contracts found for ${symbol}`);
    const conid = contracts[0].conid;

    // Step 2: fetch historical bars (5d of 1h bars gives ~32 bars on trading days)
    const histResp = await axios.get(`${baseUrl}/v1/api/iserver/marketdata/history`, {
      ...config,
      params: { conid, period: '5d', bar: '1h', outsideRth: false },
    });

    const rawBars = (histResp.data.data || []) as Array<{
      t: number;
      o: number;
      h: number;
      l: number;
      c: number;
      v: number;
    }>;

    if (rawBars.length < 2) throw new Error(`Insufficient bar data for ${symbol}`);

    // Take last 21 bars (current + 20 history)
    const bars = rawBars.slice(-21);
    const latest = bars[bars.length - 1];
    const history = bars.slice(0, 20);

    const highs = history.map((b) => b.h);
    const lows = history.map((b) => b.l);
    const avgVolume = history.reduce((sum, b) => sum + b.v, 0) / history.length;

    return {
      asset: symbol,
      open: latest.o,
      high: latest.h,
      low: latest.l,
      close: latest.c,
      volume: latest.v,
      avgVolume,
      timestamp: new Date(latest.t),
      highs,
      lows,
      ma20: latest.c,
      ma50: latest.c,
      ma150: latest.c,
      ma200: latest.c,
    };
  } catch (error) {
    console.error(`Failed to fetch IBKR data for ${symbol}:`, error);
    throw error;
  }
}
