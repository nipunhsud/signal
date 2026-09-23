// Does confidence hold up as a gate?
//
// The email gate is `rsRating >= 89 && confidence >= 0.80`. RS is a
// cross-sectional percentile. Confidence is built almost entirely out of the
// five bars before the breakout: how tight their range was, how quiet their
// volume was, plus 0.04 for blue sky and 0.04 for a base over 80 days.
//
// Replicated here exactly as breakout-logic computes it (after the 10-20%
// depth penalty was removed):
//
//   q = 0.99
//   q -= (consolidationRangePercent - 5)/100   when over 5
//   q -= (consolidationVolumePercent - 100)/100 when over 100
//   q = max(0.80, q)
//   q += 0.04 blue sky
//   q += 0.04 base >= 80 days
//   q += 0.03 vcp AND staircase
//
// RS is rebuilt the way the product does it: 0.5*3-month + 0.3*1-month +
// 0.2*1-week return, percentile-ranked against every other symbol trading
// that same session.
import fs from 'fs';
import { detectBases } from '../base-detect.js';

const CACHE = './study-cache';
const files = fs.readdirSync(CACHE).filter((f) => f.endsWith('.json') && !f.startsWith('^') && !/-(rows|study|agg)\.json$/.test(f) && !/^(META|market-health)\.json$/.test(f));
const load = (sym) => JSON.parse(fs.readFileSync(`${CACHE}/${sym}.json`, 'utf8')).filter((r) => Array.isArray(r) && r.length >= 6 && Number.isFinite(r[0]) && r[0] > 0 && r[0] < 4e9 && r.slice(1, 5).every((v) => Number.isFinite(v) && v > 0));

// ── Pass 1: load every symbol onto one global date axis ─────────────────────
console.log(`loading ${files.length} symbols...`);
const dateSet = new Set();
const series = new Map();               // sym -> { dates, o,h,l,c,v }
for (const f of files) {
  const sym = f.slice(0, -5);
  let a; try { a = load(sym); } catch { continue; }
  if (a.length < 320) continue;
  const dates = a.map((r) => new Date(r[0] * 1000).toISOString().slice(0, 10));
  for (const d of dates) dateSet.add(d);
  series.set(sym, {
    dates,
    o: Float64Array.from(a, (r) => r[1]), h: Float64Array.from(a, (r) => r[2]),
    l: Float64Array.from(a, (r) => r[3]), c: Float64Array.from(a, (r) => r[4]),
    v: Float64Array.from(a, (r) => r[5]),
  });
}
const axis = [...dateSet].sort();
const axisIdx = new Map(axis.map((d, i) => [d, i]));
console.log(`${series.size} symbols, ${axis.length} sessions on the axis`);

// Each symbol's position on the axis, so a cross-section can be taken by date.
for (const [, s] of series) {
  s.gi = Int32Array.from(s.dates, (d) => axisIdx.get(d));
  s.byGlobal = new Map(); for (let i = 0; i < s.gi.length; i++) s.byGlobal.set(s.gi[i], i);
}

