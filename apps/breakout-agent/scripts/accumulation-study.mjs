// Tape accumulation study on the full-history cache: does the footprint of
// big buyers in price and volume, measured BEFORE a graded breakout, predict
// how the breakout goes? Same harness as minervini-study.mjs (RS pass, then
// a replay of base-detect over every symbol), new features:
//   accDays / distDays  accumulation and distribution days in the 50 sessions
//                       before the breakout: close up (down) >= 1% on volume
//                       >= 1.5x the trailing 50-day average
//   bigUp               up days >= 2% on >= 2x volume closing within 5% of the
//                       52-week high, same window (O'Neil's institutional print)
//   udv / dry           the base's up/down volume ratio and volume dry-up
//   obv                 on-balance-volume drift across the base, as a share of
//                       the base's total volume (-1..1)
//   vr                  breakout-bar volume vs the 20-day average
// Outcomes: 20/60-bar return from the breakout close, fail-level touch (7%)
// within 20 bars, best close within 60 bars.
import fs from 'fs';
import { detectBases } from '../base-detect.js';

const CACHE = './study-cache';
const OUT = `${CACHE}/accumulation-rows.json`;
const MIN_AVG_VOL = 100_000;
const START_YEAR = 1985;
const startTs = Date.UTC(START_YEAR, 0, 1) / 1000;
const files = fs.readdirSync(CACHE).filter((f) => f.endsWith('.json') && !f.startsWith('^') && !f.startsWith('grade-') && !f.startsWith('minervini-') && !f.startsWith('accumulation-'));
const dayOf = (ts) => Math.floor(ts / 86400);
function loadCompact(sym) {
  const a = JSON.parse(fs.readFileSync(`${CACHE}/${sym}.json`, 'utf8'));
  return a.filter((r) => Array.isArray(r) && r.length >= 6 && Number.isFinite(r[0]) && r[0] > 0 && r[0] < 4e9 && r.slice(1, 5).every((v) => Number.isFinite(v) && v > 0));
}

// RS percentiles per date (IBD-style), to control for relative strength.
const rsIbd = new Map();
(function pass1() {
  let done = 0;
  for (const f of files) {
    const sym = f.slice(0, -5);
    let a; try { a = loadCompact(sym); } catch { continue; }
    const n = a.length; if (n < 300) continue;
    for (let i = 252; i < n; i++) {
      if (a[i][0] < startTs) continue;
      const c = (k) => a[k][4];
      const ibd = 0.4 * (c(i) / c(i - 63) - 1) + 0.2 * ((c(i - 63) / c(i - 126) - 1) + (c(i - 126) / c(i - 189) - 1) + (c(i - 189) / c(i - 252) - 1));
      if (!Number.isFinite(ibd)) continue;
      const d = dayOf(a[i][0]);
      let arr = rsIbd.get(d); if (!arr) { arr = []; rsIbd.set(d, arr); } arr.push(ibd);
    }
    if (++done % 1000 === 0) console.log(`pass1 ${done}/${files.length}`);
  }
  for (const arr of rsIbd.values()) arr.sort((x, y) => x - y);
  console.log(`pass1 done: ${rsIbd.size} dates`);
})();
function pct(sorted, v) {
  if (!sorted || sorted.length < 50) return null;
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < v) lo = mid + 1; else hi = mid; }
  return Math.min(99, Math.max(1, Math.round((lo / sorted.length) * 99)));
}

function gradeOf(sky, baseBars, depth) {
  const goodShape = baseBars >= 25 && depth <= 25;
  if (sky && goodShape && depth <= 15) return 'A+';
  if (sky && goodShape) return 'A';
  return 'other';
}

