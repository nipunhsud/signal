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
  // Earnings
  earningsGrowth?: number; // YoY earnings growth %
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

      let earningsGrowth = 0;
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
        earningsGrowth,
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
