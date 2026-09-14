// Minervini rule study on the full-history cache.
// Pass 1: cross-sectional RS percentiles and breadth per date.
// Pass 2: replay base-detect; for every graded breakout compute the rules he
// repeats on X (trend template, RS rank, right-side shape, tightness, gap,
// breadth regime) and 20/60-bar outcomes.
import fs from 'fs';
import { detectBases } from '../base-detect.js';

const CACHE = './study-cache';
const OUT = `${CACHE}/minervini-rows.json`;
const MIN_AVG_VOL = 100_000;
const START_YEAR = 1985;
const startTs = Date.UTC(START_YEAR, 0, 1) / 1000;

const files = fs.readdirSync(CACHE).filter((f) => f.endsWith('.json') && !f.startsWith('^') && !f.startsWith('grade-') && !f.startsWith('minervini-'));
const dayOf = (ts) => Math.floor(ts / 86400);

function loadCompact(sym) {
  const a = JSON.parse(fs.readFileSync(`${CACHE}/${sym}.json`, 'utf8'));
  return a.filter((r) => Array.isArray(r) && r.length >= 6 && Number.isFinite(r[0]) && r[0] > 0 && r[0] < 4e9 && r.slice(1, 5).every((v) => Number.isFinite(v) && v > 0));
}

// ── Pass 1 ──────────────────────────────────────────────────────────────────
const rsIbd = new Map(); // day -> number[]
const rsProd = new Map();
const br = new Map(); // day -> { n, a50, a200 }
function pass1() {
  let done = 0;
  for (const f of files) {
    const sym = f.slice(0, -5);
    let a; try { a = loadCompact(sym); } catch { continue; }
    const n = a.length; if (n < 300) continue;
    const c = new Float64Array(n); for (let i = 0; i < n; i++) c[i] = a[i][4];
    let s50 = 0, s200 = 0;
    for (let i = 0; i < n; i++) {
      s50 += c[i]; if (i >= 50) s50 -= c[i - 50];
      s200 += c[i]; if (i >= 200) s200 -= c[i - 200];
      if (i < 252 || a[i][0] < startTs) continue;
      const d = dayOf(a[i][0]);
      const q1 = c[i] / c[i - 63] - 1, q2 = c[i - 63] / c[i - 126] - 1, q3 = c[i - 126] / c[i - 189] - 1, q4 = c[i - 189] / c[i - 252] - 1;
      const ibd = 0.4 * q1 + 0.2 * (q2 + q3 + q4);
      const prod = 0.5 * q1 + 0.3 * (c[i] / c[i - 21] - 1) + 0.2 * (c[i] / c[i - 5] - 1);
      if (!Number.isFinite(ibd) || !Number.isFinite(prod)) continue;
      let arr = rsIbd.get(d); if (!arr) { arr = []; rsIbd.set(d, arr); } arr.push(ibd);
      let arr2 = rsProd.get(d); if (!arr2) { arr2 = []; rsProd.set(d, arr2); } arr2.push(prod);
      let b = br.get(d); if (!b) { b = { n: 0, a50: 0, a200: 0 }; br.set(d, b); }
      b.n++; if (c[i] > s50 / 50) b.a50++; if (c[i] > s200 / 200) b.a200++;
    }
    if (++done % 500 === 0) console.log(`pass1 ${done}/${files.length}`);
  }
  for (const m of [rsIbd, rsProd]) for (const arr of m.values()) arr.sort((x, y) => x - y);
  console.log(`pass1 done: ${rsIbd.size} dates`);
}
function pct(sorted, v) {
  if (!sorted || sorted.length < 50) return null;
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < v) lo = mid + 1; else hi = mid; }
  return Math.min(99, Math.max(1, Math.round((lo / sorted.length) * 99)));
}

// SPX regime
const spx = (() => {
  try {
    const a = loadCompact('^GSPC'); const m = new Map(); let s = 0;
    for (let i = 0; i < a.length; i++) { s += a[i][4]; if (i >= 200) s -= a[i - 200][4]; if (i >= 199) m.set(dayOf(a[i][0]), a[i][4] > s / 200); }
    return m;
  } catch { return new Map(); }
})();

