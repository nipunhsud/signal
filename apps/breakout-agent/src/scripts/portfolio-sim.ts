// Portfolio simulation over the exit-rule study: replay the historical signal
// stream day by day with a fixed number of slots, risk-based sizing and the
// real refill constraint, and compare equity curves per exit rule. Answers
// "which rule makes the book grow" rather than "which rule flatters the
// average trade" (docs/exit-rules-study.md).
//
// Inputs (written by backtest-exits.js): study-cache/exit-trades.json and
// study-cache/paths-<rule>.{f32,u32} — each trade's daily mark-to-market
// (return on the position after each bar, last element = final return).
//
// Usage: node dist/scripts/portfolio-sim.js [--slots 5] [--risk 1] [--cap 20] [--from 1990]
//   env: STUDY_CACHE_DIR (default ./study-cache)
import * as fs from "fs";

const CACHE = process.env.STUDY_CACHE_DIR || "./study-cache";
const STOP = 0.07;
const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? parseFloat(process.argv[i + 1]) : fallback;
};
const SLOTS = arg("slots", 5);
const RISK_PCT = arg("risk", 1);
const CAP_PCT = arg("cap", 20);
const FROM_YEAR = arg("from", 1990);
const SEEDS = arg("seeds", 1); // >1: average over random within-day orderings
const NO_GRADE = process.argv.includes("--nograde"); // ignore grade priority when filling slots
const REGIME = arg("regime", 0); // 50 | 200: enter only while S&P 500 closes above that SMA
const REGIME_EXIT = process.argv.includes("--regime-exit"); // also flatten everything while below
const HEALTH = arg("health", 0); // enter only while the replayed market-health score >= this
const HEALTH_EXIT = arg("health-exit", 0); // flatten everything while the score < this
// Circuit breakers ("stop trading when it isn't working"):
const DD_HALT = arg("dd-halt", 0); // % drawdown from the book's peak that stops new entries
const DD_RESUME = arg("dd-resume", 0); // resume entries once drawdown shrinks below this (default: half of dd-halt)
const DD_FLATTEN = process.argv.includes("--dd-flatten"); // also flatten everything at the halt level
const EQ_MA = arg("eq-ma", 0); // trade only while equity is above its own N-day SMA
const STREAK = arg("streak", 0); // after N consecutive losing closes, pause new entries…
const PAUSE = arg("pause", 20); // …for this many trading days
const SCALE_DD = arg("scale-dd", 0);
// Downside caps proposed for the rotation book:
const STREAK_BUDGET = arg("streak-budget", 0); // % of equity: consecutive losses spend it; next trade risks what is left; a win resets it
const HEAT = arg("heat", 0); // % of equity: total open risk-to-stop may not exceed this
const PERIOD_LOSS = arg("period-loss", 0); // % of equity: realized losses over the last `period` days beyond this block entries
const PERIOD = arg("period", 20); // risk per trade scales linearly to zero at this % drawdown
const COST_BPS = arg("cost", 0);
// Replacement rotation: when slots are full and a new candidate arrives, swap
// out the weakest laggard (held >= swap-after bars, unrealized < swap-below %).
const SWAP_AFTER = arg("swap-after", 0);
const SWAP_BELOW = arg("swap-below", 5); // transaction cost per side, basis points of notional (slippage + commission)
const RS_MIN = arg("rs", 0); // 0-100: enter only when the trade's 6-month RS percentile >= this
const RANK_RS = process.argv.includes("--rank-rs"); // fill slots by RS instead of grade
const SHOW_YEARS = process.argv.includes("--years"); // print per-year returns + best rolling 12 months
const FILTERS = [COST_BPS ? `cost ${COST_BPS}bp/side` : null, STREAK_BUDGET ? `streak budget ${STREAK_BUDGET}%` : null, HEAT ? `heat cap ${HEAT}%` : null, PERIOD_LOSS ? `period loss cap ${PERIOD_LOSS}%/${PERIOD}d` : null, SWAP_AFTER ? `swap laggards after ${SWAP_AFTER}b below +${SWAP_BELOW}%` : null, REGIME ? `S&P>${REGIME}MA${REGIME_EXIT ? " (exit too)" : ""}` : null, DD_HALT ? `dd-halt ${DD_HALT}%${DD_FLATTEN ? " flatten" : ""}` : null, EQ_MA ? `eq>MA${EQ_MA}` : null, STREAK ? `streak ${STREAK}/${PAUSE}d` : null, SCALE_DD ? `scale-dd ${SCALE_DD}%` : null, HEALTH ? `health>=${HEALTH}` : null, HEALTH_EXIT ? `exit<${HEALTH_EXIT}` : null, RS_MIN ? `RS>=${RS_MIN}` : null, RANK_RS ? "rank by RS" : null].filter(Boolean).join(" · ");
const onlyIdx = process.argv.indexOf("--only"); // substring filter on rule names, comma-separated
const ONLY = onlyIdx > -1 ? process.argv[onlyIdx + 1].split(",").map((x) => x.trim()) : null;


