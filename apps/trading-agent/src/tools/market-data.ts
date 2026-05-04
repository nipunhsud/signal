import { IBClient } from './ib-client.js';

export interface MarketData {
  asset: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  avgVolume: number;
  timestamp: Date;
  highs: number[];
  lows: number[];
}

export async function fetchIBMarketData(symbol: string, client: IBClient): Promise<MarketData> {
  const conid = await client.resolveConid(symbol);
  const rawBars = await client.getHistoricalBars(conid);

  if (rawBars.length < 2) {
    throw new Error(`Insufficient bar data for ${symbol}: got ${rawBars.length} bars`);
  }

  const bars = rawBars.slice(-21);
  const latest = bars[bars.length - 1];
  const history = bars.slice(0, 20);

  return {
    asset: symbol,
    open: latest.o,
    high: latest.h,
    low: latest.l,
    close: latest.c,
    volume: latest.v,
    avgVolume: history.reduce((s, b) => s + b.v, 0) / history.length,
    timestamp: new Date(latest.t),
    highs: history.map((b) => b.h),
    lows: history.map((b) => b.l),
  };
}