// ── Pass 2 ──────────────────────────────────────────────────────────────────
function gradeOf(sky, baseBars, depth) {
  const goodShape = baseBars >= 25 && depth <= 25;
  if (sky && goodShape && depth <= 15) return 'A+';
  if (sky && goodShape) return 'A';
  return 'other';
}
const rows = [];
function pass2() {
  let done = 0;
  for (const f of files) {
    const sym = f.slice(0, -5);
    let a; try { a = loadCompact(sym); } catch { continue; }
    const n = a.length; if (n < 300) continue;
    try {
    const bars = a.map((r) => ({ time: new Date(r[0] * 1000).toISOString().slice(0, 10), open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }));
    const idx = new Map(); for (let i = 0; i < n; i++) idx.set(bars[i].time, i);
    // prefix sums for MAs and volume
    const cs = new Float64Array(n + 1), vs = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) { cs[i + 1] = cs[i] + bars[i].close; vs[i + 1] = vs[i] + bars[i].volume; }
    const sma = (i, k) => (i + 1 >= k ? (cs[i + 1] - cs[i + 1 - k]) / k : null);
    let bases; try { bases = detectBases(bars); } catch { continue; }
    for (const base of bases) {
      if (!base.breakout) continue;
      const pIdx = idx.get(base.pivotDate), i = idx.get(base.breakout.date);
      if (pIdx == null || i == null || i + 60 >= n || i < 260 || a[i][0] < startTs) continue;
      const ma200 = sma(i, 200), ma150 = sma(i, 150), ma50 = sma(i, 50), ma200p = sma(i - 21, 200);
      const av = (vs[i] - vs[i - 20]) / 20;
      if (av < MIN_AVG_VOL) continue;
      const b = bars[i];
      if (!(b.close > ma200)) continue;
      const pivot = bars[pIdx].high;
      let h252 = 0, l252 = Infinity;
      for (let k = Math.max(0, i - 251); k <= i; k++) { if (bars[k].high > h252) h252 = bars[k].high; if (bars[k].low < l252) l252 = bars[k].low; }
      let skyAt = 0; for (let k = Math.max(0, pIdx - 251); k <= pIdx; k++) if (bars[k].high > skyAt) skyAt = bars[k].high;
      const sky = pivot >= skyAt * 0.98;
      const grade = gradeOf(sky, base.bars, base.depthPct);
      if (grade === 'other') continue;
      // base low position
      let lowIdx = pIdx + 1; for (let k = pIdx + 1; k < i; k++) if (bars[k].low < bars[lowIdx].low) lowIdx = k;
      const rightBars = i - lowIdx, leftBars = lowIdx - pIdx;
      // final contraction: range of the 10 bars before the breakout bar
      let hh = 0, ll = Infinity; for (let k = i - 10; k < i; k++) { hh = Math.max(hh, bars[k].high); ll = Math.min(ll, bars[k].low); }
      const tight10 = ((hh - ll) / pivot) * 100;
      const gapPct = ((b.open - bars[i - 1].close) / bars[i - 1].close) * 100;
      const closePos = b.high > b.low ? (b.close - b.low) / (b.high - b.low) : 1;
      const entry = b.close;
      let minLow = Infinity, maxC60 = -Infinity;
      for (let k = i + 1; k <= i + 20; k++) minLow = Math.min(minLow, bars[k].low);
      for (let k = i + 1; k <= i + 60; k++) maxC60 = Math.max(maxC60, bars[k].close);
      const d = dayOf(a[i][0]);
      const q1 = b.close / bars[i - 63].close - 1, q2 = bars[i - 63].close / bars[i - 126].close - 1, q3 = bars[i - 126].close / bars[i - 189].close - 1, q4 = bars[i - 189].close / bars[i - 252].close - 1;
      const ibd = 0.4 * q1 + 0.2 * (q2 + q3 + q4);
      const prod = 0.5 * q1 + 0.3 * (b.close / bars[i - 21].close - 1) + 0.2 * (b.close / bars[i - 5].close - 1);
      const bd = br.get(d);
      rows.push({
        sym, date: b.time, year: +b.time.slice(0, 4), grade, baseBars: base.bars, depth: base.depthPct,
        vr: +(b.volume / av).toFixed(2),
        // trend template
        a150: b.close > ma150, m150g200: ma150 > ma200, m200up: ma200p != null && ma200 > ma200p, m50g150: ma50 > ma150,
        aboveLow: +((b.close / l252 - 1) * 100).toFixed(1), distHigh: +(((h252 - b.close) / h252) * 100).toFixed(1),
        rs: pct(rsIbd.get(d), ibd), rsp: pct(rsProd.get(d), prod),
        rightBars, leftBars, lateLow: rightBars <= Math.floor(base.bars / 3), vshape: +(base.depthPct / Math.max(1, rightBars)).toFixed(2),
        tight10: +tight10.toFixed(1), gap: +gapPct.toFixed(1), closePos: +closePos.toFixed(2),
        b50: bd ? +((bd.a50 / bd.n) * 100).toFixed(0) : null, b200: bd ? +((bd.a200 / bd.n) * 100).toFixed(0) : null, spx: spx.get(d) ?? null,
        ret20: +(((bars[i + 20].close - entry) / entry) * 100).toFixed(2), ret60: +(((bars[i + 60].close - entry) / entry) * 100).toFixed(2),
        stopped: minLow <= entry * 0.93, run60: +(((maxC60 - entry) / entry) * 100).toFixed(2),
      });
    }
    } catch (e) { console.log(`skip ${sym}: ${e.message}`); }
    if (++done % 500 === 0) console.log(`pass2 ${done}/${files.length} rows=${rows.length}`);
  }
}

pass1();
pass2();
fs.writeFileSync(OUT, JSON.stringify(rows));
console.log(`saved ${rows.length} rows -> ${OUT}`);
