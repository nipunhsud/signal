// Does a base built on an episodic pivot break out better?
//
// The claim: when a base forms right after a sudden repricing — an earnings
// gap, a guidance change, a catalyst — the breakout from that base deserves
// more weight than one from a base that drifted into place.
//
// TWLO is the case in front of us. On 2026-08-07 it closed +24.9% on 4.22x
// volume, built a 5-week base on top of that bar, and cleared it on 21 Sep.
//
// Measured here: for every base the detector resolves, look back over the
// bars that produced the base high for a repricing bar — a daily gain on
// volume far above normal — and compare what the breakout did afterwards.
import fs from 'fs';
import { detectBases } from '../base-detect.js';

const CACHE = './study-cache';
const files = fs.readdirSync(CACHE).filter((f) => f.endsWith('.json') && !f.startsWith('^') && !/-(rows|study|agg)\.json$/.test(f) && !/^(META|market-health|sectors)\.json$/.test(f));
const load = (sym) => JSON.parse(fs.readFileSync(`${CACHE}/${sym}.json`, 'utf8')).filter((r) => Array.isArray(r) && r.length >= 6 && Number.isFinite(r[0]) && r[0] > 0 && r[0] < 4e9 && r.slice(1, 5).every((v) => Number.isFinite(v) && v > 0));

// A repricing bar: the market changed its mind about the company in one
// session. Size on the close, confirmation from volume.
const EP_GAIN = 8;      // % close-over-close
const EP_VOL = 3;       // x the 20-bar average
const EP_LOOKBACK = 15; // bars before the base pivot that can carry it

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
      const avgVolume = (vs[i + 1] - vs[i + 1 - 20]) / 20;
      if (avgVolume < 100_000) continue;
      const ma200 = sma(i, 200), ma200Prev = sma(i - 1, 200);
      let skyAt = 0; for (let k = Math.max(0, p - 251); k <= p; k++) if (bars[k].high > skyAt) skyAt = bars[k].high;
      const sky = bars[p].high >= skyAt * 0.98;
      const above = bars[i].close > ma200 && ma200 > ma200Prev;
      const graded = sky && above && base.depthPct <= 25;
      const deep = sky && above && base.depthPct > 25 && base.depthPct <= 35 && base.bars >= 40;
      if (!graded && !deep) continue;

      // The repricing bar that built the base high, if there was one.
      let epGain = 0, epVol = 0, epAgo = null;
      for (let k = Math.max(21, p - EP_LOOKBACK); k <= p; k++) {
        const g = ((bars[k].close - bars[k - 1].close) / bars[k - 1].close) * 100;
        const av = (vs[k] - vs[k - 20]) / 20;
        const vr = av > 0 ? bars[k].volume / av : 0;
        if (g >= EP_GAIN && vr >= EP_VOL && g > epGain) { epGain = g; epVol = vr; epAgo = p - k; }
      }
      const entry = bars[i].close;
      let minLow = Infinity, maxC = -Infinity;
      for (let k = i + 1; k <= i + 20; k++) minLow = Math.min(minLow, bars[k].low);
      for (let k = i + 1; k <= i + 60; k++) maxC = Math.max(maxC, bars[k].close);
      rows.push({
        sym, date: base.breakout.date, year: +base.breakout.date.slice(0, 4),
        graded, deep, depth: +base.depthPct.toFixed(1), bars: base.bars,
        ep: epGain > 0, epGain: +epGain.toFixed(1), epVol: +epVol.toFixed(1), epAgo,
        vr: +(bars[i].volume / avgVolume).toFixed(2),
        ret20: +(((bars[i + 20].close - entry) / entry) * 100).toFixed(2),
        ret60: +(((bars[i + 60].close - entry) / entry) * 100).toFixed(2),
        stopped: minLow <= entry * 0.93,
        run60: +(((maxC - entry) / entry) * 100).toFixed(2),
      });
    }
  } catch { /* skip */ }
  if (++done % 800 === 0) console.log(`  ${done}/${files.length} rows=${rows.length}`);
}
fs.writeFileSync(`${CACHE}/ep-rows.json`, JSON.stringify(rows));

const agg = (rs) => { const n = rs.length; if (!n) return 'n=0';
  const w = rs.filter((r) => r.ret20 > 0).length, st = rs.filter((r) => r.stopped).length;
  const m = rs.reduce((a, r) => a + r.ret60, 0) / n, hit = rs.filter((r) => r.run60 >= 20).length;
  let g = 0, l = 0; for (const r of rs) { const v = Math.max(r.ret20, -7); v > 0 ? g += v : l -= v; }
  return `n=${String(n).padStart(6)} win=${(w / n * 100).toFixed(1)}% stop=${(st / n * 100).toFixed(1)}% mean60=${m.toFixed(2)}% reach=${(hit / n * 100).toFixed(1)}% PF=${(l ? g / l : 99).toFixed(2)}`; };
const line = (l, rs) => console.log(l.padEnd(40), agg(rs));

console.log(`\npool ${rows.length}  (graded ${rows.filter((r) => r.graded).length}, deep ${rows.filter((r) => r.deep).length})\n`);
line('ALL', rows);
console.log('\n=== was the base built on a repricing bar? ===');
line('base follows an EP', rows.filter((r) => r.ep));
line('base has none', rows.filter((r) => !r.ep));
console.log('\n=== inside the graded band only ===');
const g = rows.filter((r) => r.graded);
line('graded, follows an EP', g.filter((r) => r.ep));
line('graded, none', g.filter((r) => !r.ep));
console.log('\n=== inside the deep band only ===');
const d = rows.filter((r) => r.deep);
line('deep, follows an EP', d.filter((r) => r.ep));
line('deep, none', d.filter((r) => !r.ep));
console.log('\n=== how big was the repricing bar? ===');
for (const [lo, hi] of [[8, 12], [12, 18], [18, 25], [25, 999]]) line(`EP gain ${lo}-${hi}%`, rows.filter((r) => r.ep && r.epGain >= lo && r.epGain < hi));
console.log('\n=== how loud? ===');
for (const [lo, hi] of [[3, 5], [5, 8], [8, 999]]) line(`EP volume ${lo}-${hi}x`, rows.filter((r) => r.ep && r.epVol >= lo && r.epVol < hi));
console.log('\n=== EP with a real breakout bar behind it ===');
line('EP & breakout vol >= 1.5x', rows.filter((r) => r.ep && r.vr >= 1.5));
line('no EP & breakout vol >= 1.5x', rows.filter((r) => !r.ep && r.vr >= 1.5));
console.log('\n=== by decade ===');
for (let y = 1990; y <= 2020; y += 10) {
  const D = rows.filter((r) => r.year >= y && r.year < y + 10); if (!D.length) continue;
  line(`  ${y}s EP`, D.filter((r) => r.ep)); line(`  ${y}s none`, D.filter((r) => !r.ep));
}
