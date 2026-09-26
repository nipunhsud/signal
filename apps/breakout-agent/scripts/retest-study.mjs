// A fresh breakout, a retest, or a failure — which is which, and which pays.
//
// HPE on 2026-09-25 raised it. It closed above its $63.44 pivot on the 24th,
// ran to $65.65 the next morning and closed back at $62.94, under the pivot
// again. The screen calls that a retest. Is a retest a better entry than the
// breakout was, or a worse one?
//
// Three things can happen after a base resolves, and every breakout is exactly
// one of them inside a 20-session window:
//
//   CLEAN    it never closes back under the pivot
//   RETEST   it closes back under, then closes above it again
//   FAILED   it closes back under and never recovers the pivot
//
// Each is scored from its own entry at its own close, so the retest is judged
// on the price you would actually pay to take it — the re-clear, not the
// original breakout.
import fs from 'fs';
import { detectBases } from '../base-detect.js';

const CACHE = './study-cache';
const WINDOW = 20;   // sessions after the breakout in which the story has to resolve
const files = fs.readdirSync(CACHE).filter((f) => f.endsWith('.json') && !f.startsWith('^') && !/-(rows|study|agg)\.json$/.test(f) && !/^(META|market-health|sectors)\.json$/.test(f));
const load = (sym) => JSON.parse(fs.readFileSync(`${CACHE}/${sym}.json`, 'utf8')).filter((r) => Array.isArray(r) && r.length >= 6 && Number.isFinite(r[0]) && r[0] > 0 && r[0] < 4e9 && r.slice(1, 5).every((v) => Number.isFinite(v) && v > 0));

const rows = [];
let done = 0;
for (const f of files) {
  const sym = f.slice(0, -5);
  let a; try { a = load(sym); } catch { continue; }
  const n = a.length; if (n < 340) continue;
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
      if (p == null || i == null || i + WINDOW + 60 >= n || i < 260) continue;
      const avgVolume = (vs[i] - vs[i - 20]) / 20;
      if (!(avgVolume * bars[i].close >= 750_000)) continue;      // the shipped floor
      const ma200 = sma(i, 200), ma200Prev = sma(i - 1, 200);
      if (!(bars[i].close > ma200 && ma200 > ma200Prev)) continue;
      if (base.depthPct > 25) continue;
      let skyAt = 0; for (let k = Math.max(0, p - 251); k <= p; k++) if (bars[k].high > skyAt) skyAt = bars[k].high;
      if (!(bars[p].high >= skyAt * 0.98)) continue;

      const pivot = base.pivot;
      // Did it fall back under the pivot inside the window, and did it return?
      let fellAt = null, reclearAt = null;
      for (let k = i + 1; k <= i + WINDOW; k++) {
        if (fellAt == null) { if (bars[k].close < pivot) fellAt = k; }
        else if (bars[k].close > pivot) { reclearAt = k; break; }
      }
      const kind = fellAt == null ? 'clean' : reclearAt != null ? 'retest' : 'failed';

      const outcome = (entryIdx) => {
        const entry = bars[entryIdx].close;
        let minLow = Infinity, maxC = -Infinity;
        for (let k = entryIdx + 1; k <= entryIdx + 20; k++) minLow = Math.min(minLow, bars[k].low);
        for (let k = entryIdx + 1; k <= entryIdx + 60; k++) maxC = Math.max(maxC, bars[k].close);
        return { ret20: +(((bars[entryIdx + 20].close - entry) / entry) * 100).toFixed(2), stopped: minLow <= entry * 0.93, run60: +(((maxC - entry) / entry) * 100).toFixed(2) };
      };
      const atBreakout = outcome(i);
      const atRetest = reclearAt != null && reclearAt + 60 < n ? outcome(reclearAt) : null;
      rows.push({
        sym, date: base.breakout.date, year: +base.breakout.date.slice(0, 4), kind,
        depth: +base.depthPct.toFixed(1), bars: base.bars,
        vr: +(bars[i].volume / avgVolume).toFixed(2),
        clearPct: +(((bars[i].close - pivot) / pivot) * 100).toFixed(2),
        daysToFall: fellAt != null ? fellAt - i : null,
        daysToReclear: reclearAt != null ? reclearAt - i : null,
        dipPct: fellAt != null ? +(((Math.min(...bars.slice(i + 1, (reclearAt ?? i + WINDOW) + 1).map((b) => b.low)) - pivot) / pivot) * 100).toFixed(2) : null,
        bo: atBreakout, rt: atRetest,
      });
    }
  } catch { /* skip */ }
  if (++done % 800 === 0) console.log(`  ${done}/${files.length} rows=${rows.length}`);
}
fs.writeFileSync(`${CACHE}/retest-rows.json`, JSON.stringify(rows));

