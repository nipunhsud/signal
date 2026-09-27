// Heavy index selling, then recovery, then a breakout. Is that the strong play?
//
// The market-health study found distribution days pointing the wrong way:
// 0-1 days ran a 1.28 profit factor, 9+ ran 2.14. Heavy selling in the index
// preceded BIGGER breakout winners. That is counter-intuitive enough to be
// worth sharpening into something usable rather than left as a curiosity.
//
// The idea being tested: a burst of institutional selling that the index then
// absorbs is a washout. Breakouts that fire once the index has taken the
// selling and recovered should be the strong ones — the supply is gone.
//
// Index state at each breakout, all knowable that day:
//   dd        distribution days in the prior 25 sessions, IBD's definition
//             (a 0.2%+ fall on heavier volume than the day before), with IBD's
//             5% expiry: a day drops out once the index closes 5% above it.
//   recovered how close the index sits to its own 25-session high.
//
// Washout = the selling happened AND the index has taken it back.
import fs from 'fs';
import { detectBases } from '../base-detect.js';

const CACHE = './study-cache';

// ── The index: distribution days and recovery, by date ──────────────────────
const spx = JSON.parse(fs.readFileSync(`${CACHE}/^GSPC.json`, 'utf8'))
  .filter((r) => Array.isArray(r) && r.length >= 6 && r[4] > 0)
  .map((r) => ({ date: new Date(r[0] * 1000).toISOString().slice(0, 10), close: r[4], volume: r[5] }));
const idxState = new Map();
for (let i = 26; i < spx.length; i++) {
  let dd = 0;
  for (let k = i - 24; k <= i; k++) {
    const down = spx[k].close <= spx[k - 1].close * 0.998;
    const volUp = (spx[k].volume || 0) > (spx[k - 1].volume || 0);
    if (!down || !volUp) continue;
    // IBD's 5% expiry: absorbed selling stops counting.
    let absorbed = false;
    for (let j = k + 1; j <= i; j++) if (spx[j].close >= spx[k].close * 1.05) { absorbed = true; break; }
    if (!absorbed) dd++;
  }
  let hi = 0;
  for (let k = i - 24; k <= i; k++) hi = Math.max(hi, spx[k].close);
  idxState.set(spx[i].date, { dd, fromHigh: ((spx[i].close - hi) / hi) * 100 });
}
console.log(`index sessions with a state: ${idxState.size}`);

const files = fs.readdirSync(CACHE).filter((f) => f.endsWith('.json') && !f.startsWith('^') && !/-(rows|study|agg)\.json$/.test(f) && !/^(META|market-health|sectors)\.json$/.test(f));
const load = (sym) => JSON.parse(fs.readFileSync(`${CACHE}/${sym}.json`, 'utf8')).filter((r) => Array.isArray(r) && r.length >= 6 && Number.isFinite(r[0]) && r[0] > 0 && r[0] < 4e9 && r.slice(1, 5).every((v) => Number.isFinite(v) && v > 0));