// Small seeded PRNG (mulberry32) for reproducible tie-breaks.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Trade { sym: string; date: string; year: number; grade: string; rs: number | null; out: Record<string, { ret: number; bars: number; reason: string }> }

const trades: Trade[] = JSON.parse(fs.readFileSync(`${CACHE}/exit-trades.json`, "utf8"));
console.log(`${trades.length} trades loaded · slots ${SLOTS} · risk ${RISK_PCT}%/trade · cap ${CAP_PCT}%/position · from ${FROM_YEAR}`);

const slug = (name: string) => name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
function loadPaths(name: string): { data: Float32Array; offsets: Uint32Array } {
  const f = fs.readFileSync(`${CACHE}/paths-${slug(name)}.f32`);
  const o = fs.readFileSync(`${CACHE}/paths-${slug(name)}.u32`);
  return {
    data: new Float32Array(f.buffer, f.byteOffset, f.byteLength / 4),
    offsets: new Uint32Array(o.buffer, o.byteOffset, o.byteLength / 4),
  };
}

// A rule maps each trade to a path (start offset, length) — "adopted" picks
// per grade, which is what the trader actually runs.
type PathPicker = (t: Trade, idx: number) => { data: Float32Array; start: number; len: number };
const RULES: Record<string, () => PathPicker> = {
  "fixed21 · 7% stop": () => single("fixed21 · 7% stop"),
  "stop · close<MA50": () => single("stop · close<MA50"),
  "stop · trail 20%": () => single("stop · trail 20%"),
  "half +20% · rest MA50": () => single("half +20% · rest MA50"),
  "Brandt 3d-low trail after +20%": () => single("Brandt 3d-low trail after +20%"),
  "stop · trail 15%": () => single("stop · trail 15%"),
  "stop · trail 25%": () => single("stop · trail 25%"),
  "stop · trail 30%": () => single("stop · trail 30%"),
  "trail 20% · 63-bar cap (90d)": () => single("trail 20% · 63-bar cap (90d)"),
  "stop · close<MA20": () => single("stop · close<MA20"),
  "fixed10 · 7% stop": () => single("fixed10 · 7% stop"),
  "fixed42 · 7% stop": () => single("fixed42 · 7% stop"),
  "stop · trail 10%": () => single("stop · trail 10%"),
  "stall 10 · 7% stop": () => single("stall 10 · 7% stop"),
  "stall 15 · 7% stop": () => single("stall 15 · 7% stop"),
  "stall 20 · 7% stop": () => single("stall 20 · 7% stop"),
  "stall 15 after +10%": () => single("stall 15 after +10%"),
  "stall 15 + trail 20%": () => single("stall 15 + trail 20%"),
  "stall 10 + trail 15%": () => single("stall 10 + trail 15%"),
  "trail 20% · 126-bar cap (180d)": () => single("trail 20% · 126-bar cap (180d)"),
  "MA50 on A+/A, trail 20% on S": () => {
    const ma = loadPaths("stop · close<MA50");
    const tr = loadPaths("stop · trail 20%");
    return (t, i) => {
      const p = t.grade === "S" ? tr : ma;
      return { data: p.data, start: p.offsets[i], len: p.offsets[i + 1] - p.offsets[i] };
    };
  },
};
function single(name: string): PathPicker {
  const p = loadPaths(name);
  return (_t, i) => ({ data: p.data, start: p.offsets[i], len: p.offsets[i + 1] - p.offsets[i] });
}

