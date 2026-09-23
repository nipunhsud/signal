// Did the base actually consolidate, or is it a V?
//
// RSKD 2026-09-22 raised the question. The detector called a 2.2-week, 17%-deep
// grade-A base: high 6.98 on 3 Sep, low 5.79 on 10 Sep, breakout 22 Sep. But
// nothing in that base consolidated — price fell 15% in five sessions, then
// climbed back in a near-straight line over eight, with no pullback deeper
// than 1.6%, and took out the old high on the ninth. The grade tests blue sky,
// depth and the 200-day. It never asks whether the base built a floor.
//
// Measured here, on the graded pool:
//   lowPos          where in the base the low was made (0 = start, 1 = breakout)
//   recoveryPull    deepest pullback from the running high, low -> breakout
//   floorBars       bars after the low that closed in the lowest third
//   recoveryVol     recovery-leg volume vs the base's own average
import fs from 'fs';
import { detectBases } from '../base-detect.js';

const CACHE = './study-cache';
const files = fs.readdirSync(CACHE).filter((f) => f.endsWith('.json') && !f.startsWith('^') && !/^(grade|minervini|accumulation|depth|bar|stair|vbase)-/.test(f) && !['SPY', 'QQQ'].includes(f.slice(0, -5)));
const load = (sym) => JSON.parse(fs.readFileSync(`${CACHE}/${sym}.json`, 'utf8')).filter((r) => Array.isArray(r) && r.length >= 6 && Number.isFinite(r[0]) && r[0] > 0 && r[0] < 4e9 && r.slice(1, 5).every((v) => Number.isFinite(v) && v > 0));

const rows = [];
let done = 0;
for (const f of files) {
  const sym = f.slice(0, -5);
  let a; try { a = load(sym); } catch { continue; }
  const n = a.length; if (n < 320) continue;
  try {
    const bars = a.map((r) => ({ time: new Date(r[0] * 1000).toISOString().slice(0, 10), open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }));
    const idx = new Map(); for (let i = 0; i < n; i++) idx.set(bars[i].time, i);
    const cs = new Float64Array(n + 1), vs = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) { cs[i + 1] = cs[i] + bars[i].close; vs[i + 1] = vs[i] + bars[i].volume; }
    const sma = (i, k) => (i + 1 >= k ? (cs[i + 1] - cs[i + 1 - k]) / k : null);
    let bases; try { bases = detectBases(bars); } catch { continue; }
    for (const base of bases) {
      if (!base.breakout) continue;
      const s = idx.get(base.pivotDate), i = idx.get(base.breakout.date);
      if (s == null || i == null || i + 60 >= n || i < 260 || i - s < 6) continue;
      if (base.bars < 25 || base.depthPct > 25) continue;
      if ((vs[i] - vs[i - 20]) / 20 < 100_000) continue;
      if (!(bars[i].close > sma(i, 200))) continue;
      let skyAt = 0; for (let k = Math.max(0, s - 251); k <= s; k++) if (bars[k].high > skyAt) skyAt = bars[k].high;
      if (!(bars[s].high >= skyAt * 0.98)) continue;

      // Shape of the base, start (pivot high) to the bar before the breakout
      let lo = Infinity, loIdx = s, hi = 0, volSum = 0;
      for (let k = s; k < i; k++) { if (bars[k].low < lo) { lo = bars[k].low; loIdx = k; } if (bars[k].high > hi) hi = bars[k].high; volSum += bars[k].volume; }
      const span = hi - lo; if (!(span > 0)) continue;
      const len = i - s;
      const recLen = i - loIdx;
      if (recLen < 2) continue;
      // deepest pullback inside the recovery leg
      let peak = bars[loIdx].close, pull = 0;
      for (let k = loIdx; k < i; k++) { if (bars[k].close > peak) peak = bars[k].close; const d = (peak - bars[k].low) / peak * 100; if (d > pull) pull = d; }
      let floorBars = 0; for (let k = loIdx; k < i; k++) if (bars[k].close <= lo + span / 3) floorBars++;
      let recVol = 0; for (let k = loIdx; k < i; k++) recVol += bars[k].volume;
      const entry = bars[i].close;
      let minLow = Infinity, maxC60 = -Infinity;
      for (let k = i + 1; k <= i + 20; k++) minLow = Math.min(minLow, bars[k].low);
      for (let k = i + 1; k <= i + 60; k++) maxC60 = Math.max(maxC60, bars[k].close);
      rows.push({
        sym, date: bars[i].time, depth: base.depthPct, len,
        lowPos: +((loIdx - s) / len).toFixed(2),
        recoveryPull: +pull.toFixed(2),
        floorFrac: +(floorBars / recLen).toFixed(2),
        recoveryVol: +((recVol / recLen) / (volSum / len)).toFixed(2),
        ret20: +(((bars[i + 20].close - entry) / entry) * 100).toFixed(2),
        ret60: +(((bars[i + 60].close - entry) / entry) * 100).toFixed(2),
        stopped: minLow <= entry * 0.93,
        run60: +(((maxC60 - entry) / entry) * 100).toFixed(2),
      });
    }
  } catch { /* skip */ }
  if (++done % 800 === 0) console.log(`${done}/${files.length} rows=${rows.length}`);
}
fs.writeFileSync(`${CACHE}/vbase-rows.json`, JSON.stringify(rows));

