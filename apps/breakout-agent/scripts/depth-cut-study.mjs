// Is the 25% depth cut throwing away good setups? Prompted by AMD: blue sky,
// 11.2 weeks, resolved on 1.84x volume, RS 89 — ungraded on 27.5% depth alone.
//
// Keeps every base that passes the grade rules EXCEPT depth (blue-sky pivot,
// 25+ bars, close above the 200-day, 100k+ average volume) and buckets the
// outcome by depth, then by breakout volume and by decade. base-detect caps
// bases at 35% deep, so 25-35% is the whole of what the cut excludes.
import fs from 'fs';
import { detectBases } from '../base-detect.js';

const CACHE = './study-cache';
const OUT = `${CACHE}/depth-rows.json`;
const MIN_AVG_VOL = 100_000;
const startTs = Date.UTC(1985, 0, 1) / 1000;
const files = fs.readdirSync(CACHE).filter((f) => f.endsWith('.json') && !f.startsWith('^') && !/^(grade|minervini|accumulation|depth)-/.test(f) && !['SPY', 'QQQ'].includes(f.slice(0, -5)));
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
      const pIdx = idx.get(base.pivotDate), i = idx.get(base.breakout.date);
      if (pIdx == null || i == null || i + 60 >= n || i < 260 || a[i][0] < startTs) continue;
      if (base.bars < 25) continue;                       // the grade's shape rule
      const av20 = (vs[i] - vs[i - 20]) / 20;
      if (av20 < MIN_AVG_VOL) continue;
      const b = bars[i];
      const ma200 = sma(i, 200);
      if (!(b.close > ma200)) continue;                   // the grade's trend rule
      let skyAt = 0; for (let k = Math.max(0, pIdx - 251); k <= pIdx; k++) if (bars[k].high > skyAt) skyAt = bars[k].high;
      if (!(bars[pIdx].high >= skyAt * 0.98)) continue;    // blue sky only
      // Tightness going in: the range of the 10 bars BEFORE the breakout bar,
      // as a share of the pivot. Same measure the Minervini study used, where
      // it was a safety label on its own; the question here is whether it
      // earns its keep inside the deep band alongside power volume.
      let hh = 0, ll = Infinity;
      for (let k = i - 10; k < i; k++) { if (bars[k].high > hh) hh = bars[k].high; if (bars[k].low < ll) ll = bars[k].low; }
      const tight10 = ((hh - ll) / bars[pIdx].high) * 100;
      const entry = b.close;
      let minLow = Infinity, maxC60 = -Infinity;
      for (let k = i + 1; k <= i + 20; k++) minLow = Math.min(minLow, bars[k].low);
      for (let k = i + 1; k <= i + 60; k++) maxC60 = Math.max(maxC60, bars[k].close);
      rows.push({
        sym, date: b.time, year: +b.time.slice(0, 4),
        depth: base.depthPct, weeks: base.weeks, bars: base.bars,
        vr: +(b.volume / av20).toFixed(2),
        coil: base.coilRatio, dry: base.volumeDryUp, udv: base.upDownVolumeRatio, pokes: base.failedPokes, vcp: base.isVcpShape,
        tight10: +tight10.toFixed(1),
        gapPct: base.breakout.gapPct,
        ret20: +(((bars[i + 20].close - entry) / entry) * 100).toFixed(2),
        ret60: +(((bars[i + 60].close - entry) / entry) * 100).toFixed(2),
        stopped: minLow <= entry * 0.93,
        run60: +(((maxC60 - entry) / entry) * 100).toFixed(2),
      });
    }
  } catch (e) { /* skip */ }
  if (++done % 500 === 0) console.log(`${done}/${files.length} rows=${rows.length}`);
}
fs.writeFileSync(OUT, JSON.stringify(rows));

