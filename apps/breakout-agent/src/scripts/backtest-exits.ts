// Exit-rule study for graded base breakouts (S / A+ / A, above the 200MA,
// liquid). The base-grade study settled the ENTRY (close above a blue-sky
// pivot). This settles the EXIT: fixed horizons vs. moving-average breaks vs.
// trailing stops vs. partial profit-taking at +20%, all on the same 7% hard
// stop the live trader uses. Same data path as validate-base-grades.ts:
// Yahoo max-range bars (split-adjusted), cached on disk as compact arrays.
//
// Usage: node dist/scripts/backtest-exits.js [--limit N] [--list path]
//   env: STUDY_CACHE_DIR (default ./study-cache)
// @ts-ignore — plain-JS module at the app root, shared with the dashboard
import { detectBases } from "../../base-detect.js";
import * as fs from "fs";

const CACHE = process.env.STUDY_CACHE_DIR || "./study-cache";
const MIN_AVG_VOL = 100_000;
const CONC = 6;
const STOP = 0.07;
const MAX_HOLD = 250; // bars; open-ended rules are capped here
const LIST = "../../scripts/scanner-lists/combined-nasdaq-nyse-sp500.txt";

interface Bar { time: string; open: number; high: number; low: number; close: number; volume: number }

async function fetchJson(url: string, opts: any = {}, tries = 4): Promise<any> {
  for (let a = 0; a < tries; a++) {
    try {
      const res = await fetch(url, opts);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (a === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 2000 * (a + 1) + Math.random() * 1500));
    }
  }
}

