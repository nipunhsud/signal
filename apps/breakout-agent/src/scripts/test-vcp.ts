import { analyzeBreakout } from "../tools/breakout-logic.js";
import type { MarketData } from "../tools/market-data.js";

// VCP classification sanity tests. No network, no DB — pure synthetic bars.
//   node dist/scripts/test-vcp.js
// Exits non-zero on any failure, so it can gate a deploy.

// A clean Type1 breakout: tight base, MA stack, 1.5x volume, closes near high
const base: MarketData = {
  asset: "TEST",
  assetType: "stock",
  open: 100,
  high: 106,
  low: 99.8,
  close: 105.5, // top third of 99.8–106 range
  volume: 1_500_000,
  avgVolume: 1_000_000,
  timestamp: new Date(),
  highs: Array(20).fill(101), // Donchian resistance 101 → high 106 breaches
  lows: Array(20).fill(98),
  ma20: 100,
  ma50: 98,
  ma150: 95,
  ma200: 92,
  barsInRange: 6,
  consolidationRangePercent: 4,
  consolidationVolumePercent: 70,
  cleanConsolidation: true,
  priorBaseDays: 20,
  priorBaseRangePercent: 12,
  priorBreakoutBarsAgo: 0,
  extensionPriorBreakoutBarsAgo: 0,
  // VCP metrics: tight, contracting, expanding
  atrPercent: 1.8,
  contractionRatio: 0.6,
  expansionRatio: 2.1,
};

const check = (
  name: string,
  md: MarketData,
  expectType: string,
  expectVcp: boolean,
) => {
  const a = analyzeBreakout(md);
  const ok = a.breakoutType === expectType && a.isVcp === expectVcp;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}: type=${a.breakoutType} isVcp=${a.isVcp} (expected ${expectType}/${expectVcp})`,
  );
  if (!ok) process.exitCode = 1;
};

check("Type1 with full VCP", base, "Type1", true);
check("Type1, base too wide (ATR% 4)", { ...base, atrPercent: 4 }, "Type1", false);
check(
  "Type1, not contracting (ratio 0.9)",
  { ...base, contractionRatio: 0.9 },
  "Type1",
  false,
);
check(
  "Type1, weak expansion (1.1x)",
  { ...base, expansionRatio: 1.1 },
  "Type1",
  false,
);
check(
  "Type1, closes mid-bar",
  { ...base, close: 103, high: 106, low: 99.8 },
  "Type1",
  false,
);
check(
  "Type1, no history (metrics 0)",
  { ...base, atrPercent: 0, contractionRatio: 0, expansionRatio: 0 },
  "Type1",
  false,
);
check(
  "Type3 never VCP",
  {
    ...base,
    extensionPriorBreakoutBarsAgo: 3,
    priorBaseDays: 2,
    priorBaseRangePercent: 40,
  },
  "Type3",
  false,
);
