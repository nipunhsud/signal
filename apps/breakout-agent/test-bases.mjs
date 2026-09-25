// Base segmentation sanity tests. Pure synthetic bars, no network.
//   node test-bases.mjs
// Exits non-zero on failure so it can gate a deploy.
import { detectBases, reclaimAfterFailedBreakout } from "./base-detect.js";

const bars = [];
let d = new Date("2026-01-05");
const push = (o, h, l, c, v) => {
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  bars.push({ time: d.toISOString().slice(0, 10), open: o, high: h, low: l, close: c, volume: v });
  d.setDate(d.getDate() + 1);
};

// Uptrend → 20-bar base ~10% deep on drying volume → breakout on 3x → run →
// forming base at the right edge.
for (let i = 0; i < 15; i++) push(90 + i, 91 + i, 89 + i, 90.5 + i, 1e6);
for (let i = 0; i < 20; i++) push(100, 104, 95 + (i % 3), 100 + (i % 2), 6e5);
push(103, 108, 102, 107, 2e6);
for (let i = 0; i < 6; i++) push(107 + i * 0.5, 108 + i * 0.5, 106 + i * 0.5, 107.5 + i * 0.5, 1e6);
for (let i = 0; i < 12; i++) push(110, 110.5, 108, 109.5, 5e5);

const bases = detectBases(bars);
let failed = 0;
const check = (name, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}`);
  if (!cond) failed = 1;
};

check("finds two bases", bases.length === 2);
const [b1, b2] = bases;
check("first base resolves as breakout", b1?.status === "breakout");
check("first base ~20 bars", b1?.bars === 20);
check("first base depth ~9-10%", b1?.depthPct > 8 && b1?.depthPct < 11);
check("breakout volume ratio >1.5x", (b1?.breakout?.volumeRatio ?? 0) > 1.5);
check("breakout run positive", (b1?.breakout?.runPct ?? -1) > 0);
check("base volume dried up (<1)", b1?.volumeDryUp > 0 && b1?.volumeDryUp < 1);
check("last base is forming", b2?.status === "forming" && b2?.breakout === null);
check("forming only at right edge", bases.filter((b) => b.status === "forming").length <= 1 && (bases.at(-1)?.status === "forming" || !bases.some((b) => b.status === "forming")));
check("chronological order", !b1 || !b2 || b1.end < b2.start);
check("blue sky on ascending series", b2?.isBlueSky === true);

// Degenerate inputs must not throw
check("empty input → []", detectBases([]).length === 0);
check("tiny input → []", detectBases(bars.slice(0, 5)).length === 0);

// Reclaim (CRWD Sep 2026 shape): base breaks out, closes >7% under its pivot,
// then closes back above the failed move's high after a quiet pullback.
{
  const rb = [];
  let t = new Date("2026-01-05");
  const p = (h, l, c, v) => {
    while (t.getDay() === 0 || t.getDay() === 6) t.setDate(t.getDate() + 1);
    rb.push({ time: t.toISOString().slice(0, 10), open: c, high: h, low: l, close: c, volume: v });
    t.setDate(t.getDate() + 1);
  };
  for (let i = 0; i < 60; i++) p(51 + i * 0.8, 49 + i * 0.8, 50 + i * 0.8, 1e6); // uptrend to ~$98
  for (let i = 0; i < 15; i++) p(100, 92, 95, 8e5); // base under $100
  p(106, 99, 105, 3e6); // breakout
  p(110, 104, 108, 2e6); // failed move's high $110
  p(104, 90, 91, 2e6); // closes > 7% under $100
  const quiet = (v) => { for (let i = 0; i < 6; i++) p(96, 92, 94, v); };
  const withVol = (v) => { const b = rb.slice(); quiet(v); p(113, 100, 112, 3e6); const r = reclaimAfterFailedBreakout(rb, detectBases(rb)); rb.length = 0; rb.push(...b); return r; };
  const dry = withVol(4e5);
  check("reclaim fires on dry-up at the failed move's high", dry?.pivot === 110);
  check("reclaim depth measured from that high", dry?.depthPct > 17 && dry?.depthPct < 19);
  check("no reclaim on heavy pullback volume", withVol(2e6) === null);
}

process.exit(failed);
