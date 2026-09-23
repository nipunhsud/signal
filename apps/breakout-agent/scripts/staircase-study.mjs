// Stacked bases, judged only on what was knowable at the time.
//
// A staircase is a base that forms on top of a recent breakout. The question
// is whether the step matters: is a second step up worth more when the first
// step is still working, and worth less when the first step has already gone
// red? The earlier cut compared the prior breakout's 60-bar return, which
// overlaps the new breakout and so partly knows the answer. This one asks
// only what the screen knows on the morning of the new breakout: is price
// still above the prior breakout's close, and has it already touched the
// prior fail level?
import fs from 'fs';
import { detectBases } from '../base-detect.js';

const CACHE = './study-cache';
const files = fs.readdirSync(CACHE).filter((f) => f.endsWith('.json') && !f.startsWith('^') && !/^(grade|minervini|accumulation|depth|bar|stair)-/.test(f) && !['SPY', 'QQQ'].includes(f.slice(0, -5)));
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

    const passing = [];
    for (const base of bases) {
      if (!base.breakout) continue;
      const pIdx = idx.get(base.pivotDate), i = idx.get(base.breakout.date);
      if (pIdx == null || i == null || i + 60 >= n || i < 260) continue;
      if (base.bars < 25 || base.depthPct > 25) continue;
      if ((vs[i] - vs[i - 20]) / 20 < 100_000) continue;
      if (!(bars[i].close > sma(i, 200))) continue;
      let skyAt = 0; for (let k = Math.max(0, pIdx - 251); k <= pIdx; k++) if (bars[k].high > skyAt) skyAt = bars[k].high;
      if (!(bars[pIdx].high >= skyAt * 0.98)) continue;
      passing.push({ i, base });
    }

    for (let p = 0; p < passing.length; p++) {
      const { i, base } = passing[p];
      const prev = p > 0 ? passing[p - 1] : null;
      const b = bars[i], entry = b.close;
      // What the screen knows this morning about the previous step
      let stepAge = null, aboveStep = null, stepFailed = null;
      if (prev) {
        stepAge = i - prev.i;
        const pEntry = bars[prev.i].close, pFail = pEntry * 0.93;
        aboveStep = entry > pEntry;
        stepFailed = false;
        for (let k = prev.i + 1; k < i; k++) if (bars[k].low <= pFail) { stepFailed = true; break; }
      }
      let minLow = Infinity, maxC60 = -Infinity;
      for (let k = i + 1; k <= i + 20; k++) minLow = Math.min(minLow, bars[k].low);
      for (let k = i + 1; k <= i + 60; k++) maxC60 = Math.max(maxC60, bars[k].close);
      rows.push({
        sym, date: b.time, stepAge, aboveStep, stepFailed,
        barGain: +(((b.close - bars[i - 1].close) / bars[i - 1].close) * 100).toFixed(2),
        clear: +(((b.close - base.pivot) / base.pivot) * 100).toFixed(2),
        ret20: +(((bars[i + 20].close - entry) / entry) * 100).toFixed(2),
        ret60: +(((bars[i + 60].close - entry) / entry) * 100).toFixed(2),
        stopped: minLow <= entry * 0.93,
        run60: +(((maxC60 - entry) / entry) * 100).toFixed(2),
      });
    }
  } catch { /* skip */ }
  if (++done % 800 === 0) console.log(`${done}/${files.length} rows=${rows.length}`);
}
fs.writeFileSync(`${CACHE}/stair-rows.json`, JSON.stringify(rows));

const agg = (rs) => { const n = rs.length; if (!n) return 'n=0';
  const w = rs.filter((r) => r.ret20 > 0).length, s = rs.filter((r) => r.stopped).length;
  const m = (k) => rs.reduce((a, r) => a + r[k], 0) / n, hit = rs.filter((r) => r.run60 >= 20).length;
  let g = 0, l = 0; for (const r of rs) { const v = Math.max(r.ret20, -7); v > 0 ? g += v : l -= v; }
  return `n=${String(n).padStart(5)} win=${(w / n * 100).toFixed(1)}% stop=${(s / n * 100).toFixed(1)}% mean60=${m('ret60').toFixed(2)}% reach=${(hit / n * 100).toFixed(1)}% PF=${(l ? g / l : 99).toFixed(2)}`; };
const line = (l, rs) => console.log(l.padEnd(40), agg(rs));
console.log(`\npool ${rows.length}\n`);
line('ALL', rows);
line('no prior step in the data', rows.filter((r) => r.stepAge == null));
const near = rows.filter((r) => r.stepAge != null && r.stepAge <= 120);
console.log('\n=== a step within 120 bars of the last one ===');
line('stacked, all', near);
line('  still above the prior step', near.filter((r) => r.aboveStep));
line('  back under the prior step', near.filter((r) => !r.aboveStep));
line('  prior step never hit its fail', near.filter((r) => !r.stepFailed));
line('  prior step hit its fail level', near.filter((r) => r.stepFailed));
console.log('\n=== the two cleanly separated ===');
line('above prior & prior never failed', near.filter((r) => r.aboveStep && !r.stepFailed));
line('under prior or prior failed', near.filter((r) => !r.aboveStep || r.stepFailed));
console.log('\n=== step age ===');
for (const [lo, hi] of [[0, 40], [40, 60], [60, 90], [90, 120]]) line(`step ${lo}-${hi} bars apart`, rows.filter((r) => r.stepAge >= lo && r.stepAge < hi));
console.log('\n=== RSKD shape: stacked, prior step already failed, big bar, marginal clear ===');
line('prior failed & bar>=6%', near.filter((r) => r.stepFailed && r.barGain >= 6));
line('prior failed & clear<1%', near.filter((r) => r.stepFailed && r.clear < 1));
line('prior ok & bar>=6%', near.filter((r) => !r.stepFailed && r.aboveStep && r.barGain >= 6));