const agg = (rs) => {
  const n = rs.length; if (!n) return 'n=0';
  const w = rs.filter((r) => r.ret20 > 0).length, s = rs.filter((r) => r.stopped).length;
  const m = (k) => rs.reduce((a, r) => a + r[k], 0) / n;
  const hit = rs.filter((r) => r.run60 >= 20).length;
  const pf = (() => { let g = 0, l = 0; for (const r of rs) { const v = Math.max(r.ret20, -7); if (v > 0) g += v; else l -= v; } return l ? g / l : 99; })();
  return `n=${String(n).padStart(6)} win=${(w / n * 100).toFixed(1)}% stop=${(s / n * 100).toFixed(1)}% mean20=${m('ret20').toFixed(2)}% mean60=${m('ret60').toFixed(2)}% hit+20%=${(hit / n * 100).toFixed(1)}% PF=${pf.toFixed(2)}`;
};
const line = (l, rs) => console.log(l.padEnd(32), agg(rs));
console.log(`\nblue-sky bases, 25+ bars, above the 200-day: ${rows.length}\n`);
console.log('=== by depth ===');
for (const [lo, hi] of [[0, 10], [10, 15], [15, 20], [20, 25], [25, 30], [30, 36]]) line(`depth ${lo}-${hi}%`, rows.filter((r) => r.depth >= lo && r.depth < hi));
line('the cut keeps: <=25%', rows.filter((r) => r.depth <= 25));
line('the cut drops: 25-35%', rows.filter((r) => r.depth > 25));
console.log('\n=== 25-35% deep, split by breakout volume ===');
for (const [lo, hi] of [[0, 1.2], [1.2, 1.5], [1.5, 2], [2, 99]]) line(`>25% deep, vol ${lo}-${hi}x`, rows.filter((r) => r.depth > 25 && r.vr >= lo && r.vr < hi));
for (const [lo, hi] of [[0, 1.5], [1.5, 99]]) line(`<=25% deep, vol ${lo}-${hi}x`, rows.filter((r) => r.depth <= 25 && r.vr >= lo && r.vr < hi));
console.log('\n=== 25-35% deep, with the other quality tells ===');
line('>25% + VCP shape', rows.filter((r) => r.depth > 25 && r.vcp));
line('>25% + dry-up <0.8', rows.filter((r) => r.depth > 25 && r.dry < 0.8));
line('>25% + 0-2 pokes', rows.filter((r) => r.depth > 25 && r.pokes <= 2));
line('>25% + 8wk+', rows.filter((r) => r.depth > 25 && r.weeks >= 8));
line('>25% + vol>=1.5 + 8wk+', rows.filter((r) => r.depth > 25 && r.vr >= 1.5 && r.weeks >= 8));
line('AMD-like: >25,8wk+,vcp,dry<.8', rows.filter((r) => r.depth > 25 && r.weeks >= 8 && r.vcp && r.dry < 0.8));
console.log('\n=== 25-35% deep: tightness of the 10 bars before the breakout, % of pivot ===');
const deep = rows.filter((r) => r.depth > 25);
for (const [lo, hi] of [[0, 4], [4, 6], [6, 8], [8, 12], [12, 999]]) line(`>25% tight10 ${lo}-${hi}%`, deep.filter((r) => r.tight10 >= lo && r.tight10 < hi));
console.log('--- the same bands in the band the cut keeps, for contrast ---');
const shallow = rows.filter((r) => r.depth <= 25);
for (const [lo, hi] of [[0, 4], [4, 6], [6, 8], [8, 12], [12, 999]]) line(`<=25% tight10 ${lo}-${hi}%`, shallow.filter((r) => r.tight10 >= lo && r.tight10 < hi));

console.log('\n=== 25-35% deep: power volume crossed with tightness ===');
for (const [vlo, vhi, vl] of [[2, 99, 'power 2x+'], [1.2, 2, 'confirmed 1.2-2x'], [0, 1.2, 'quiet <1.2x']]) {
  for (const [tlo, thi, tl] of [[0, 6, 'tight <6%'], [6, 10, 'mid 6-10%'], [10, 999, 'loose 10%+']]) {
    line(`>25% ${vl} · ${tl}`, deep.filter((r) => r.vr >= vlo && r.vr < vhi && r.tight10 >= tlo && r.tight10 < thi));
  }
}

console.log('\n=== the candidate rule against what the cut keeps ===');
const cand = (r) => r.depth > 25 && r.vr >= 2 && r.tight10 < 8 && r.weeks >= 8;
line('baseline: everything <=25%', shallow);
line('whole dropped band 25-35%', deep);
line('CANDIDATE >25,8wk+,2x,tight<8', rows.filter(cand));
line('  same without the tightness', rows.filter((r) => r.depth > 25 && r.vr >= 2 && r.weeks >= 8));
line('  same without the volume', rows.filter((r) => r.depth > 25 && r.tight10 < 8 && r.weeks >= 8));
line('  candidate shape at <=25%', shallow.filter((r) => r.vr >= 2 && r.tight10 < 8 && r.weeks >= 8));
line('AMD-like + power', rows.filter((r) => r.depth > 25 && r.weeks >= 8 && r.vcp && r.dry < 0.8 && r.vr >= 2));

console.log('\n=== the candidate, by decade ===');
for (let d = 1980; d <= 2020; d += 10) {
  const inD = rows.filter((r) => r.year >= d && r.year < d + 10);
  if (!inD.length) continue;
  line(`${d}s candidate`, inD.filter(cand));
  line(`${d}s <=25% baseline`, inD.filter((r) => r.depth <= 25));
}

console.log('\n=== by decade: <=25% vs 25-35% ===');
for (let d = 1980; d <= 2020; d += 10) {
  const inD = rows.filter((r) => r.year >= d && r.year < d + 10);
  if (!inD.length) continue;
  line(`${d}s <=25%`, inD.filter((r) => r.depth <= 25));
  line(`${d}s >25%`, inD.filter((r) => r.depth > 25));
}
console.log(`\nsaved ${rows.length} rows -> ${OUT}`);