const agg = (rs, f) => { const n = rs.length; if (!n) return 'n=0';
  const o = rs.map(f).filter(Boolean); if (!o.length) return 'n=0';
  const w = o.filter((x) => x.ret20 > 0).length, st = o.filter((x) => x.stopped).length;
  const hit = o.filter((x) => x.run60 >= 20).length;
  let g = 0, l = 0; for (const x of o) { const v = Math.max(x.ret20, -7); v > 0 ? g += v : l -= v; }
  return `n=${String(o.length).padStart(6)} win=${(w / o.length * 100).toFixed(1)}% stop=${(st / o.length * 100).toFixed(1)}% reach=${(hit / o.length * 100).toFixed(1)}% PF=${(l ? g / l : 99).toFixed(2)}`; };
const line = (l, rs, f = (r) => r.bo) => console.log(l.padEnd(40), agg(rs, f));

const clean = rows.filter((r) => r.kind === 'clean');
const retest = rows.filter((r) => r.kind === 'retest');
const failed = rows.filter((r) => r.kind === 'failed');
console.log(`\npool ${rows.length}  ·  clean ${clean.length} (${(clean.length / rows.length * 100).toFixed(0)}%)  retest ${retest.length} (${(retest.length / rows.length * 100).toFixed(0)}%)  failed ${failed.length} (${(failed.length / rows.length * 100).toFixed(0)}%)\n`);

console.log('=== bought at the breakout close, by what happened next ===');
line('ALL breakouts', rows);
line('  CLEAN — never gave the pivot back', clean);
line('  RETEST — fell back, then recovered', retest);
line('  FAILED — fell back, never recovered', failed);

console.log('\n=== the retest as an entry you could actually take ===');
line('buying the original breakout', retest.filter((r) => r.rt));
line('buying the re-clear instead', retest.filter((r) => r.rt), (r) => r.rt);

console.log('\n=== what a retest costs you in time and drawdown ===');
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
console.log(`  median sessions to fall back:   ${med(retest.map((r) => r.daysToFall))}`);
console.log(`  median sessions to re-clear:    ${med(retest.map((r) => r.daysToReclear))}`);
console.log(`  median dip below the pivot:     ${med(retest.map((r) => r.dipPct)).toFixed(1)}%`);

console.log('\n=== does how it broke out predict which one it becomes? ===');
for (const [lo, hi] of [[0, 1], [1, 3], [3, 6], [6, 999]]) {
  const s = rows.filter((r) => r.clearPct >= lo && r.clearPct < hi);
  if (!s.length) continue;
  const pc = (k) => ((s.filter((r) => r.kind === k).length / s.length) * 100).toFixed(0);
  console.log(`  cleared by ${lo}-${hi}%`.padEnd(24), `clean ${pc('clean')}%  retest ${pc('retest')}%  failed ${pc('failed')}%`);
}
for (const [lo, hi] of [[0, 1.5], [1.5, 3], [3, 999]]) {
  const s = rows.filter((r) => r.vr >= lo && r.vr < hi);
  if (!s.length) continue;
  const pc = (k) => ((s.filter((r) => r.kind === k).length / s.length) * 100).toFixed(0);
  console.log(`  on ${lo}-${hi}x volume`.padEnd(24), `clean ${pc('clean')}%  retest ${pc('retest')}%  failed ${pc('failed')}%`);
}

console.log('\n=== by decade, the re-clear entry ===');
for (let y = 1990; y <= 2020; y += 10) {
  const D = retest.filter((r) => r.year >= y && r.year < y + 10 && r.rt); if (!D.length) continue;
  line(`  ${y}s re-clear`, D, (r) => r.rt);
  line(`  ${y}s clean breakout`, clean.filter((r) => r.year >= y && r.year < y + 10));
}
