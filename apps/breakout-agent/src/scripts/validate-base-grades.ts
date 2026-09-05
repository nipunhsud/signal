// Full-history validation of the base-grade cuts before wiring them into
// breakout-logic. Replays base-detect over each symbol's complete price
// history and measures 20-bar forward outcomes per grade, so the grade/label
// implementation starts from settled numbers instead of the (regime-flattered)
// 2-year window. Also settles two open questions:
//   1. non-sky: does ANY non-blue-sky slice (incl. the old cohort-B
//      "long+loud" mix) clear the alertable baseline over full history?
//   2. trigger rule: intrabar Donchian-style poke vs close-above-pivot —
//      early-fire rate, trap rate, and outcomes from each entry.
//
// Data: FMP screener for the universe (2 calls), Yahoo range=max for bars
// (split-adjusted via adjclose; volume rescaled to current-share terms) —
// deliberately NOT FMP history, to spare API bandwidth. Bars are cached on
// disk (compact arrays), so re-runs and added slices are free.
//
// Usage: node dist/scripts/validate-base-grades.js [--limit N]
//   env: FMP_API_KEY (required), STUDY_CACHE_DIR (default ./study-cache)
// @ts-ignore — plain-JS module at the app root, shared with the dashboard
import { detectBases } from "../../base-detect.js";
import * as fs from "fs";

const CACHE = process.env.STUDY_CACHE_DIR || "./study-cache";
const OUT = `${CACHE}/grade-rows.json`;
const MIN_AVG_VOL = 100_000;
const CONC = 8;

interface Bar { time: string; open: number; high: number; low: number; close: number; volume: number }

async function fetchJson(url: string, opts: any = {}, tries = 4): Promise<any> {
  for (let a = 0; a < tries; a++) {
    try {
      const res = await fetch(url, opts);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (a === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (a + 1) + Math.random() * 1000));
    }
  }
}

async function universe(): Promise<Map<string, string>> {
  const key = process.env.FMP_API_KEY;
  if (!key) throw new Error("FMP_API_KEY not set");
  const base = "https://financialmodelingprep.com/stable/company-screener";
  const [stocks, etfs] = await Promise.all([
    fetchJson(`${base}?marketCapMoreThan=300000000&volumeMoreThan=100000&isEtf=false&isFund=false&isActivelyTrading=true&exchange=NASDAQ,NYSE,AMEX&limit=10000&apikey=${key}`),
    fetchJson(`${base}?volumeMoreThan=100000&isEtf=true&isFund=false&isActivelyTrading=true&limit=10000&apikey=${key}`),
  ]);
  const syms = new Map<string, string>();
  for (const r of stocks || []) if (r.symbol && !r.symbol.includes(".")) syms.set(r.symbol, "stock");
  for (const r of etfs || []) if (r.symbol && !r.symbol.includes(".") && !syms.has(r.symbol)) syms.set(r.symbol, "etf");
  return syms;
}

