// Should a high-RS breakout that misses the grade be surfaced?
//
// SMCI on 2026-09-25: RS 97, breaking out of a 29-bar, 19.4%-deep base on
// confirmed volume — and no grade, because its pivot sits 28% under the
// 52-week high, so the base is not blue sky. It sorts 162nd of 163 in the
// Breakout tab, below grade-A rows carrying RS in the 40s.
//
// Every study so far measured inside the graded pool, which is blue sky by
// definition, so none of them say anything about this population. This one
// splits on blue sky and asks what RS is worth on each side.
import fs from 'fs';
import { detectBases } from '../base-detect.js';

const CACHE = './study-cache';
const files = fs.readdirSync(CACHE).filter((f) => f.endsWith('.json') && !f.startsWith('^') && !/-(rows|study|agg)\.json$/.test(f) && !/^(META|market-health|sectors)\.json$/.test(f));
const load = (sym) => JSON.parse(fs.readFileSync(`${CACHE}/${sym}.json`, 'utf8')).filter((r) => Array.isArray(r) && r.length >= 6 && Number.isFinite(r[0]) && r[0] > 0 && r[0] < 4e9 && r.slice(1, 5).every((v) => Number.isFinite(v) && v > 0));

console.log(`loading ${files.length} symbols...`);
const dateSet = new Set();
const series = new Map();
for (const f of files) {
  const sym = f.slice(0, -5);
  let a; try { a = load(sym); } catch { continue; }
  if (a.length < 320) continue;
  const dates = a.map((r) => new Date(r[0] * 1000).toISOString().slice(0, 10));
  for (const d of dates) dateSet.add(d);
  series.set(sym, { dates, o: Float64Array.from(a, r => r[1]), h: Float64Array.from(a, r => r[2]), l: Float64Array.from(a, r => r[3]), c: Float64Array.from(a, r => r[4]), v: Float64Array.from(a, r => r[5]) });
}
const axis = [...dateSet].sort();
const axisIdx = new Map(axis.map((d, i) => [d, i]));
for (const [, s] of series) { s.byGlobal = new Map(); for (let i = 0; i < s.dates.length; i++) s.byGlobal.set(axisIdx.get(s.dates[i]), i); }
console.log(`${series.size} symbols, ${axis.length} sessions`);

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
  for (const base of bases) {
    if (!base.breakout) continue;
    const p = idx.get(base.pivotDate), i = idx.get(base.breakout.date);
    if (p == null || i == null || i + 60 >= n || i < 260) continue;
    const avgVolume = (vs[i + 1] - vs[i + 1 - 20]) / 20;
    if (avgVolume < 100_000) continue;
    const ma200 = sma(i, 200), ma200Prev = sma(i - 1, 200);
    if (!(s.c[i] > ma200 && ma200 > ma200Prev)) continue;   // the trend rule both sides keep
    if (base.depthPct > 25) continue;                        // hold depth constant
    let skyAt = 0; for (let k = Math.max(0, p - 251); k <= p; k++) if (bars[k].high > skyAt) skyAt = bars[k].high;
    const sky = bars[p].high >= skyAt * 0.98;
    const pctUnderHigh = ((base.pivot - skyAt) / skyAt) * 100;
    const entry = s.c[i];
    let minLow = Infinity, maxC = -Infinity;
    for (let k = i + 1; k <= i + 20; k++) minLow = Math.min(minLow, s.l[k]);
    for (let k = i + 1; k <= i + 60; k++) maxC = Math.max(maxC, s.c[k]);
    rows.push({ sym, gi: axisIdx.get(base.breakout.date), sky, pctUnderHigh: +pctUnderHigh.toFixed(1),
      depth: +base.depthPct.toFixed(1), bars: base.bars,
      vr: +(s.v[i] / avgVolume).toFixed(2),
      ret20: +(((s.c[i + 20] - entry) / entry) * 100).toFixed(2),
      stopped: minLow <= entry * 0.93,
      run60: +(((maxC - entry) / entry) * 100).toFixed(2), rs: null });
  }
  if (++done % 800 === 0) console.log(`  ${done}/${series.size} rows=${rows.length}`);
}
console.log(`pool ${rows.length}; ranking RS...`);
const wanted = new Map();
for (const r of rows) { if (!wanted.has(r.gi)) wanted.set(r.gi, []); wanted.get(r.gi).push(r); }
const symList = [...series.values()];
let dn = 0;
for (const [g, rs] of wanted) {
  const scores = []; const mine = new Map();
  for (const s of symList) {
    const i = s.byGlobal.get(g); if (i == null || i < 63) continue;
    const c = s.c;
    const v = 0.5 * ((c[i] / c[i - 63] - 1) * 100) + 0.3 * ((c[i] / c[i - 21] - 1) * 100) + 0.2 * ((c[i] / c[i - 5] - 1) * 100);
    if (!Number.isFinite(v)) continue;
    scores.push(v); mine.set(s, v);
  }
  if (scores.length < 20) continue;
  scores.sort((a, b) => a - b);
  const pct = (v) => { let lo = 0, hi = scores.length; while (lo < hi) { const m = (lo + hi) >> 1; if (scores[m] < v) lo = m + 1; else hi = m; } return Math.min(99, Math.max(1, Math.round((lo / scores.length) * 99))); };
  for (const r of rs) { const v = mine.get(series.get(r.sym)); if (v != null) r.rs = pct(v); }
  if (++dn % 2500 === 0) console.log(`  ${dn}/${wanted.size}`);
}
fs.writeFileSync(`${CACHE}/ungraded-rs-rows.json`, JSON.stringify(rows));

