// Is the 100k average-volume floor earning its place?
//
// Every study behind the grades filtered `avgVolume >= 100_000` before
// counting anything, so the floor has never been tested — its own population
// was excluded by definition. The universe drops from roughly 3,700 names
// above $300M to about 2,460 because of it.
//
// Two liquidity measures, because shares and dollars say different things. A
// stock averaging 80k shares at $300 trades $24M a day and is perfectly
// liquid; one averaging 150k shares at $2 trades $300k and is not.
//
// The honest caveat, stated here because the numbers cannot show it: entries
// and exits are closes. A thin name's close is a price you may not get, so
// every result below overstates the thin buckets by whatever the spread and
// impact would have cost. Treat share-count bands under ~50k as an upper bound.
import fs from 'fs';
import { detectBases } from '../base-detect.js';

const CACHE = './study-cache';
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
      const avgVolume = (vs[i] - vs[i - 20]) / 20;          // the 20 bars BEFORE the breakout
      if (!(avgVolume > 0)) continue;
      // NO liquidity floor here — that is the whole point.
      const ma200 = sma(i, 200), ma200Prev = sma(i - 1, 200);
      if (!(bars[i].close > ma200 && ma200 > ma200Prev)) continue;
      if (base.depthPct > 25) continue;
      let skyAt = 0; for (let k = Math.max(0, p - 251); k <= p; k++) if (bars[k].high > skyAt) skyAt = bars[k].high;
      if (!(bars[p].high >= skyAt * 0.98)) continue;         // the graded shape
      const entry = bars[i].close;
      let minLow = Infinity, maxC = -Infinity;
      for (let k = i + 1; k <= i + 20; k++) minLow = Math.min(minLow, bars[k].low);
      for (let k = i + 1; k <= i + 60; k++) maxC = Math.max(maxC, bars[k].close);
      rows.push({
        sym, year: +base.breakout.date.slice(0, 4),
        avgVol: Math.round(avgVolume),
        dollarVol: Math.round(avgVolume * entry),
        price: +entry.toFixed(2),
        vr: +(bars[i].volume / avgVolume).toFixed(2),
        ret20: +(((bars[i + 20].close - entry) / entry) * 100).toFixed(2),
        stopped: minLow <= entry * 0.93,
        run60: +(((maxC - entry) / entry) * 100).toFixed(2),
      });
    }
  } catch { /* skip */ }
  if (++done % 800 === 0) console.log(`  ${done}/${files.length} rows=${rows.length}`);
}
fs.writeFileSync(`${CACHE}/liquidity-rows.json`, JSON.stringify(rows));

const agg = (rs) => { const n = rs.length; if (!n) return 'n=0';
  const w = rs.filter((r) => r.ret20 > 0).length, st = rs.filter((r) => r.stopped).length;
  const hit = rs.filter((r) => r.run60 >= 20).length;
  let g = 0, l = 0; for (const r of rs) { const v = Math.max(r.ret20, -7); v > 0 ? g += v : l -= v; }
  return `n=${String(n).padStart(6)} win=${(w / n * 100).toFixed(1)}% stop=${(st / n * 100).toFixed(1)}% reach=${(hit / n * 100).toFixed(1)}% PF=${(l ? g / l : 99).toFixed(2)}`; };
const line = (l, rs) => console.log(l.padEnd(32), agg(rs));
const k = (v) => (v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.round(v / 1e3) + 'k');

console.log(`\ngraded breakouts with NO liquidity floor: ${rows.length}`);
console.log(`  under the 100k floor: ${rows.filter((r) => r.avgVol < 100_000).length}`);
console.log(`  at or over it:        ${rows.filter((r) => r.avgVol >= 100_000).length}\n`);
line('ALL', rows);
console.log('\n=== the rule as it stands ===');
line('BELOW 100k avg shares', rows.filter((r) => r.avgVol < 100_000));
line('AT OR ABOVE 100k', rows.filter((r) => r.avgVol >= 100_000));
console.log('\n=== by average share volume ===');
for (const [lo, hi] of [[0, 25e3], [25e3, 50e3], [50e3, 100e3], [100e3, 250e3], [250e3, 1e6], [1e6, 1e12]]) line(`  ${k(lo)}-${k(hi)} shares`, rows.filter((r) => r.avgVol >= lo && r.avgVol < hi));
console.log('\n=== by average DOLLAR volume, the better measure ===');
for (const [lo, hi] of [[0, 5e5], [5e5, 2e6], [2e6, 10e6], [10e6, 50e6], [50e6, 1e15]]) line(`  $${k(lo)}-$${k(hi)}/day`, rows.filter((r) => r.dollarVol >= lo && r.dollarVol < hi));
console.log('\n=== thin by shares but fine in dollars (the names the floor drops) ===');
line('<100k shares, >$2M/day', rows.filter((r) => r.avgVol < 100_000 && r.dollarVol >= 2e6));
line('<100k shares, <$2M/day', rows.filter((r) => r.avgVol < 100_000 && r.dollarVol < 2e6));
console.log('\n=== and with the rest of the gate (1.5x breakout volume) ===');
line('<100k shares & vr>=1.5', rows.filter((r) => r.avgVol < 100_000 && r.vr >= 1.5));
line('>=100k shares & vr>=1.5', rows.filter((r) => r.avgVol >= 100_000 && r.vr >= 1.5));
console.log('\n=== penny-stock check: is thin just cheap? ===');
for (const [lo, hi] of [[0, 5], [5, 15], [15, 50], [50, 1e9]]) line(`  price $${lo}-$${hi}`, rows.filter((r) => r.avgVol < 100_000 && r.price >= lo && r.price < hi));
console.log('\n=== by decade, below the floor vs above ===');
for (let y = 1990; y <= 2020; y += 10) {
  const D = rows.filter((r) => r.year >= y && r.year < y + 10); if (!D.length) continue;
  line(`  ${y}s below`, D.filter((r) => r.avgVol < 100_000)); line(`  ${y}s above`, D.filter((r) => r.avgVol >= 100_000));
}