// S&P 500 regime: close vs SMA(n) on each calendar date, from the cached
// Yahoo series (fetched once into study-cache/^GSPC.json by fetch-spx).
const spxAbove = new Map<string, boolean>();
if (REGIME > 0) {
  const f = `${CACHE}/^GSPC.json`;
  if (!fs.existsSync(f)) throw new Error(`${f} missing — run: node dist/scripts/fetch-spx.js`);
  const raw: number[][] = JSON.parse(fs.readFileSync(f, "utf8"));
  let sum = 0;
  for (let i = 0; i < raw.length; i++) {
    sum += raw[i][4];
    if (i >= REGIME) sum -= raw[i - REGIME][4];
    const d = new Date(raw[i][0] * 1000).toISOString().slice(0, 10);
    spxAbove.set(d, i >= REGIME - 1 && raw[i][4] > sum / REGIME);
  }
}
let lastRegime = true;
function regimeOn(date: string): boolean {
  if (REGIME <= 0) return true;
  const v = spxAbove.get(date);
  if (v != null) lastRegime = v;
  return lastRegime;
}
// Replayed dashboard market-health score (build-market-health.js).
const healthByDate = new Map<string, number>();
if (HEALTH > 0 || HEALTH_EXIT > 0) {
  const f = `${CACHE}/market-health.json`;
  if (!fs.existsSync(f)) throw new Error(`${f} missing — run: node dist/scripts/build-market-health.js`);
  for (const r of JSON.parse(fs.readFileSync(f, "utf8")) as number[][]) {
    const d = String(r[0]);
    healthByDate.set(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, r[1]);
  }
}
let lastHealth = 100;
function healthOn(date: string): { enter: boolean; exit: boolean } {
  const v = healthByDate.get(date);
  if (v != null) lastHealth = v;
  return { enter: HEALTH <= 0 || lastHealth >= HEALTH, exit: HEALTH_EXIT > 0 && lastHealth < HEALTH_EXIT };
}

// Global trading calendar = every date on which some breakout fired (dense
// enough after 1990 to stand in for the exchange calendar).
const dates = [...new Set(trades.map((t) => t.date))].sort();
const dateIdx = new Map(dates.map((d, i) => [d, i]));
const byDate = new Map<number, number[]>();
const GRADE_RANK: Record<string, number> = { S: 0, "A+": 1, A: 2 };
trades.forEach((t, i) => {
  const d = dateIdx.get(t.date)!;
  if (!byDate.has(d)) byDate.set(d, []);
  byDate.get(d)!.push(i);
});
function orderDays(seed: number) {
  const r = rng(seed);
  for (const list of byDate.values()) {
    const key = new Map(list.map((i) => [i, r()]));
    list.sort((a, b) =>
      (RANK_RS ? (trades[b].rs ?? 0) - (trades[a].rs ?? 0) : 0) ||
      (NO_GRADE ? 0 : GRADE_RANK[trades[a].grade] - GRADE_RANK[trades[b].grade]) ||
      key.get(a)! - key.get(b)!);
  }
}

interface Position { tradeIdx: number; notional: number; data: Float32Array; start: number; len: number; day: number }

interface Result {
  name: string; cagr: number; maxDD: number; vol: number; sharpe: number; trades: number;
  tradesPerYear: number; exposure: number; final: number; years: number; worstYear: number; bestYear: number;
  byDecade: Record<string, number>; best12m: number; worst12m: number; yearly: Array<[number, number]>;
  badYears: number; haltedShare: number;
}