const agg = (rs) => { const n = rs.length; if (!n) return 'n=0';
  const w = rs.filter(r => r.ret20 > 0).length, st = rs.filter(r => r.stopped).length;
  const hit = rs.filter(r => r.run60 >= 20).length;
  let g = 0, l = 0; for (const r of rs) { const v = Math.max(r.ret20, -7); v > 0 ? g += v : l -= v; }
  return `n=${String(n).padStart(6)} win=${(w/n*100).toFixed(1)}% stop=${(st/n*100).toFixed(1)}% reach=${(hit/n*100).toFixed(1)}% PF=${(l?g/l:99).toFixed(2)}`; };
const line = (l, rs) => console.log(l.padEnd(34), agg(rs));
const R = rows.filter(r => r.rs != null);
console.log(`\nwith RS: ${R.length} (blue sky ${R.filter(r=>r.sky).length}, not ${R.filter(r=>!r.sky).length})\n`);
line('ALL', R);
console.log('\n=== blue sky (the graded pool) by RS ===');
for (const [lo,hi] of [[0,70],[70,89],[89,95],[95,100]]) line(`  sky RS ${lo}-${hi}`, R.filter(r=>r.sky&&r.rs>=lo&&r.rs<hi));
console.log('\n=== NOT blue sky — the population SMCI is in ===');
for (const [lo,hi] of [[0,70],[70,89],[89,95],[95,100]]) line(`  no-sky RS ${lo}-${hi}`, R.filter(r=>!r.sky&&r.rs>=lo&&r.rs<hi));
console.log('\n=== the comparison the sort makes ===');
line('graded (sky), RS under 60', R.filter(r=>r.sky&&r.rs<60));
line('ungraded (no sky), RS 95+', R.filter(r=>!r.sky&&r.rs>=95));
console.log('\n=== how far under the high does it stop mattering? (RS 89+) ===');
for (const [lo,hi] of [[-2,0],[-8,-2],[-15,-8],[-25,-15],[-99,-25]]) line(`  pivot ${hi}..${lo}% under high`, R.filter(r=>r.rs>=89&&r.pctUnderHigh>lo-0.0001+0&&r.pctUnderHigh<=hi?false:false) );
for (const [a,b] of [[-2,0],[-8,-2],[-15,-8],[-25,-15],[-999,-25]]) line(`  pivot ${a}..${b}% vs high`, R.filter(r=>r.rs>=89&&r.pctUnderHigh>a&&r.pctUnderHigh<=b));