// ── Pass 2: graded breakouts, with the confidence inputs ────────────────────
const rows = [];
let done = 0;
for (const [sym, s] of series) {
  const n = s.c.length;
  const bars = s.dates.map((t, i) => ({ time: t, open: s.o[i], high: s.h[i], low: s.l[i], close: s.c[i], volume: s.v[i] }));
  const idx = new Map(bars.map((b, i) => [b.time, i]));
  const cs = new Float64Array(n + 1), vs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) { cs[i + 1] = cs[i] + s.c[i]; vs[i + 1] = vs[i] + s.v[i]; }
  const sma = (i, k) => (i + 1 >= k ? (cs[i + 1] - cs[i + 1 - k]) / k : null);
  let bases; try { bases = detectBases(bars); } catch { done++; continue; }
  for (let bi = 0; bi < bases.length; bi++) {
    const base = bases[bi];
    if (!base.breakout) continue;
    const p = idx.get(base.pivotDate), i = idx.get(base.breakout.date);
    if (p == null || i == null || i + 60 >= n || i < 260) continue;
    const avgVolume = (vs[i + 1] - vs[i + 1 - 20]) / 20;
    if (avgVolume < 100_000) continue;
    const ma20 = sma(i, 20), ma50 = sma(i, 50), ma150 = sma(i, 150), ma200 = sma(i, 200), ma200Prev = sma(i - 1, 200);
    // the graded shape
    let skyAt = 0; for (let k = Math.max(0, p - 251); k <= p; k++) if (bars[k].high > skyAt) skyAt = bars[k].high;
    const sky = bars[p].high >= skyAt * 0.98;
    if (!sky || base.depthPct > 25 || !(s.c[i] > ma200) || !(ma200 > ma200Prev)) continue;

    // ── the five bars before the breakout, exactly as calculateBarsInRange ──
    const prev5 = bars.slice(i - 5, i);
    const cHigh = Math.max(...prev5.map((b) => b.high));
    const cLow = Math.min(...prev5.map((b) => b.low));
    const consRangePct = ((cHigh - cLow) / cLow) * 100;
    const consVolPct = ((prev5.reduce((a, b) => a + b.volume, 0) / 5) / avgVolume) * 100;
    const cleanConsolidation = s.c[i] > cHigh;
    const highVolume = s.v[i] >= avgVolume * 1.2;

    // ── confidence, as breakout-logic computes it for a Type1 ───────────────
    let q = 0.99;
    if (consRangePct > 5) q -= (consRangePct - 5) / 100;
    if (consVolPct > 100) q -= (consVolPct - 100) / 100;
    q = Math.max(0.8, q);
    let conf = q;
    const blueSky = true;                       // graded bases are blue sky
    if (blueSky) conf = Math.min(0.99, conf + 0.04);
    if (base.bars >= 80) conf = Math.min(0.99, conf + 0.04);
    // vcp+staircase is worth 0.03 and is rare; left out, noted in the writeup

    // ── would it even be a Type1? confidence is 0.10 otherwise ──────────────
    let res20 = 0; for (let k = i - 20; k < i; k++) res20 = Math.max(res20, bars[k].high);
    const maStack = ma200 < ma150 && ma150 < ma50 && ma50 < ma20;
    const prevBase = bi > 0 ? bases[bi - 1] : null;
    const priorBoIdx = prevBase?.breakout ? idx.get(prevBase.breakout.date) : null;
    const priorBarsAgo = priorBoIdx != null ? i - priorBoIdx : 0;
    const noRecentPriorBreakout = priorBarsAgo === 0 || priorBarsAgo > 45 || base.bars >= priorBarsAgo * 0.5;
    const isType1 = s.h[i] > res20 && s.c[i] > ma50 && s.c[i] > ma200 && maStack &&
      highVolume && s.c[i] > s.o[i] && cleanConsolidation &&
      base.bars >= 15 && base.depthPct <= 30 && noRecentPriorBreakout;

    const entry = s.c[i];
    let minLow = Infinity, maxC = -Infinity;
    for (let k = i + 1; k <= i + 20; k++) minLow = Math.min(minLow, s.l[k]);
    for (let k = i + 1; k <= i + 60; k++) maxC = Math.max(maxC, s.c[k]);
    rows.push({
      sym, gi: s.gi[i], year: +base.breakout.date.slice(0, 4),
      conf: +conf.toFixed(4), isType1, consRangePct: +consRangePct.toFixed(1), consVolPct: +consVolPct.toFixed(0),
      bars: base.bars, depth: +base.depthPct.toFixed(1), vr: +(s.v[i] / avgVolume).toFixed(2),
      ret20: +(((s.c[i + 20] - entry) / entry) * 100).toFixed(2),
      ret60: +(((s.c[i + 60] - entry) / entry) * 100).toFixed(2),
      stopped: minLow <= entry * 0.93,
      run60: +(((maxC - entry) / entry) * 100).toFixed(2),
      rs: null,
    });
  }
  if (++done % 800 === 0) console.log(`  ${done}/${series.size} rows=${rows.length}`);
}
console.log(`graded breakouts: ${rows.length}`);

// ── Pass 3: cross-sectional RS percentile on each breakout date ─────────────
console.log('ranking RS cross-sections...');
const wanted = new Map();                       // global date -> [row, ...]
for (const r of rows) { if (!wanted.has(r.gi)) wanted.set(r.gi, []); wanted.get(r.gi).push(r); }
const symList = [...series.values()];
let dn = 0;
for (const [g, rs] of wanted) {
  const scores = [];
  const mine = new Map();
  for (const s of symList) {
    const i = s.byGlobal.get(g);
    if (i == null || i < 63) continue;
    const c = s.c;
    const score = 0.5 * ((c[i] / c[i - 63] - 1) * 100) + 0.3 * ((c[i] / c[i - 21] - 1) * 100) + 0.2 * ((c[i] / c[i - 5] - 1) * 100);
    if (!Number.isFinite(score)) continue;
    scores.push(score);
    mine.set(s, score);
  }
  if (scores.length < 20) continue;
  scores.sort((a, b) => a - b);
  const pct = (v) => {                          // count below / total, as the product does
    let lo = 0, hi = scores.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (scores[m] < v) lo = m + 1; else hi = m; }
    return Math.min(99, Math.max(1, Math.round((lo / scores.length) * 99)));
  };
  for (const r of rs) {
    const s = series.get(r.sym);
    const v = mine.get(s);
    if (v != null) r.rs = pct(v);
  }
  if (++dn % 2000 === 0) console.log(`  ${dn}/${wanted.size} sessions ranked`);
}
fs.writeFileSync(`${CACHE}/confidence-rows.json`, JSON.stringify(rows));