const rows = [];
let done = 0;
for (const f of files) {
  const sym = f.slice(0, -5);
  let a; try { a = load(sym); } catch { continue; }
  const n = a.length; if (n < 320) continue;
  try {
    const bars = a.map((r) => ({ time: new Date(r[0] * 1000).toISOString().slice(0, 10), open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }));
    const idx = new Map(bars.map((b, i) => [b.time, i]));
    const cs = new Float64Array(n + 1), vs = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) { cs[i + 1] = cs[i] + bars[i].close; vs[i + 1] = vs[i] + bars[i].volume; }
    const sma = (i, k) => (i + 1 >= k ? (cs[i + 1] - cs[i + 1 - k]) / k : null);
    let bases; try { bases = detectBases(bars); } catch { done++; continue; }
    for (const base of bases) {
      if (!base.breakout) continue;
      const p = idx.get(base.pivotDate), i = idx.get(base.breakout.date);
      if (p == null || i == null || i + 60 >= n || i < 260) continue;
      const st = idxState.get(base.breakout.date);
      if (!st) continue;
      const avgVolume = (vs[i] - vs[i - 20]) / 20;
      if (!(avgVolume * bars[i].close >= 750_000)) continue;
      const ma200 = sma(i, 200), ma200Prev = sma(i - 1, 200);
      if (!(bars[i].close > ma200 && ma200 > ma200Prev)) continue;
      if (base.depthPct > 25) continue;
      let skyAt = 0; for (let k = Math.max(0, p - 251); k <= p; k++) if (bars[k].high > skyAt) skyAt = bars[k].high;
      if (!(bars[p].high >= skyAt * 0.98)) continue;
      const entry = bars[i].close;
      let minLow = Infinity, maxC = -Infinity;
      for (let k = i + 1; k <= i + 20; k++) minLow = Math.min(minLow, bars[k].low);
      for (let k = i + 1; k <= i + 60; k++) maxC = Math.max(maxC, bars[k].close);
      rows.push({
        sym, date: base.breakout.date, year: +base.breakout.date.slice(0, 4),
        dd: st.dd, fromHigh: +st.fromHigh.toFixed(2),
        ret20: +(((bars[i + 20].close - entry) / entry) * 100).toFixed(2),
        stopped: minLow <= entry * 0.93,
        run60: +(((maxC - entry) / entry) * 100).toFixed(2),
      });
    }
  } catch { /* skip */ }
  if (++done % 800 === 0) console.log(`  ${done}/${files.length} rows=${rows.length}`);
}
fs.writeFileSync(`${CACHE}/washout-rows.json`, JSON.stringify(rows));

const agg = (rs) => { const n = rs.length; if (!n) return 'n=0';
  const w = rs.filter((r) => r.ret20 > 0).length, st = rs.filter((r) => r.stopped).length;
  const hit = rs.filter((r) => r.run60 >= 20).length;
  let g = 0, l = 0; for (const r of rs) { const v = Math.max(r.ret20, -7); v > 0 ? g += v : l -= v; }
  return `n=${String(n).padStart(6)} win=${(w / n * 100).toFixed(1)}% stop=${(st / n * 100).toFixed(1)}% reach=${(hit / n * 100).toFixed(1)}% PF=${(l ? g / l : 99).toFixed(2)}`; };
const line = (l, rs) => console.log(l.padEnd(42), agg(rs));

console.log(`\npool ${rows.length}\n`);
line('ALL', rows);
console.log('\n=== distribution days, now with the 5% expiry applied ===');
for (const [lo, hi] of [[0, 1], [1, 3], [3, 5], [5, 7], [7, 99]]) line(`  ${lo}-${hi} distribution days`, rows.filter((r) => r.dd >= lo && r.dd < hi));
console.log('\n=== how far the index sits below its own 25-session high ===');
for (const [lo, hi] of [[-99, -5], [-5, -2], [-2, -0.5], [-0.5, 1]]) line(`  index ${hi}% to ${lo}% off`, rows.filter((r) => r.fromHigh > lo && r.fromHigh <= hi));
console.log('\n=== the washout: selling happened AND the index took it back ===');
const heavy = (r) => r.dd >= 4;
const recovered = (r) => r.fromHigh > -1;
line('washout — 4+ days, index at its high', rows.filter((r) => heavy(r) && recovered(r)));
line('selling, still under water', rows.filter((r) => heavy(r) && !recovered(r)));
line('quiet tape, index at its high', rows.filter((r) => !heavy(r) && recovered(r)));
line('quiet tape, still under water', rows.filter((r) => !heavy(r) && !recovered(r)));
console.log('\n=== by decade, washout vs everything else ===');
for (let y = 1990; y <= 2020; y += 10) {
  const D = rows.filter((r) => r.year >= y && r.year < y + 10); if (!D.length) continue;
  line(`  ${y}s washout`, D.filter((r) => heavy(r) && recovered(r)));
  line(`  ${y}s rest`, D.filter((r) => !(heavy(r) && recovered(r))));
}
