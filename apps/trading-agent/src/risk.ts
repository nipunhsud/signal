// Pure sizing and gating math. No I/O so it can be unit-tested directly.

export interface SizingInput {
  equity: number;
  cash: number;
  price: number;
  stopPrice: number;
  riskPerTradePct: number;
  maxPositionPct: number;
}

export interface Sizing {
  qty: number;
  positionValue: number;
  riskAmount: number;
  maxPositionSize: number;
  binding: "risk" | "position-cap" | "cash";
}

export type SizingResult =
  | { ok: true; sizing: Sizing }
  | { ok: false; reason: string };

export function sizePosition(i: SizingInput): SizingResult {
  if (!(i.price > 0)) return { ok: false, reason: `bad price ${i.price}` };
  if (!(i.stopPrice > 0) || i.stopPrice >= i.price) {
    return {
      ok: false,
      reason: `stop ${i.stopPrice} must sit below price ${i.price}`,
    };
  }
  const perShareRisk = i.price - i.stopPrice;
  const riskBudget = (i.equity * i.riskPerTradePct) / 100;
  const maxPositionSize = (i.equity * i.maxPositionPct) / 100;

  const byRisk = Math.floor(riskBudget / perShareRisk);
  const byCap = Math.floor(maxPositionSize / i.price);
  const byCash = Math.floor(i.cash / i.price);

  const qty = Math.min(byRisk, byCap, byCash);
  if (qty < 1) {
    const limiter =
      byCash < 1 ? "cash" : byCap < 1 ? "position cap" : "risk budget";
    return {
      ok: false,
      reason: `cannot size 1 share at $${i.price.toFixed(2)} (${limiter}: risk $${riskBudget.toFixed(0)}, cap $${maxPositionSize.toFixed(0)}, cash $${i.cash.toFixed(0)})`,
    };
  }
  const binding =
    qty === byRisk ? "risk" : qty === byCap ? "position-cap" : "cash";
  return {
    ok: true,
    sizing: {
      qty,
      positionValue: qty * i.price,
      riskAmount: qty * perShareRisk,
      maxPositionSize,
      binding,
    },
  };
}

/** True when today's equity has fallen past the daily-loss cap. */
export function dailyLossBreached(
  dayStartEquity: number,
  equity: number,
  maxDailyLossPct: number,
): boolean {
  if (!(dayStartEquity > 0)) return false;
  return equity <= dayStartEquity * (1 - maxDailyLossPct / 100);
}

export type EntryZone = "below-pivot" | "fresh" | "extended";

/** Where the live price sits relative to the base pivot the signal broke. */
export function entryZone(
  price: number,
  pivot: number,
  maxPctAbovePivot: number,
): EntryZone {
  if (price < pivot) return "below-pivot";
  const pct = ((price - pivot) / pivot) * 100;
  return pct > maxPctAbovePivot ? "extended" : "fresh";
}

export function isUsSymbol(asset: string): boolean {
  return !/\.(NS|BO)$/i.test(asset);
}
