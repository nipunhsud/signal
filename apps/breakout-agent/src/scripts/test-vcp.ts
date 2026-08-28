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
  // VCP metrics (recalibrated def): moderate coil + 2x breakout volume
  atrPercent: 1.8,
  contractionRatio: 0.6,
  expansionRatio: 2.1,
  coilRatio: 0.8,
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

// New VCP definition (2,074-base study): coil 0.7-0.9 + volume >= 2x avg.
// Base fixture: volume 1.5M vs avg 1M = 1.5x -> fails volume gate by default.
check("Type1, 1.5x volume fails new VCP gate", base, "Type1", false);
check("Type1 full VCP (coil 0.8, 2.5x vol)", { ...base, volume: 2_500_000 }, "Type1", true);
check("Type1, coil too loose (0.95)", { ...base, volume: 2_500_000, coilRatio: 0.95 }, "Type1", false);
check("Type1, coil too tight (0.6 - deal-pinned tape)", { ...base, volume: 2_500_000, coilRatio: 0.6 }, "Type1", false);
check("Type1, no history (coil 0)", { ...base, volume: 2_500_000, coilRatio: 0 }, "Type1", false);
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

// Base-quality metrics: blue-sky flag + pass-throughs
const bq = (name: string, md: MarketData, expect: (a: ReturnType<typeof analyzeBreakout>) => boolean) => {
  const a = analyzeBreakout(md);
  const ok = expect(a);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) process.exitCode = 1;
};

// resistance = max(highs) = 101; blue sky when 52wH is within 2% above it
bq("blue sky when pivot at 52w high", { ...base, high52w: 102 }, (a) => a.isBlueSky === true);
bq("not blue sky with 10% overhead", { ...base, high52w: 112 }, (a) => a.isBlueSky === false);
bq("not blue sky without 52w data", { ...base, high52w: 0 }, (a) => a.isBlueSky === false);
bq(
  "base-quality metrics pass through",
  { ...base, upDownVolumeRatio: 2.3, failedPokes: 2, coilRatio: 0.8 },
  (a) => a.upDownVolumeRatio === 2.3 && a.failedPokes === 2 && a.coilRatio === 0.8,
);

// Cohort grading (full-history factor grid)
const co = (name: string, md: MarketData, expect: string | null) => {
  const a = analyzeBreakout(md);
  const ok = a.cohort === expect;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: cohort=${a.cohort} (expected ${expect})`);
  if (!ok) process.exitCode = 1;
};
// base fixture: priorBaseDays 20 (short), vol 1.5x, high52w 0 (no sky) -> C
co("Type1 short/quiet/buried -> C", base, "C");
co("blue sky alone -> A", { ...base, high52w: 102 }, "A");
co("sky + long + loud -> S", { ...base, high52w: 102, priorBaseDays: 90, volume: 2_500_000 }, "S");
co("long + loud, no sky -> B", { ...base, priorBaseDays: 90, volume: 2_500_000 }, "B");
co("Type3 has no cohort", { ...base, extensionPriorBreakoutBarsAgo: 3, priorBaseDays: 2, priorBaseRangePercent: 40 }, null);