// Yahoo max-range bars, split/dividend-adjusted. OHLC is scaled by
// adjclose/close; volume by the inverse, so share-count ratios stay
// comparable across split boundaries (a 20-day avg spanning a 2:1 split
// would otherwise double the breakout bar's apparent volume ratio).
async function yahooMaxBars(symbol: string): Promise<Bar[]> {
  const cacheFile = `${CACHE}/${symbol}.json`;
  if (fs.existsSync(cacheFile)) {
    const a = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    return a.map((r: number[]) => ({ time: new Date(r[0] * 1000).toISOString().slice(0, 10), open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }));
  }
  // Explicit epoch bounds: range=max silently downgrades to monthly bars.
  const j = await fetchJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=0&period2=9999999999&interval=1d`,
    { headers: { "User-Agent": "Mozilla/5.0" } }, 3);
  const r = j?.chart?.result?.[0];
  const ts = r?.timestamp, q = r?.indicators?.quote?.[0];
  const adj = r?.indicators?.adjclose?.[0]?.adjclose;
  if (!ts || !q) throw new Error("empty");
  const compact: number[][] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    if (o == null || h == null || l == null || c == null || c <= 0) continue;
    const f = adj && adj[i] != null && adj[i] > 0 ? adj[i] / c : 1;
    compact.push([ts[i], o * f, h * f, l * f, c * f, (q.volume[i] ?? 0) / f]);
  }
  fs.writeFileSync(cacheFile, JSON.stringify(compact));
  return compact.map((r2) => ({ time: new Date(r2[0] * 1000).toISOString().slice(0, 10), open: r2[1], high: r2[2], low: r2[3], close: r2[4], volume: r2[5] }));
}

const sma = (bars: Bar[], i: number, n: number) => {
  if (i + 1 < n) return null;
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += bars[k].close;
  return s / n;
};
const avgVolPrior = (bars: Bar[], i: number, n = 20) => {
  if (i < n) return null;
  let s = 0;
  for (let k = i - n; k < i; k++) s += bars[k].volume;
  return s / n;
};

interface Row {
  sym: string; type: string; date: string; year: number;
  grade: string; sky: boolean; baseBars: number; depth: number;
  vr: number; above200: boolean; distHighPct: number;
  ret20: number; win: boolean; stopped: boolean;
  // trigger comparison
  pokeBarsEarly: number; // first intrabar high>pivot, bars before the close-above (0 = same bar)
  pokeRet20: number | null; // 20-bar return entering at that poke bar's close
  pokeStopped: boolean | null;
}

function gradeOf(sky: boolean, baseBars: number, depth: number, distHighPct: number, vr: number): string {
  const goodShape = baseBars >= 25 && depth <= 25;
  if (sky && goodShape && depth <= 15) return "A+";
  if (sky && goodShape) return "A";
  if (!sky && goodShape && distHighPct < 15) return "near-not-sky";
  if (!sky && baseBars >= 80 && vr >= 2) return "nonsky-long-loud"; // old cohort-B mix
  return "short-deep";
}

async function processSymbol(sym: string, type: string, rows: Row[], forming: { pokes: number; total: number }) {
  const bars = await yahooMaxBars(sym);
  if (bars.length < 300) return;
  const idxByDate = new Map<string, number>();
  for (let i = 0; i < bars.length; i++) idxByDate.set(bars[i].time, i);
  for (const base of detectBases(bars) as any[]) {
    const pIdx = idxByDate.get(base.pivotDate);
    if (pIdx == null) continue;
    const pivot = bars[pIdx].high;
    if (!base.breakout) {
      // forming base at the right edge: did an intrabar poke already fire?
      forming.total++;
      for (let k = pIdx + 1; k < bars.length; k++) if (bars[k].high > pivot) { forming.pokes++; break; }
      continue;
    }
    const i = idxByDate.get(base.breakout.date);
    if (i == null || i + 20 >= bars.length) continue;
    const ma200 = sma(bars, i, 200);
    if (ma200 == null) continue;
    const av = avgVolPrior(bars, i);
    if (av == null || av < MIN_AVG_VOL) continue;
    const b = bars[i];
    const h252 = Math.max(...bars.slice(Math.max(0, i - 251), i + 1).map((x) => x.high));
    const skyAtPivot = Math.max(...bars.slice(Math.max(0, pIdx - 251), pIdx + 1).map((x) => x.high));
    const sky = pivot >= skyAtPivot * 0.98;
    const vr = b.volume / av;
    const entry = b.close;
    const ret20 = (bars[i + 20].close - entry) / entry;
    let minLow = Infinity;
    for (let k = i + 1; k <= i + 20; k++) minLow = Math.min(minLow, bars[k].low);
    // first intrabar poke through the pivot (Donchian-style trigger)
    let pokeIdx = i;
    for (let k = pIdx + 1; k <= i; k++) if (bars[k].high > pivot) { pokeIdx = k; break; }
    let pokeRet20: number | null = null;
    let pokeStopped: boolean | null = null;
    if (pokeIdx + 20 < bars.length) {
      const pe = bars[pokeIdx].close;
      pokeRet20 = (bars[pokeIdx + 20].close - pe) / pe;
      let pl = Infinity;
      for (let k = pokeIdx + 1; k <= pokeIdx + 20; k++) pl = Math.min(pl, bars[k].low);
      pokeStopped = pl <= pe * 0.93;
    }
    const distHighPct = ((h252 - entry) / h252) * 100;
    rows.push({
      sym, type, date: b.time, year: +b.time.slice(0, 4),
      grade: gradeOf(sky, base.bars, base.depthPct, distHighPct, vr),
      sky, baseBars: base.bars, depth: base.depthPct,
      vr: +vr.toFixed(2), above200: b.close > ma200, distHighPct: +distHighPct.toFixed(1),
      ret20: +ret20.toFixed(4), win: ret20 > 0, stopped: minLow <= entry * 0.93,
      pokeBarsEarly: i - pokeIdx, pokeRet20: pokeRet20 == null ? null : +pokeRet20.toFixed(4), pokeStopped,
    });
  }
}

function agg(rs: Row[], f: (r: Row) => number = (r) => r.ret20, winF: (r: Row) => boolean = (r) => r.win, stopF: (r: Row) => boolean = (r) => r.stopped) {
  const n = rs.length;
  if (!n) return "n=0";
  const w = rs.filter(winF).length, s = rs.filter(stopF).length;
  const rets = rs.map(f).sort((a, b) => a - b);
  const mean = rets.reduce((a, b) => a + b, 0) / n;
  const med = rets[Math.floor(n / 2)];
  return `n=${String(n).padStart(6)} win=${(w / n * 100).toFixed(1)}% stop=${(s / n * 100).toFixed(1)}% mean=${(mean * 100).toFixed(2)}% med=${(med * 100).toFixed(2)}%`;
}

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg > -1 ? parseInt(process.argv[limitArg + 1]) : Infinity;
  const syms = [...(await universe()).entries()].slice(0, limit);
  console.log(`universe: ${syms.length} symbols, cache: ${CACHE}`);
  const rows: Row[] = [];
  const forming = { pokes: 0, total: 0 };
  const errs: string[] = [];
  let done = 0;
  const queue = [...syms];
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (queue.length) {
      const [sym, type] = queue.pop()!;
      try { await processSymbol(sym, type, rows, forming); } catch (e: any) { errs.push(`${sym}: ${e?.message}`); }
      if (++done % 250 === 0) console.log(`progress ${done}/${syms.length} rows=${rows.length} errs=${errs.length}`);
      await new Promise((r) => setTimeout(r, 50 + Math.random() * 70));
    }
  }));
  fs.writeFileSync(OUT, JSON.stringify(rows));
  console.log(`\nsaved ${rows.length} rows -> ${OUT}  (errors: ${errs.length})`);

  const pool = rows.filter((r) => r.above200);
  const below = rows.filter((r) => !r.above200);
  console.log(`\n=== hard floor check ===`);
  console.log(`above 200MA     ${agg(pool)}`);
  console.log(`below 200MA     ${agg(below)}`);

  console.log(`\n=== grades (above 200MA) ===`);
  for (const g of ["A+", "A", "near-not-sky", "nonsky-long-loud", "short-deep"])
    console.log(g.padEnd(17), agg(pool.filter((r) => r.grade === g)));

  // The live cohort system's S tier (sky + >=16wk + >=2x vol, 67% win in the
  // original 50-year study) — re-measured here so the grade×tag grid can be
  // mapped onto it: S should equal "A/A+ base, >=80 bars, power volume".
  console.log(`\n=== S-tier cut and its grade×tag decomposition ===`);
  const sCut = pool.filter((r) => r.sky && r.baseBars >= 80 && r.vr >= 2);
  console.log(`S (sky+16wk+2x)  ${agg(sCut)}`);
  const aaLong = pool.filter((r) => (r.grade === "A+" || r.grade === "A") && r.baseBars >= 80);
  console.log(`A+/A long, power ${agg(aaLong.filter((r) => r.vr >= 2))}`);
  console.log(`A+/A long, quiet ${agg(aaLong.filter((r) => r.vr < 1.2))}`);
  console.log(`A+/A long, conf  ${agg(aaLong.filter((r) => r.vr >= 1.2 && r.vr < 2))}`);

  console.log(`\n=== volume tag within A+/A ===`);
  const aa = pool.filter((r) => r.grade === "A+" || r.grade === "A");
  console.log(`quiet <1.2x      ${agg(aa.filter((r) => r.vr < 1.2))}`);
  console.log(`confirmed 1.2-2x ${agg(aa.filter((r) => r.vr >= 1.2 && r.vr < 2))}`);
  console.log(`power >=2x       ${agg(aa.filter((r) => r.vr >= 2))}`);

  console.log(`\n=== per-decade (A+ | A | near-not-sky) ===`);
  for (let d = 1970; d <= 2020; d += 10) {
    const inD = (r: Row) => r.year >= d && r.year < d + 10;
    console.log(`${d}s  A+: ${agg(pool.filter((r) => r.grade === "A+" && inD(r)))}`);
    console.log(`      A : ${agg(pool.filter((r) => r.grade === "A" && inD(r)))}`);
    console.log(`      ns: ${agg(pool.filter((r) => r.grade === "near-not-sky" && inD(r)))}`);
  }

  console.log(`\n=== trigger rule: intrabar poke vs close-above (A+/A pool) ===`);
  const withPoke = aa.filter((r) => r.pokeBarsEarly > 0 && r.pokeRet20 != null);
  console.log(`poke fired early on ${withPoke.length}/${aa.length} (${(withPoke.length / aa.length * 100).toFixed(1)}%) — median lead ${withPoke.map((r) => r.pokeBarsEarly).sort((a, b) => a - b)[Math.floor(withPoke.length / 2)] ?? 0} bars`);
  console.log(`trap rate (poke, then >5 more bars before close-above): ${(withPoke.filter((r) => r.pokeBarsEarly > 5).length / Math.max(1, withPoke.length) * 100).toFixed(1)}%`);
  console.log(`entry at close-above: ${agg(withPoke)}`);
  console.log(`entry at poke close:  ${agg(withPoke, (r) => r.pokeRet20!, (r) => r.pokeRet20! > 0, (r) => r.pokeStopped!)}`);
  console.log(`forming bases already poked (fired, no close-above yet): ${forming.pokes}/${forming.total}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