async function yahooMaxBars(symbol: string): Promise<Bar[]> {
  const cacheFile = `${CACHE}/${symbol}.json`;
  const inflate = (a: number[][]) =>
    a.map((r) => ({ time: new Date(r[0] * 1000).toISOString().slice(0, 10), open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }));
  if (fs.existsSync(cacheFile)) return inflate(JSON.parse(fs.readFileSync(cacheFile, "utf8")));
  const j = await fetchJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=0&period2=9999999999&interval=1d`,
    { headers: { "User-Agent": "Mozilla/5.0" } }, 3);
  const r = j?.chart?.result?.[0];
  const ts = r?.timestamp, q = r?.indicators?.quote?.[0];
  const adj = r?.indicators?.adjclose?.[0]?.adjclose;
  const compact: number[][] = [];
  if (ts && q) {
    for (let i = 0; i < ts.length; i++) {
      const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
      if (o == null || h == null || l == null || c == null || c <= 0) continue;
      const f = adj && adj[i] != null && adj[i] > 0 ? adj[i] / c : 1;
      compact.push([ts[i], o * f, h * f, l * f, c * f, (q.volume[i] ?? 0) / f]);
    }
  }
  fs.writeFileSync(cacheFile, JSON.stringify(compact)); // empty array caches a miss too
  return inflate(compact);
}

// ---------- strategies ----------

interface Ctx {
  bars: Bar[];
  i: number; // entry bar index (entry = close)
  entry: number;
  ma20: Float64Array;
  ma50: Float64Array;
}

interface Outcome { ret: number; bars: number; reason: string; path?: number[] }

type Rule = (c: Ctx) => Outcome;

// Walks forward from entry applying, in priority order per bar:
//   1. gap/stop on the low (hard stop, trailing stop, breakeven stop)
//   2. profit target on the high (limit fill)
//   3. close-based signals (MA break, 8-week logic) → filled at NEXT open
//   4. time cap
// `partial` = fraction sold at `target`; the remainder follows the rest.
function simulate(c: Ctx, p: {
  horizon?: number; ma?: 20 | 50; trail?: number; target?: number; partial?: number;
  breakevenAfterPartial?: boolean; maAfterBars?: number; oneil?: boolean;
  // Peter Brandt's N-day trailing stop: stop under the lowest low of the prior
  // N sessions, ratcheted daily, never lowered. `lowTrailAfter` = gain from
  // entry (fraction) the peak must reach before it arms (0 = from entry);
  // `lowTrailOnClose` = trigger on a close below the level (exit next open)
  // instead of an intrabar touch.
  lowTrail?: number; lowTrailAfter?: number; lowTrailOnClose?: boolean;
  wantPath?: boolean; // record the position's mark-to-market after each bar (for the portfolio sim)
  stall?: number; // momentum stall: exit at next open after N bars without a new closing high
  stallAfter?: number; // only arm the stall once the trade is up this fraction (0 = from entry)
}): Outcome {
  const { bars, i, entry } = c;
  const maArr = p.ma === 20 ? c.ma20 : c.ma50;
  let stop = entry * (1 - STOP);
  let peak = entry;
  let remaining = 1;
  let realized = 0; // return contribution already banked (fraction × ret)
  let pendingExitAtOpen: string | null = null;
  let maArmedFrom = i + 1 + (p.maAfterBars ?? 0);
  let hitTargetFast = false;
  let lowTrailArmed = p.lowTrail != null && !(p.lowTrailAfter && p.lowTrailAfter > 0);
  let highClose = entry, highCloseBar = i;
  const last = Math.min(bars.length - 1, i + (p.horizon ?? MAX_HOLD));

  const path: number[] | undefined = p.wantPath ? [] : undefined;
  const finish = (price: number, k: number, reason: string): Outcome => {
    const ret = realized + remaining * ((price - entry) / entry);
    if (path) { path.length = Math.max(0, k - i - 1); path.push(ret); }
    return { ret, bars: k - i, reason, path };
  };

  for (let k = i + 1; k <= last; k++) {
    const b = bars[k];
    if (pendingExitAtOpen) return finish(b.open, k, pendingExitAtOpen);

    // 1. stops (on the low; gap-through fills at the open)
    if (p.trail) stop = Math.max(stop, peak * (1 - p.trail));
    if (p.lowTrail && lowTrailArmed && k - p.lowTrail >= i) {
      let lo = Infinity;
      for (let j = k - p.lowTrail; j < k; j++) lo = Math.min(lo, bars[j].low);
      if (p.lowTrailOnClose) {
        if (b.close < lo && b.close > stop) pendingExitAtOpen = `${p.lowTrail}d-low`;
      } else {
        stop = Math.max(stop, lo);
      }
    }
    if (b.low <= stop) {
      const reason = stop >= entry ? (p.trail || p.lowTrail ? "trail" : "breakeven") : "stop";
      return finish(Math.min(stop, b.open), k, reason);
    }
    peak = Math.max(peak, b.high);
    if (p.lowTrail && !lowTrailArmed && peak >= entry * (1 + (p.lowTrailAfter ?? 0))) lowTrailArmed = true;

    // 2. profit target (limit; gap-up fills at the open)
    if (p.target && remaining === 1 && b.high >= entry * (1 + p.target)) {
      const fill = Math.max(entry * (1 + p.target), b.open);
      const fastWindow = k - i <= 15;
      if (p.oneil && fastWindow) {
        // O'Neil 8-week rule: +20% inside 3 weeks → do not sell into it, hold ≥ 8 weeks
        hitTargetFast = true;
        maArmedFrom = Math.max(maArmedFrom, i + 40);
      } else if (p.partial && p.partial < 1) {
        realized += p.partial * ((fill - entry) / entry);
        remaining -= p.partial;
        if (p.breakevenAfterPartial) stop = Math.max(stop, entry);
      } else {
        return finish(fill, k, "target");
      }
    }
    // Once the fast +20% is on the books, a later target touch no longer sells;
    // the position is managed by the MA / trail rules only.
    if (p.oneil && hitTargetFast && p.target) p = { ...p, target: undefined };

    // 3. close-based signals → next open
    if (p.ma && k >= maArmedFrom && maArr[k] > 0 && b.close < maArr[k]) pendingExitAtOpen = `ma${p.ma}`;
    if (b.close > highClose) { highClose = b.close; highCloseBar = k; }
    if (p.stall && k - highCloseBar >= p.stall && (!p.stallAfter || highClose >= entry * (1 + p.stallAfter))) pendingExitAtOpen = `stall${p.stall}`;
    if (path) path.push(realized + remaining * ((b.close - entry) / entry));
  }
  const k = last;
  if (pendingExitAtOpen) return finish(bars[k].close, k, pendingExitAtOpen);
  return finish(bars[k].close, k, p.horizon ? "time" : "cap");
}

const STRATEGIES: Record<string, Rule> = {
  "fixed10 · 7% stop":            (c) => simulate(c, { horizon: 10 }),
  "fixed21 · 7% stop":            (c) => simulate(c, { horizon: 21 }),
  "fixed42 · 7% stop":            (c) => simulate(c, { horizon: 42 }),
  "fixed63 · 7% stop":            (c) => simulate(c, { horizon: 63 }),
  "fixed126 · 7% stop":           (c) => simulate(c, { horizon: 126 }),
  "stop · close<MA20":            (c) => simulate(c, { ma: 20 }),
  "stop · close<MA50":            (c) => simulate(c, { ma: 50 }),
  "stop · trail 10%":             (c) => simulate(c, { trail: 0.10 }),
  "stop · trail 15%":             (c) => simulate(c, { trail: 0.15 }),
  "stop · trail 20%":             (c) => simulate(c, { trail: 0.20 }),
  "stop · trail 25%":             (c) => simulate(c, { trail: 0.25 }),
  "trail 20% · 63-bar cap (90d)": (c) => simulate(c, { trail: 0.20, horizon: 63 }),
  "trail 20% · 126-bar cap (180d)": (c) => simulate(c, { trail: 0.20, horizon: 126 }),
  "trail 20% · 189-bar cap (270d)": (c) => simulate(c, { trail: 0.20, horizon: 189 }),
  "stop · trail 30%":             (c) => simulate(c, { trail: 0.30 }),
  "stop · trail15 + MA50":        (c) => simulate(c, { trail: 0.15, ma: 50 }),
  "all out +20% · else MA50":     (c) => simulate(c, { target: 0.20, ma: 50 }),
  "all out +25% · else MA50":     (c) => simulate(c, { target: 0.25, ma: 50 }),
  "half +20% · rest MA50":        (c) => simulate(c, { target: 0.20, partial: 0.5, ma: 50 }),
  "half +20% · BE stop · MA50":   (c) => simulate(c, { target: 0.20, partial: 0.5, breakevenAfterPartial: true, ma: 50 }),
  "half +20% · rest trail 15%":   (c) => simulate(c, { target: 0.20, partial: 0.5, trail: 0.15 }),
  "half +20% · BE · trail 15%":   (c) => simulate(c, { target: 0.20, partial: 0.5, breakevenAfterPartial: true, trail: 0.15 }),
  "third +20% · rest trail15+MA50": (c) => simulate(c, { target: 0.20, partial: 1 / 3, trail: 0.15, ma: 50 }),
  "O'Neil: +20% tgt / 8wk / MA50": (c) => simulate(c, { target: 0.20, ma: 50, oneil: true }),
  "O'Neil + trail 15%":           (c) => simulate(c, { target: 0.20, ma: 50, oneil: true, trail: 0.15 }),
  "stall 10 · 7% stop":           (c) => simulate(c, { stall: 10 }),
  "stall 15 · 7% stop":           (c) => simulate(c, { stall: 15 }),
  "stall 20 · 7% stop":           (c) => simulate(c, { stall: 20 }),
  "stall 15 after +10%":          (c) => simulate(c, { stall: 15, stallAfter: 0.10 }),
  "stall 15 + trail 20%":         (c) => simulate(c, { stall: 15, trail: 0.20 }),
  "stall 10 + trail 15%":         (c) => simulate(c, { stall: 10, trail: 0.15 }),
  "Brandt 3d-low trail from entry": (c) => simulate(c, { lowTrail: 3 }),
  "Brandt 3d-low trail after +10%": (c) => simulate(c, { lowTrail: 3, lowTrailAfter: 0.10 }),
  "Brandt 3d-low trail after +20%": (c) => simulate(c, { lowTrail: 3, lowTrailAfter: 0.20 }),
  "Brandt 3d-low, close-based":     (c) => simulate(c, { lowTrail: 3, lowTrailOnClose: true }),
  "MA50 + Brandt 3d after +20%":    (c) => simulate(c, { ma: 50, lowTrail: 3, lowTrailAfter: 0.20 }),
  "MA50 + Brandt 3d after +10%":    (c) => simulate(c, { ma: 50, lowTrail: 3, lowTrailAfter: 0.10 }),
};

// Rules whose daily paths feed portfolio-sim.ts. "adopted" is what the trader
// runs: MA50 for A+/A, 20% trail for S — assembled in the sim from these two.
const PATH_STRATEGIES: Record<string, Rule> = {
  "fixed10 · 7% stop":            (c) => simulate(c, { horizon: 10, wantPath: true }),
  "fixed21 · 7% stop":            (c) => simulate(c, { horizon: 21, wantPath: true }),
  "fixed42 · 7% stop":            (c) => simulate(c, { horizon: 42, wantPath: true }),
  "stop · close<MA50":            (c) => simulate(c, { ma: 50, wantPath: true }),
  "stop · trail 15%":             (c) => simulate(c, { trail: 0.15, wantPath: true }),
  "stop · trail 20%":             (c) => simulate(c, { trail: 0.20, wantPath: true }),
  "stop · trail 25%":             (c) => simulate(c, { trail: 0.25, wantPath: true }),
  "stop · close<MA20":            (c) => simulate(c, { ma: 20, wantPath: true }),
  "stop · trail 10%":             (c) => simulate(c, { trail: 0.10, wantPath: true }),
  "stall 10 · 7% stop":           (c) => simulate(c, { stall: 10, wantPath: true }),
  "stall 15 · 7% stop":           (c) => simulate(c, { stall: 15, wantPath: true }),
  "stall 20 · 7% stop":           (c) => simulate(c, { stall: 20, wantPath: true }),
  "stall 15 after +10%":          (c) => simulate(c, { stall: 15, stallAfter: 0.10, wantPath: true }),
  "stall 15 + trail 20%":         (c) => simulate(c, { stall: 15, trail: 0.20, wantPath: true }),
  "stall 10 + trail 15%":         (c) => simulate(c, { stall: 10, trail: 0.15, wantPath: true }),
  "trail 20% · 63-bar cap (90d)": (c) => simulate(c, { trail: 0.20, horizon: 63, wantPath: true }),
  "trail 20% · 126-bar cap (180d)": (c) => simulate(c, { trail: 0.20, horizon: 126, wantPath: true }),
  "stop · trail 30%":             (c) => simulate(c, { trail: 0.30, wantPath: true }),
  "half +20% · rest MA50":        (c) => simulate(c, { target: 0.20, partial: 0.5, ma: 50, wantPath: true }),
  "Brandt 3d-low trail after +20%": (c) => simulate(c, { lowTrail: 3, lowTrailAfter: 0.20, wantPath: true }),
};

// ---------- data pass ----------

interface Trade { sym: string; date: string; year: number; grade: string; ret126: number | null; rs: number | null; out: Record<string, Outcome>; paths?: Record<string, number[]> }

// Universe cross-section of trailing-126-bar returns, sampled at the first bar
// of each month, so each trade's relative strength can be ranked against every
// symbol (not just that day's breakouts) — the scanner's rsRating, replayed.
const universeRet126 = new Map<string, number[]>();

function smaSeries(bars: Bar[], n: number): Float64Array {
  const out = new Float64Array(bars.length);
  let s = 0;
  for (let i = 0; i < bars.length; i++) {
    s += bars[i].close;
    if (i >= n) s -= bars[i - n].close;
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}

function gradeOf(sky: boolean, bars: number, depth: number, above200: boolean): string | null {
  if (!sky || !above200 || depth > 25) return null;
  if (depth <= 15 && bars >= 80) return "S";
  if (depth <= 15 && bars >= 25) return "A+";
  return "A";
}

async function processSymbol(sym: string, trades: Trade[]) {
  const bars = await yahooMaxBars(sym);
  if (bars.length < 300) return;
  const ma20 = smaSeries(bars, 20), ma50 = smaSeries(bars, 50), ma200 = smaSeries(bars, 200);
  const idxByDate = new Map<string, number>();
  for (let i = 0; i < bars.length; i++) idxByDate.set(bars[i].time, i);
  let lastMonth = "";
  for (let i = 126; i < bars.length; i++) {
    const ym = bars[i].time.slice(0, 7);
    if (ym === lastMonth) continue;
    lastMonth = ym;
    const r = bars[i].close / bars[i - 126].close - 1;
    if (!universeRet126.has(ym)) universeRet126.set(ym, []);
    universeRet126.get(ym)!.push(r);
  }
  for (const base of detectBases(bars) as any[]) {
    if (!base.breakout) continue;
    const pIdx = idxByDate.get(base.pivotDate);
    const i = idxByDate.get(base.breakout.date);
    if (pIdx == null || i == null || i < 200 || i + 63 >= bars.length) continue;
    let av = 0;
    for (let k = i - 20; k < i; k++) av += bars[k].volume;
    if (av / 20 < MIN_AVG_VOL) continue;
    const pivot = bars[pIdx].high;
    let skyHigh = 0;
    for (let k = Math.max(0, pIdx - 251); k <= pIdx; k++) skyHigh = Math.max(skyHigh, bars[k].high);
    const grade = gradeOf(pivot >= skyHigh * 0.98, base.bars, base.depthPct, bars[i].close > ma200[i]);
    if (!grade) continue;
    const ctx: Ctx = { bars, i, entry: bars[i].close, ma20, ma50 };
    const out: Record<string, Outcome> = {};
    for (const [name, rule] of Object.entries(STRATEGIES)) out[name] = rule(ctx);
    const paths: Record<string, number[]> = {};
    for (const [name, rule] of Object.entries(PATH_STRATEGIES)) paths[name] = rule(ctx).path!;
    const ret126 = i >= 126 ? bars[i].close / bars[i - 126].close - 1 : null;
    trades.push({ sym, date: bars[i].time, year: +bars[i].time.slice(0, 4), grade, ret126, rs: null, out, paths });
  }
}

// ---------- reporting ----------

function stats(ts: Trade[], name: string) {
  const o = ts.map((t) => t.out[name]);
  const n = o.length;
  const rets = o.map((x) => x.ret);
  const mean = rets.reduce((a, b) => a + b, 0) / n;
  const sorted = [...rets].sort((a, b) => a - b);
  const med = sorted[Math.floor(n / 2)];
  const sd = Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / n);
  const wins = rets.filter((r) => r > 0);
  const losses = rets.filter((r) => r <= 0);
  const pf = losses.length ? wins.reduce((a, b) => a + b, 0) / Math.abs(losses.reduce((a, b) => a + b, 0)) : Infinity;
  const bars = o.reduce((a, x) => a + x.bars, 0) / n;
  const stopped = o.filter((x) => x.reason === "stop").length / n;
  const reasons: Record<string, number> = {};
  for (const x of o) reasons[x.reason] = (reasons[x.reason] || 0) + 1;
  return { n, mean, med, sd, win: wins.length / n, pf, bars, stopped, perMonth: (mean / bars) * 21, reasons };
}

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;

function table(ts: Trade[], title: string) {
  console.log(`\n=== ${title} (n=${ts.length}) ===`);
  console.log(
    "strategy".padEnd(34) + "win".padStart(7) + "mean".padStart(8) + "median".padStart(8) + "PF".padStart(6) +
    "bars".padStart(6) + "%/mo".padStart(7) + "stop".padStart(7) + "  exits",
  );
  const rows = Object.keys(STRATEGIES).map((name) => ({ name, s: stats(ts, name) }));
  for (const { name, s } of rows) {
    const ex = Object.entries(s.reasons).sort((a, b) => b[1] - a[1]).map(([r, c]) => `${r} ${Math.round((c / s.n) * 100)}%`).join(", ");
    console.log(
      name.padEnd(34) + pct(s.win).padStart(7) + pct(s.mean, 2).padStart(8) + pct(s.med, 2).padStart(8) +
      (s.pf === Infinity ? "∞" : s.pf.toFixed(2)).padStart(6) + s.bars.toFixed(0).padStart(6) +
      pct(s.perMonth, 2).padStart(7) + pct(s.stopped).padStart(7) + "  " + ex,
    );
  }
}

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg > -1 ? parseInt(process.argv[limitArg + 1]) : Infinity;
  const listArg = process.argv.indexOf("--list");
  const listPath = listArg > -1 ? process.argv[listArg + 1] : LIST;
  const raw = fs.readFileSync(listPath, "utf8").split(/[,\s]+/).map((s) => s.trim().replace(/^[A-Z]+:/, "")).filter(Boolean);
  // Drop warrants / rights / units (5-letter W/R/U suffix) and non-plain tickers.
  const syms = [...new Set(raw)].filter((s) => /^[A-Z]{1,5}$/.test(s) && !(s.length === 5 && /[WRU]$/.test(s))).slice(0, limit);
  console.log(`universe: ${syms.length} symbols, cache: ${CACHE}`);

  const trades: Trade[] = [];
  const errs: string[] = [];
  let done = 0;
  const queue = [...syms];
  const t0 = Date.now();
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (queue.length) {
      const sym = queue.pop()!;
      const cached = fs.existsSync(`${CACHE}/${sym}.json`);
      try { await processSymbol(sym, trades); } catch (e: any) { errs.push(`${sym}: ${e?.message}`); }
      if (++done % 250 === 0) console.log(`progress ${done}/${syms.length} trades=${trades.length} errs=${errs.length} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      if (!cached) await new Promise((r) => setTimeout(r, 120 + Math.random() * 120));
    }
  }));
  console.log(`\n${trades.length} graded breakouts from ${syms.length} symbols (errors: ${errs.length})`);
  if (errs.length) console.log("first errors:", errs.slice(0, 5).join(" | "));
  // Relative strength: percentile of the trade's 6-month return within the
  // universe cross-section sampled at the start of the entry month.
  const sortedByMonth = new Map<string, number[]>();
  for (const [ym, arr] of universeRet126) sortedByMonth.set(ym, arr.sort((a, b) => a - b));
  for (const t of trades) {
    const arr = sortedByMonth.get(t.date.slice(0, 7));
    if (t.ret126 == null || !arr || arr.length < 50) continue;
    let lo = 0, hi = arr.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < t.ret126) lo = mid + 1; else hi = mid; }
    t.rs = Math.round((lo / arr.length) * 100);
  }
  // Paths → one Float32 blob + Uint32 offsets per strategy; JSON keeps the rest.
  trades.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.sym < b.sym ? -1 : 1));
  for (const name of Object.keys(PATH_STRATEGIES)) {
    const offsets = new Uint32Array(trades.length + 1);
    let total = 0;
    for (let t = 0; t < trades.length; t++) { offsets[t] = total; total += trades[t].paths![name].length; }
    offsets[trades.length] = total;
    const data = new Float32Array(total);
    for (let t = 0; t < trades.length; t++) data.set(trades[t].paths![name], offsets[t]);
    const slug = name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
    fs.writeFileSync(`${CACHE}/paths-${slug}.f32`, Buffer.from(data.buffer));
    fs.writeFileSync(`${CACHE}/paths-${slug}.u32`, Buffer.from(offsets.buffer));
  }
  for (const t of trades) delete t.paths;
  fs.writeFileSync(`${CACHE}/exit-trades.json`, JSON.stringify(trades));

  table(trades, "ALL graded breakouts (S/A+/A, above 200MA, ≥100k avg vol)");
  for (const g of ["S", "A+", "A"]) table(trades.filter((t) => t.grade === g), `grade ${g}`);
  table(trades.filter((t) => t.year >= 2010), "2010–2026 only");
  table(trades.filter((t) => t.year < 2010), "before 2010");
}

main().catch((e) => { console.error(e); process.exit(1); });