function simulate(name: string, pick: PathPicker): Result {
  const startIdx = dates.findIndex((d) => +d.slice(0, 4) >= FROM_YEAR);
  let cash = 1;
  const positions: Position[] = [];
  const equityCurve: number[] = [];
  let nTrades = 0;
  let exposureDays = 0;
  const yearEquity = new Map<number, number>();
  let peak = 1;
  let ddHalted = false;
  let lossStreak = 0;
  let pausedUntil = -1;
  let haltedDays = 0;
  let streakLossPct = 0; // realized loss (% of equity) in the current losing streak
  let budgetSpentAt = -1; // day the streak budget ran out; refills after PAUSE days
  const closedLog: Array<{ day: number; pnl: number }> = []; // realized pnl per close, for the rolling cap

  for (let d = startIdx; d < dates.length; d++) {
    // 1. advance open positions one trading day; close those whose path ended
    for (let k = positions.length - 1; k >= 0; k--) {
      const p = positions[k];
      p.day++;
      if (p.day >= p.len) {
        const ret = p.data[p.start + p.len - 1];
        const proceeds = p.notional * (1 + ret) * (1 - COST_BPS / 10000);
        cash += proceeds;
        positions.splice(k, 1);
        const pnl = proceeds - p.notional;
        closedLog.push({ day: d, pnl });
        if (ret < 0) {
          if (++lossStreak >= STREAK && STREAK > 0) pausedUntil = d + PAUSE;
          streakLossPct += (-pnl / Math.max(cash, 1e-9)) * 100;
        } else { lossStreak = 0; streakLossPct = 0; }
      }
    }
    // 2. equity mark (open positions at today's path value)
    let equity = cash;
    for (const p of positions) equity += p.notional * (1 + p.data[p.start + p.day]);
    peak = Math.max(peak, equity);
    const dd = (peak - equity) / peak * 100;
    if (DD_HALT > 0) {
      if (!ddHalted && dd >= DD_HALT) ddHalted = true;
      else if (ddHalted && dd <= (DD_RESUME > 0 ? DD_RESUME : DD_HALT / 2)) ddHalted = false;
    }
    const eqMaOk = EQ_MA <= 0 || equityCurve.length < EQ_MA ||
      equity > equityCurve.slice(-EQ_MA).reduce((a, b) => a + b, 0) / EQ_MA;
    let periodOk = true;
    if (PERIOD_LOSS > 0) {
      let lost = 0;
      for (let q = closedLog.length - 1; q >= 0 && closedLog[q].day > d - PERIOD; q--) if (closedLog[q].pnl < 0) lost += -closedLog[q].pnl;
      periodOk = (lost / equity) * 100 < PERIOD_LOSS;
    }
    const breakersOk = !ddHalted && eqMaOk && d >= pausedUntil && periodOk;
    if (!breakersOk) haltedDays++;
    const h = healthOn(dates[d]);
    const on = regimeOn(dates[d]) && h.enter && breakersOk;
    if (((!regimeOn(dates[d]) && REGIME_EXIT) || h.exit || (DD_FLATTEN && ddHalted)) && positions.length) {
      // risk-off: flatten at today's mark
      for (const p of positions) cash += p.notional * (1 + p.data[p.start + Math.max(0, p.day)]) * (1 - COST_BPS / 10000);
      positions.length = 0;
      equity = cash;
    }
    // 3. fill free slots from today's signals, best grade first
    const todays = on ? byDate.get(d) || [] : [];
    let swaps = 0;
    for (const ti of todays) {
      const t = trades[ti];
      if (RS_MIN > 0 && (t.rs ?? -1) < RS_MIN) continue;
      if (positions.length >= SLOTS) {
        if (SWAP_AFTER <= 0 || swaps >= 2) break;
        // find the weakest eligible laggard
        let worst = -1, worstRet = Infinity;
        for (let k = 0; k < positions.length; k++) {
          const p = positions[k];
          if (p.day < SWAP_AFTER) continue;
          const r = p.data[p.start + Math.max(0, p.day)];
          if (r * 100 < SWAP_BELOW && r < worstRet) { worst = k; worstRet = r; }
        }
        if (worst < 0) break;
        const p = positions[worst];
        cash += p.notional * (1 + worstRet) * (1 - COST_BPS / 10000);
        positions.splice(worst, 1);
        swaps++;
      }
      if (positions.some((p) => trades[p.tradeIdx].sym === t.sym)) continue;
      const path = pick(t, ti);
      if (path.len === 0) continue;
      let riskPct = SCALE_DD > 0 ? RISK_PCT * Math.max(0, 1 - dd / SCALE_DD) : RISK_PCT;
      if (STREAK_BUDGET > 0) {
        if (budgetSpentAt >= 0 && d >= budgetSpentAt + PAUSE) { streakLossPct = 0; budgetSpentAt = -1; }
        riskPct = Math.min(riskPct, Math.max(0, STREAK_BUDGET - streakLossPct));
        if (riskPct < 0.25 && budgetSpentAt < 0) budgetSpentAt = d;
      }
      if (HEAT > 0) {
        const openRisk = positions.reduce((a, p) => a + p.notional * STOP, 0);
        riskPct = Math.min(riskPct, Math.max(0, HEAT - (openRisk / equity) * 100));
      }
      if (riskPct < 0.25) { haltedDays += 0; continue; }
      const notional = Math.min((equity * riskPct) / 100 / STOP, (equity * CAP_PCT) / 100, cash);
      if (notional <= 0 || notional < equity * 0.01) continue;
      cash -= notional * (1 + COST_BPS / 10000);
      positions.push({ tradeIdx: ti, notional, data: path.data, start: path.start, len: path.len, day: -1 });
      nTrades++;
    }
    // Positions entered today are marked at entry (day -1 → 0 ret), equity unchanged.
    equityCurve.push(equity);
    if (positions.length) exposureDays++;
    yearEquity.set(+dates[d].slice(0, 4), equity);
  }
  // liquidate whatever is open at the end
  let finalEq = cash;
  for (const p of positions) finalEq += p.notional * (1 + p.data[p.start + Math.max(0, p.day)]) * (1 - COST_BPS / 10000);
  equityCurve.push(finalEq);

  const n = equityCurve.length;
  const years = (n - 1) / 252;
  const cagr = Math.pow(finalEq, 1 / years) - 1;
  let ddPeak = -Infinity, maxDD = 0;
  for (const e of equityCurve) { ddPeak = Math.max(ddPeak, e); maxDD = Math.max(maxDD, (ddPeak - e) / ddPeak); }
  const rets: number[] = [];
  for (let i = 1; i < n; i++) rets.push(equityCurve[i] / equityCurve[i - 1] - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const vol = Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / rets.length) * Math.sqrt(252);
  const sharpe = vol > 0 ? (mean * 252) / vol : 0;

  const yrs = [...yearEquity.keys()].sort();
  const yearly: Array<[number, number]> = [];
  for (let i = 1; i < yrs.length; i++) yearly.push([yrs[i], yearEquity.get(yrs[i])! / yearEquity.get(yrs[i - 1])! - 1]);
  const byDecade: Record<string, number> = {};
  for (let dec = Math.floor(FROM_YEAR / 10) * 10; dec <= 2020; dec += 10) {
    const a = yearEquity.get(dec - 1) ?? yearEquity.get(dec) ?? null;
    const b = yearEquity.get(Math.min(dec + 9, yrs[yrs.length - 1])) ?? null;
    if (a && b && dec + 9 >= FROM_YEAR) {
      const span = Math.min(dec + 9, yrs[yrs.length - 1]) - Math.max(dec - 1, FROM_YEAR - 1);
      byDecade[`${dec}s`] = Math.pow(b / a, 1 / Math.max(1, span)) - 1;
    }
  }
  let best12m = -Infinity, worst12m = Infinity;
  for (let i = 252; i < n; i++) {
    const r = equityCurve[i] / equityCurve[i - 252] - 1;
    if (r > best12m) best12m = r;
    if (r < worst12m) worst12m = r;
  }
  return {
    name, cagr, maxDD, vol, sharpe, trades: nTrades, tradesPerYear: nTrades / years, exposure: exposureDays / (n - 1),
    final: finalEq, years, worstYear: Math.min(...yearly.map((y) => y[1])), bestYear: Math.max(...yearly.map((y) => y[1])), byDecade,
    best12m, worst12m, yearly,
    badYears: yearly.filter((y) => y[1] < -0.10).length, haltedShare: haltedDays / (n - 1),
  };
}

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const pickers = Object.entries(RULES)
  .filter(([name]) => !ONLY || ONLY.some((o) => name.includes(o)))
  .filter(([name]) => fs.existsSync(`${CACHE}/paths-${slug(name.includes("ADOPTED") ? "stop · close<MA50" : name)}.f32`))
  .map(([name, mk]) => [name, mk()] as const);
