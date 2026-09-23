// The breakout bar itself: does a big day at the pivot help or hurt?
// Prompted by a name that ran +10.4% on 3x volume and closed 0.4% above its
// pivot — a whole day's move spent reaching the level, leaving the entry at
// the top of the bar and the fail level far below.
//
// Graded pool only (blue sky, 25+ bars, <=25% deep, above the 200-day), which
// is where the email gate lives. Captures the bar's own gain, how far the
// close cleared the pivot, and where it sat in its own range.
import fs from 'fs';
import { detectBases } from '../base-detect.js';

const CACHE = './study-cache';
const MIN_AVG_VOL = 100_000;
const startTs = Date.UTC(1985, 0, 1) / 1000;
const files = fs.readdirSync(CACHE).filter((f) => f.endsWith('.json') && !f.startsWith('^') && !/^(grade|minervini|accumulation|depth|bar)-/.test(f) && !['SPY', 'QQQ'].includes(f.slice(0, -5)));
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
      if (base.depthPct > 25) continue;          // the graded shape
      const av20 = (vs[i] - vs[i - 20]) / 20;
      if (av20 < MIN_AVG_VOL) continue;
      const b = bars[i], prev = bars[i - 1];
      if (!(b.close > sma(i, 200))) continue;
      let skyAt = 0; for (let k = Math.max(0, pIdx - 251); k <= pIdx; k++) if (bars[k].high > skyAt) skyAt = bars[k].high;
      if (!(bars[pIdx].high >= skyAt * 0.98)) continue;             // blue sky
      const entry = b.close;
      let minLow = Infinity, maxC60 = -Infinity;
      for (let k = i + 1; k <= i + 20; k++) minLow = Math.min(minLow, bars[k].low);
      for (let k = i + 1; k <= i + 60; k++) maxC60 = Math.max(maxC60, bars[k].close);
      rows.push({
        sym, date: b.time, year: +b.time.slice(0, 4), depth: base.depthPct, weeks: base.weeks,
        vr: +(b.volume / av20).toFixed(2),
        barGain: +(((b.close - prev.close) / prev.close) * 100).toFixed(2),   // the day's own move
        clear: +(((b.close - base.pivot) / base.pivot) * 100).toFixed(2),     // how far past the pivot it closed
        closePos: b.high > b.low ? +((b.close - b.low) / (b.high - b.low)).toFixed(2) : 1,
        range: +(((b.high - b.low) / prev.close) * 100).toFixed(2),
        ret20: +(((bars[i + 20].close - entry) / entry) * 100).toFixed(2),
        ret60: +(((bars[i + 60].close - entry) / entry) * 100).toFixed(2),
        stopped: minLow <= entry * 0.93,
        run60: +(((maxC60 - entry) / entry) * 100).toFixed(2),
      });
    }
  } catch { /* skip */ }
  if (++done % 500 === 0) console.log(`${done}/${files.length} rows=${rows.length}`);
}
fs.writeFileSync(`${CACHE}/short-rows.json`, JSON.stringify(rows));

const agg = (rs) => { const n = rs.length; if (!n) return 'n=0';
  const w = rs.filter((r) => r.ret20 > 0).length, s = rs.filter((r) => r.stopped).length;
  const m = (k) => rs.reduce((a, r) => a + r[k], 0) / n, hit = rs.filter((r) => r.run60 >= 20).length;
  let g = 0, l = 0; for (const r of rs) { const v = Math.max(r.ret20, -7); v > 0 ? g += v : l -= v; }
  return `n=${String(n).padStart(5)} win=${(w / n * 100).toFixed(1)}% stop=${(s / n * 100).toFixed(1)}% mean20=${m('ret20').toFixed(2)}% mean60=${m('ret60').toFixed(2)}% reach=${(hit / n * 100).toFixed(1)}% PF=${(l ? g / l : 99).toFixed(2)}`; };
const bars = (r) => Math.round(r.weeks * 5);
const line = (l, rs) => console.log(l.padEnd(34), agg(rs));
console.log(`\npool ${rows.length}\n`); line('ALL (no length floor)', rows);
console.log('\n=== base length, the whole graded shape ===');
for (const [lo, hi] of [[0,15],[15,20],[20,25],[25,35],[35,50],[50,80],[80,9999]]) line(`${lo}-${hi} bars`, rows.filter((r) => bars(r) >= lo && bars(r) < hi));
console.log('\n=== under 25 bars vs the studied pool ===');
line('under 25 bars', rows.filter((r) => bars(r) < 25));
line('25 bars and over', rows.filter((r) => bars(r) >= 25));
console.log('\n=== short bases, by decade ===');
for (let d = 1990; d <= 2020; d += 10) { const D = rows.filter((r) => r.year >= d && r.year < d + 10); if (!D.length) continue;
  line(`${d}s under 25 bars`, D.filter((r) => bars(r) < 25)); line(`${d}s 25+`, D.filter((r) => bars(r) >= 25)); }
console.log('\n=== short base + RSKD extras ===');
const short = rows.filter((r) => bars(r) < 25);
line('short & bar>=6%', short.filter((r) => r.barGain >= 6));
line('short & clear<1%', short.filter((r) => r.clear < 1));
line('short & bar>=6% & clear<1%', short.filter((r) => r.barGain >= 6 && r.clear < 1));
line('short & vr>=2', short.filter((r) => r.vr >= 2));
line('short & depth>=14%', short.filter((r) => r.depth >= 14));
console.log('\n=== a possible floor: where does short stop hurting? ===');
for (const k of [10,12,14,16,18,20,25]) line(`>= ${k} bars`, rows.filter((r) => bars(r) >= k));