const rows = [];
let done = 0;
for (const f of files) {
  const sym = f.slice(0, -5);
  let a; try { a = loadCompact(sym); } catch { continue; }
  const n = a.length; if (n < 300) continue;
  try {
    const bars = a.map((r) => ({ time: new Date(r[0] * 1000).toISOString().slice(0, 10), open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }));
    const idx = new Map(); for (let i = 0; i < n; i++) idx.set(bars[i].time, i);
    const cs = new Float64Array(n + 1), vs = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) { cs[i + 1] = cs[i] + bars[i].close; vs[i + 1] = vs[i] + bars[i].volume; }
    const sma = (i, k) => (i + 1 >= k ? (cs[i + 1] - cs[i + 1 - k]) / k : null);
    const avgVol = (i, k) => (i >= k ? (vs[i] - vs[i - k]) / k : null); // trailing k bars BEFORE i
    let bases; try { bases = detectBases(bars); } catch { continue; }
    for (const base of bases) {
      if (!base.breakout) continue;
      const pIdx = idx.get(base.pivotDate), i = idx.get(base.breakout.date);
      if (pIdx == null || i == null || i + 60 >= n || i < 320 || a[i][0] < startTs) continue;
      const ma200 = sma(i, 200);
      const av20 = (vs[i] - vs[i - 20]) / 20;
      if (av20 < MIN_AVG_VOL) continue;
      const b = bars[i];
      if (!(b.close > ma200)) continue;
      const pivot = bars[pIdx].high;
      let skyAt = 0; for (let k = Math.max(0, pIdx - 251); k <= pIdx; k++) if (bars[k].high > skyAt) skyAt = bars[k].high;
      const sky = pivot >= skyAt * 0.98;
      const grade = gradeOf(sky, base.bars, base.depthPct);
      if (grade === 'other') continue;

      // Accumulation / distribution days and big institutional prints, 50 sessions before the breakout.
      let acc = 0, dist = 0, bigUp = 0;
      let h252 = 0; for (let k = Math.max(0, i - 51 - 251); k < i - 51; k++) if (bars[k].high > h252) h252 = bars[k].high;
      for (let k = i - 50; k < i; k++) {
        h252 = Math.max(h252, bars[k - 1].high); // rolling 52-week high as of k-1... close enough: high up to the prior bar
        const ret = bars[k].close / bars[k - 1].close - 1;
        const av = avgVol(k, 50);
        if (!av) continue;
        const heavy = bars[k].volume >= av * 1.5;
        if (heavy && ret >= 0.01) acc++;
        if (heavy && ret <= -0.01) dist++;
        if (ret >= 0.02 && bars[k].volume >= av * 2 && bars[k].close >= h252 * 0.95) bigUp++;
      }
      // OBV drift across the base.
      let obv = 0, tot = 0;
      for (let k = pIdx + 1; k < i; k++) {
        const v = bars[k].volume; tot += v;
        if (bars[k].close > bars[k - 1].close) obv += v; else if (bars[k].close < bars[k - 1].close) obv -= v;
      }
      const obvDrift = tot ? obv / tot : 0;

      const entry = b.close;
      let minLow = Infinity, maxC60 = -Infinity;
      for (let k = i + 1; k <= i + 20; k++) minLow = Math.min(minLow, bars[k].low);
      for (let k = i + 1; k <= i + 60; k++) maxC60 = Math.max(maxC60, bars[k].close);
      const d = dayOf(a[i][0]);
      const c = (k) => bars[k].close;
      const ibd = 0.4 * (c(i) / c(i - 63) - 1) + 0.2 * ((c(i - 63) / c(i - 126) - 1) + (c(i - 126) / c(i - 189) - 1) + (c(i - 189) / c(i - 252) - 1));
      rows.push({
        sym, date: b.time, year: +b.time.slice(0, 4), grade, baseBars: base.bars, depth: base.depthPct,
        rs: pct(rsIbd.get(d), ibd),
        vr: +(b.volume / av20).toFixed(2),
        acc, dist, net: acc - dist, bigUp,
        udv: base.upDownVolumeRatio, dry: base.volumeDryUp, obv: +obvDrift.toFixed(3),
        ret20: +(((bars[i + 20].close - entry) / entry) * 100).toFixed(2),
        ret60: +(((bars[i + 60].close - entry) / entry) * 100).toFixed(2),
        stopped: minLow <= entry * 0.93,
        run60: +(((maxC60 - entry) / entry) * 100).toFixed(2),
      });
    }
  } catch (e) { console.log(`skip ${sym}: ${e.message}`); }
  if (++done % 500 === 0) console.log(`pass2 ${done}/${files.length} rows=${rows.length}`);
}
fs.writeFileSync(OUT, JSON.stringify(rows));
console.log(`saved ${rows.length} rows -> ${OUT}`);
