// Is 10-20% depth still "the worst pocket" once the grade has been applied?
//
// breakout-logic subtracts 0.05 from confidence when the base is 10-20% deep,
// citing a 2,074-base study: 39.3% win, "the worst pocket". That penalty is
// applied AFTER the grade (blue sky, <=25% deep, above a rising 200-day), so
// the question is whether the effect survives inside the graded population or
// was carried by the ungraded bases the grade already removes.
//
// TWLO 2026-09-23: RS 97, sector 1 of 12, grade A, 16.5% deep, confidence 79
// against an 80 gate. 0.99 - 0.196 (loose range) = 0.794 -> floored 0.80,
// +0.04 blue sky, -0.05 this penalty = 0.79. One point, 349 scans, no email.
import fs from 'fs';
import { detectBases } from '../base-detect.js';

const CACHE = './study-cache';
const files = fs.readdirSync(CACHE).filter((f) => f.endsWith('.json') && !f.startsWith('^') && !/^(grade|minervini|accumulation|depth|bar|stair|vbase|short|late)-/.test(f) && !['SPY', 'QQQ'].includes(f.slice(0, -5)));
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
      if (s == null || i == null || i + 60 >= n || i < 260) continue;
      if ((vs[i] - vs[i - 20]) / 20 < 100_000) continue;
      // NO grade filter here — that is the point.
      const ma200 = sma(i, 200), ma200Prev = sma(i - 1, 200);
      let skyAt = 0; for (let k = Math.max(0, s - 251); k <= s; k++) if (bars[k].high > skyAt) skyAt = bars[k].high;
      const graded = bars[i].close > ma200 && ma200 > ma200Prev && base.depthPct <= 25 && bars[s].high >= skyAt * 0.98;
      const entry = bars[i].close;
      let minLow = Infinity, maxC = -Infinity;
      for (let k = i + 1; k <= i + 20; k++) minLow = Math.min(minLow, bars[k].low);
      for (let k = i + 1; k <= i + 60; k++) maxC = Math.max(maxC, bars[k].close);
      rows.push({
        depth: base.depthPct, graded,
        ret20: +(((bars[i + 20].close - entry) / entry) * 100).toFixed(2),
        stopped: minLow <= entry * 0.93,
        run60: +(((maxC - entry) / entry) * 100).toFixed(2),
      });
    }
  } catch { /* skip */ }
  if (++done % 800 === 0) console.log(`${done}/${files.length} rows=${rows.length}`);
}

const agg = (rs) => { const n = rs.length; if (!n) return 'n=0';
  const w = rs.filter((r) => r.ret20 > 0).length, s = rs.filter((r) => r.stopped).length;
  const hit = rs.filter((r) => r.run60 >= 20).length;
  let g = 0, l = 0; for (const r of rs) { const v = Math.max(r.ret20, -7); v > 0 ? g += v : l -= v; }
  return `n=${String(n).padStart(6)} win=${(w / n * 100).toFixed(1)}% stop=${(s / n * 100).toFixed(1)}% reach=${(hit / n * 100).toFixed(1)}% PF=${(l ? g / l : 99).toFixed(2)}`; };
const line = (l, rs) => console.log(l.padEnd(38), agg(rs));
const band = (r) => r.depth >= 10 && r.depth < 20;

console.log(`\nall breakouts: ${rows.length}, of which graded: ${rows.filter((r) => r.graded).length}\n`);
console.log('=== every base the detector resolves, graded or not ===');
line('all', rows);
line('  10-20% deep (penalised)', rows.filter(band));
line('  everything else', rows.filter((r) => !band(r)));
console.log('\n=== the ungraded population the grade already removes ===');
const ung = rows.filter((r) => !r.graded);
line('ungraded, all', ung);
line('  ungraded 10-20% deep', ung.filter(band));
line('  ungraded, rest', ung.filter((r) => !band(r)));
console.log('\n=== inside the graded population, where the penalty actually applies ===');
const g = rows.filter((r) => r.graded);
line('graded, all', g);
line('  graded 10-20% deep', g.filter(band));
line('  graded, rest', g.filter((r) => !band(r)));
console.log('\n=== graded, finer ===');
for (const [lo, hi] of [[0, 5], [5, 10], [10, 15], [15, 20], [20, 25.1]]) line(`  graded ${lo}-${hi}%`, g.filter((r) => r.depth >= lo && r.depth < hi));