// ── Report ──────────────────────────────────────────────────────────────────
const agg = (rs) => { const n = rs.length; if (!n) return 'n=0';
  const w = rs.filter((r) => r.ret20 > 0).length, st = rs.filter((r) => r.stopped).length;
  const m = rs.reduce((a, r) => a + r.ret60, 0) / n, hit = rs.filter((r) => r.run60 >= 20).length;
  let g = 0, l = 0; for (const r of rs) { const v = Math.max(r.ret20, -7); v > 0 ? g += v : l -= v; }
  return `n=${String(n).padStart(6)} win=${(w / n * 100).toFixed(1)}% stop=${(st / n * 100).toFixed(1)}% mean60=${m.toFixed(2)}% reach=${(hit / n * 100).toFixed(1)}% PF=${(l ? g / l : 99).toFixed(2)}`; };
const line = (l, rs) => console.log(l.padEnd(34), agg(rs));

const withRs = rows.filter((r) => r.rs != null);
console.log(`\npool ${rows.length}, with an RS percentile ${withRs.length}\n`);
line('ALL graded breakouts', rows);
line('  would classify Type1', rows.filter((r) => r.isType1));
line('  would NOT (confidence 0.10)', rows.filter((r) => !r.isType1));

console.log('\n=== CONFIDENCE, the gate half under test ===');
for (const [lo, hi] of [[0, 0.84], [0.84, 0.86], [0.86, 0.88], [0.88, 0.92], [0.92, 0.96], [0.96, 1.01]]) line(`conf ${lo.toFixed(2)}-${hi.toFixed(2)}`, rows.filter((r) => r.conf >= lo && r.conf < hi));
console.log('  --- as the gate actually splits it ---');
line('conf < 0.80', rows.filter((r) => r.conf < 0.8));
line('conf >= 0.80 (passes)', rows.filter((r) => r.conf >= 0.8));
console.log('  --- among Type1 only, where it is meant to work ---');
const t1 = rows.filter((r) => r.isType1);
for (const [lo, hi] of [[0.8, 0.86], [0.86, 0.9], [0.9, 0.95], [0.95, 1.01]]) line(`  Type1 conf ${lo}-${hi}`, t1.filter((r) => r.conf >= lo && r.conf < hi));

console.log('\n=== RS, the other half ===');
for (const [lo, hi] of [[0, 50], [50, 70], [70, 80], [80, 89], [89, 95], [95, 100]]) line(`RS ${lo}-${hi}`, withRs.filter((r) => r.rs >= lo && r.rs < hi));
console.log('  --- as the gate splits it ---');
line('RS < 89', withRs.filter((r) => r.rs < 89));
line('RS >= 89 (passes)', withRs.filter((r) => r.rs >= 89));

console.log('\n=== the two together, as the gate is written ===');
line('RS>=89 AND conf>=0.80', withRs.filter((r) => r.rs >= 89 && r.conf >= 0.8));
line('RS>=89, conf<0.80 (refused)', withRs.filter((r) => r.rs >= 89 && r.conf < 0.8));
line('RS<89, conf>=0.80', withRs.filter((r) => r.rs < 89 && r.conf >= 0.8));
line('RS>=89 alone', withRs.filter((r) => r.rs >= 89));

console.log('\n=== what confidence is made of, tested separately ===');
for (const [lo, hi] of [[0, 4], [4, 6], [6, 9], [9, 14], [14, 999]]) line(`5-bar range ${lo}-${hi}%`, rows.filter((r) => r.consRangePct >= lo && r.consRangePct < hi));
console.log('');
for (const [lo, hi] of [[0, 60], [60, 85], [85, 110], [110, 999]]) line(`5-bar volume ${lo}-${hi}% of avg`, rows.filter((r) => r.consVolPct >= lo && r.consVolPct < hi));
console.log('');
line('base >= 80 days (+0.04)', rows.filter((r) => r.bars >= 80));
line('base < 80 days', rows.filter((r) => r.bars < 80));