const agg = (rs) => { const n = rs.length; if (!n) return 'n=0';
  const w = rs.filter((r) => r.ret20 > 0).length, s = rs.filter((r) => r.stopped).length;
  const m = (k) => rs.reduce((a, r) => a + r[k], 0) / n, hit = rs.filter((r) => r.run60 >= 20).length;
  let g = 0, l = 0; for (const r of rs) { const v = Math.max(r.ret20, -7); v > 0 ? g += v : l -= v; }
  return `n=${String(n).padStart(5)} win=${(w / n * 100).toFixed(1)}% stop=${(s / n * 100).toFixed(1)}% mean60=${m('ret60').toFixed(2)}% reach=${(hit / n * 100).toFixed(1)}% PF=${(l ? g / l : 99).toFixed(2)}`; };
const line = (l, rs) => console.log(l.padEnd(36), agg(rs));
console.log(`\npool ${rows.length}\n`); line('ALL', rows);
console.log('\n=== deepest pullback inside the recovery leg ===');
for (const [lo, hi] of [[0, 2], [2, 4], [4, 6], [6, 9], [9, 999]]) line(`recovery pullback ${lo}-${hi}%`, rows.filter((r) => r.recoveryPull >= lo && r.recoveryPull < hi));
console.log('\n=== bars that built a floor (closed in the low third) ===');
for (const [lo, hi] of [[0, 0.1], [0.1, 0.25], [0.25, 0.45], [0.45, 1.01]]) line(`floor frac ${lo}-${hi}`, rows.filter((r) => r.floorFrac >= lo && r.floorFrac < hi));
console.log('\n=== where the low was made ===');
for (const [lo, hi] of [[0, 0.25], [0.25, 0.5], [0.5, 0.75], [0.75, 1.01]]) line(`low at ${lo}-${hi} of base`, rows.filter((r) => r.lowPos >= lo && r.lowPos < hi));
console.log('\n=== recovery-leg volume vs the base average ===');
for (const [lo, hi] of [[0, 0.6], [0.6, 0.9], [0.9, 1.2], [1.2, 99]]) line(`recovery vol ${lo}-${hi}x`, rows.filter((r) => r.recoveryVol >= lo && r.recoveryVol < hi));
console.log('\n=== the V, isolated (straight recovery, no floor) ===');
const V = (r) => r.recoveryPull < 3 && r.floorFrac < 0.2;
line('V-shaped', rows.filter(V));
line('consolidated', rows.filter((r) => !V(r)));
console.log('\n=== V, inside the deeper half of the graded band ===');
line('V & depth>=14%', rows.filter((r) => V(r) && r.depth >= 14));
line('not V & depth>=14%', rows.filter((r) => !V(r) && r.depth >= 14));
line('V & depth<14%', rows.filter((r) => V(r) && r.depth < 14));
console.log('\n=== V by base length ===');
for (const [lo, hi] of [[0, 30], [30, 60], [60, 9999]]) { line(`V ${lo}-${hi} bars`, rows.filter((r) => V(r) && r.len >= lo && r.len < hi)); line(`not V ${lo}-${hi} bars`, rows.filter((r) => !V(r) && r.len >= lo && r.len < hi)); }