let results: Result[] = [];
if (SEEDS <= 1) {
  orderDays(1);
  results = pickers.map(([name, pick]) => simulate(name, pick));
} else {
  const runs: Result[][] = [];
  for (let sd = 1; sd <= SEEDS; sd++) {
    orderDays(sd);
    runs.push(pickers.map(([name, pick]) => simulate(name, pick)));
  }
  console.log(`\n=== ${SEEDS} orderings${NO_GRADE ? " (grade priority OFF)" : ""} · ${SLOTS} slots · ${RISK_PCT}% risk · ${FROM_YEAR}–${FILTERS ? " · " + FILTERS : ""} ===`);
  console.log("rule".padEnd(32) + "CAGR mean".padStart(11) + "min".padStart(8) + "max".padStart(8) + "maxDD mean".padStart(12) + "worst".padStart(8) + "Sharpe".padStart(8) + "trades/yr".padStart(11) + "worst yr".padStart(10) + "yrs<-10%".padStart(10) + "halted".padStart(8));
  pickers.forEach(([name], i) => {
    const rs = runs.map((r) => r[i]);
    const m = (f: (x: Result) => number) => rs.reduce((a, x) => a + f(x), 0) / rs.length;
    console.log(
      name.padEnd(32) + pct(m((x) => x.cagr)).padStart(11) + pct(Math.min(...rs.map((x) => x.cagr))).padStart(8) + pct(Math.max(...rs.map((x) => x.cagr))).padStart(8) +
      pct(m((x) => x.maxDD)).padStart(12) + pct(Math.max(...rs.map((x) => x.maxDD))).padStart(8) + m((x) => x.sharpe).toFixed(2).padStart(8) + m((x) => x.tradesPerYear).toFixed(0).padStart(11) +
      pct(m((x) => x.worstYear)).padStart(10) + m((x) => x.badYears).toFixed(1).padStart(10) + pct(m((x) => x.haltedShare), 0).padStart(8),
    );
  });
  process.exit(0);
}
console.log(`\n=== ${SLOTS}-slot book, ${RISK_PCT}% risk/trade (7% stop → ${(RISK_PCT / STOP).toFixed(1)}% of equity per position, cap ${CAP_PCT}%), ${FROM_YEAR}–${dates[dates.length - 1].slice(0, 4)} ===`);
console.log("rule".padEnd(32) + "CAGR".padStart(8) + "maxDD".padStart(8) + "vol".padStart(7) + "Sharpe".padStart(8) + "trades/yr".padStart(11) + "in mkt".padStart(8) + "worst yr".padStart(10) + "best yr".padStart(9) + "  growth of $1");
for (const r of results) {
  console.log(
    r.name.padEnd(32) + pct(r.cagr).padStart(8) + pct(r.maxDD).padStart(8) + pct(r.vol, 0).padStart(7) + r.sharpe.toFixed(2).padStart(8) +
    r.tradesPerYear.toFixed(0).padStart(11) + pct(r.exposure, 0).padStart(8) + pct(r.worstYear).padStart(10) + pct(r.bestYear).padStart(9) + `  $${r.final.toFixed(0)}`,
  );
}
if (SHOW_YEARS) {
  for (const r of results) {
    console.log(`\n${r.name}: best rolling 12m ${pct(r.best12m)} · worst rolling 12m ${pct(r.worst12m)}`);
    console.log(r.yearly.map(([y, v]) => `${y} ${pct(v, 0)}`).join("  "));
  }
}
console.log("\nCAGR by decade:");
const decades = Object.keys(results[0].byDecade);
console.log("rule".padEnd(32) + decades.map((d) => d.padStart(8)).join(""));
for (const r of results) console.log(r.name.padEnd(32) + decades.map((d) => pct(r.byDecade[d] ?? 0).padStart(8)).join(""));
