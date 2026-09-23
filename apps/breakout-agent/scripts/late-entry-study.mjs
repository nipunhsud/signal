// The grace day: what a breakout is worth when you buy it the session AFTER
// the bar that cleared the pivot.
//
// brokeOutToday deliberately stays true for one extra session, so a breakout
// the 16:00 scan missed on a pre-auction quote still emails the next day. The
// entry in that email is the pivot, whatever price has done overnight. TWLO
// 2026-09-22 emailed at $279.33 with an entry of $258.35 and a fail level of
// $240.27, 13.6% under the price in the email.
//
// Measured: the same graded pool, entered at the NEXT bar's close instead of
// the breakout close, bucketed by how far that next close sits past the pivot.
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
      if (s == null || i == null || i + 61 >= n || i < 260) continue;
      if (base.bars < 25 || base.depthPct > 25) continue;
      if ((vs[i] - vs[i - 20]) / 20 < 100_000) continue;
      if (!(bars[i].close > sma(i, 200))) continue;
      let skyAt = 0; for (let k = Math.max(0, s - 251); k <= s; k++) if (bars[k].high > skyAt) skyAt = bars[k].high;
      if (!(bars[s].high >= skyAt * 0.98)) continue;

      const j = i + 1;                       // the grace day
      const onTime = bars[i].close, late = bars[j].close;
      if (!(late > base.pivot)) continue;    // the grace alert only fires above the pivot
      const outcome = (entry, from) => {
        let minLow = Infinity, maxC = -Infinity;
        for (let k = from + 1; k <= from + 20; k++) minLow = Math.min(minLow, bars[k].low);
        for (let k = from + 1; k <= from + 60; k++) maxC = Math.max(maxC, bars[k].close);
        return { ret20: ((bars[from + 20].close - entry) / entry) * 100, stopped: minLow <= entry * 0.93, run60: ((maxC - entry) / entry) * 100 };
      };
      const A = outcome(onTime, i), B = outcome(late, j);
      rows.push({
        sym, date: bars[i].time,
        clearOn: +(((onTime - base.pivot) / base.pivot) * 100).toFixed(2),
        clearLate: +(((late - base.pivot) / base.pivot) * 100).toFixed(2),
        gap: +(((late - onTime) / onTime) * 100).toFixed(2),
        onRet: +A.ret20.toFixed(2), onStop: A.stopped, onRun: +A.run60.toFixed(2),
        lateRet: +B.ret20.toFixed(2), lateStop: B.stopped, lateRun: +B.run60.toFixed(2),
      });
    }
  } catch { /* skip */ }
  if (++done % 800 === 0) console.log(`${done}/${files.length} rows=${rows.length}`);
}
fs.writeFileSync(`${CACHE}/late-rows.json`, JSON.stringify(rows));

const agg = (rs, p) => { const n = rs.length; if (!n) return 'n=0';
  const R = `${p}Ret`, S = `${p}Stop`, U = `${p}Run`;
  const w = rs.filter((r) => r[R] > 0).length, s = rs.filter((r) => r[S]).length;
  const m = rs.reduce((a, r) => a + r[R], 0) / n, hit = rs.filter((r) => r[U] >= 20).length;
  let g = 0, l = 0; for (const r of rs) { const v = Math.max(r[R], -7); v > 0 ? g += v : l -= v; }
  return `n=${String(n).padStart(5)} win=${(w / n * 100).toFixed(1)}% stop=${(s / n * 100).toFixed(1)}% mean20=${m.toFixed(2)}% reach=${(hit / n * 100).toFixed(1)}% PF=${(l ? g / l : 99).toFixed(2)}`; };
const pair = (label, rs) => { console.log(label.padEnd(30), 'on the bar  ', agg(rs, 'on')); console.log(''.padEnd(30), 'a day late  ', agg(rs, 'late')); };
console.log(`\npool ${rows.length}\n`);
pair('ALL', rows);
console.log('\n=== by how far the GRACE-DAY close sits past the pivot ===');
for (const [lo, hi] of [[0, 2], [2, 4], [4, 6], [6, 8], [8, 12], [12, 999]]) pair(`grace close ${lo}-${hi}% past`, rows.filter((r) => r.clearLate >= lo && r.clearLate < hi));
console.log('\n=== what the extra day costs, by bucket ===');
for (const [lo, hi] of [[0, 2], [2, 4], [4, 6], [6, 8], [8, 12], [12, 999]]) {
  const rs = rows.filter((r) => r.clearLate >= lo && r.clearLate < hi); if (!rs.length) continue;
  const f = (k) => rs.filter((r) => r[k]).length / rs.length * 100;
  console.log(`  ${String(lo + '-' + hi + '%').padEnd(10)} n=${String(rs.length).padStart(5)}  fail touch ${f('onStop').toFixed(1)}% -> ${f('lateStop').toFixed(1)}%   mean20 ${(rs.reduce((a, r) => a + r.onRet, 0) / rs.length).toFixed(2)}% -> ${(rs.reduce((a, r) => a + r.lateRet, 0) / rs.length).toFixed(2)}%`);
}
