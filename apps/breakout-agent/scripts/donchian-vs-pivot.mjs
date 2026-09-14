// Causal version: no base detector. At every bar the "base" is the highest
// high H of the trailing 250 bars that has not been closed above since; age =
// bars since H; depth = (H - min low since H) / H. Eligible when age >= 25,
// depth <= 25%, H is blue sky (>= 98% of the 252-bar high before it), close
// > 200MA, 100k+ avg volume. Donchian event: close > prior 20-bar high and
// close <= H. Pivot event: first close > H. Nothing is dropped after the fact.
import fs from 'fs';
const CACHE = './study-cache';
const startTs = Date.UTC(1985, 0, 1) / 1000;
const files = fs.readdirSync(CACHE).filter((f) => f.endsWith('.json') && !f.startsWith('^') && !f.startsWith('grade-') && !f.startsWith('minervini-'));
const load = (sym) => JSON.parse(fs.readFileSync(`${CACHE}/${sym}.json`, 'utf8')).filter((r) => Array.isArray(r) && r.length >= 6 && Number.isFinite(r[0]) && r[0] > 0 && r[0] < 4e9 && r.slice(1, 5).every((v) => Number.isFinite(v) && v > 0));
const don = [], piv = [];
let done = 0;
for (const f of files) {
  let a; try { a = load(f.slice(0, -5)); } catch { continue; }
  const n = a.length; if (n < 600) continue;
  const H = new Float64Array(n), L = new Float64Array(n), C = new Float64Array(n), V = new Float64Array(n);
  for (let i = 0; i < n; i++) { H[i] = a[i][2]; L[i] = a[i][3]; C[i] = a[i][4]; V[i] = a[i][5]; }
  const cs = new Float64Array(n + 1), vs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) { cs[i + 1] = cs[i] + C[i]; vs[i + 1] = vs[i] + V[i]; }
  // running base state
  let hIdx = 0, minLow = Infinity;
  for (let i = 1; i < n; i++) {
    // new pivot when the close clears the current H (or H is too old: reset to trailing max)
    if (C[i] > H[hIdx] || i - hIdx > 250) {
      const pivotEvent = C[i] > H[hIdx] && i - hIdx >= 25 && i - hIdx <= 250;
      if (pivotEvent && i >= 260 && i + 60 < n && a[i][0] >= startTs) {
        const depth = (H[hIdx] - minLow) / H[hIdx];
        let sky = 0; for (let k = Math.max(0, hIdx - 252); k < hIdx; k++) sky = Math.max(sky, H[k]);
        const ma200 = (cs[i + 1] - cs[i - 199]) / 200, av = (vs[i] - vs[i - 20]) / 20;
        if (depth <= 0.25 && H[hIdx] >= sky * 0.98 && C[i] > ma200 && av >= 100000) piv.push(out(i));
      }
      // new H = the highest high since... use the bar itself as the new pivot candidate
      hIdx = i; minLow = Infinity;
      // but if this bar isn't the highest high in the trailing 250, the true H is that
      let best = i; for (let k = Math.max(0, i - 250); k < i; k++) if (H[k] > H[best] && C[i] <= H[k]) best = k;
      if (best !== i) { hIdx = best; for (let k = best + 1; k <= i; k++) minLow = Math.min(minLow, L[k]); }
      continue;
    }
    if (H[i] > H[hIdx]) { hIdx = i; minLow = Infinity; continue; } // intrabar new high that closed under: pivot moves up
    minLow = Math.min(minLow, L[i]);
    const age = i - hIdx;
    if (age < 25 || i < 260 || i + 60 >= n || a[i][0] < startTs) continue;
    const depth = (H[hIdx] - minLow) / H[hIdx];
    if (depth > 0.25) continue;
    let h20 = 0; for (let k = i - 20; k < i; k++) h20 = Math.max(h20, H[k]);
    if (!(C[i] > h20)) continue;
    let sky = 0; for (let k = Math.max(0, hIdx - 252); k < hIdx; k++) sky = Math.max(sky, H[k]);
    if (H[hIdx] < sky * 0.98) continue;
    const ma200 = (cs[i + 1] - cs[i - 199]) / 200, av = (vs[i] - vs[i - 20]) / 20;
    if (!(C[i] > ma200) || av < 100000) continue;
    const o = out(i); o.gap = (H[hIdx] - C[i]) / C[i] * 100;
    // did the pivot clear within 60 bars?
    o.resolved = false; for (let k = i + 1; k <= i + 60; k++) if (C[k] > H[hIdx]) { o.resolved = true; break; }
    don.push(o);
  }
  function out(i) {
    const e = C[i]; let ml = Infinity, mc = -Infinity;
    for (let k = i + 1; k <= i + 20; k++) ml = Math.min(ml, L[k]);
    for (let k = i + 1; k <= i + 60; k++) mc = Math.max(mc, C[k]);
    return { year: new Date(a[i][0] * 1000).getUTCFullYear(), ret20: (C[i + 20] - e) / e * 100, ret60: (C[i + 60] - e) / e * 100, stopped: ml <= e * 0.93, run60: (mc - e) / e * 100 };
  }
  if (++done % 1000 === 0) console.log(`${done}/${files.length} don=${don.length} piv=${piv.length}`);
}
const agg = (rs) => {
  const n = rs.length; if (!n) return 'n=0';
  const m = (k) => rs.reduce((s, r) => s + r[k], 0) / n;
  const pf = (() => { let g = 0, l = 0; for (const r of rs) { const v = Math.max(r.ret20, -7); if (v > 0) g += v; else l -= v; } return l ? g / l : 99; })();
  return `n=${String(n).padStart(6)} win=${(rs.filter((r) => r.ret20 > 0).length / n * 100).toFixed(1)}% stop=${(rs.filter((r) => r.stopped).length / n * 100).toFixed(1)}% mean20=${m('ret20').toFixed(2)}% mean60=${m('ret60').toFixed(2)}% reach+20=${(rs.filter((r) => r.run60 >= 20).length / n * 100).toFixed(1)}% PF=${pf.toFixed(2)}`;
};
console.log('\n=== Causal, nothing dropped ===');
console.log('Donchian 20d-high close inside base'.padEnd(40), agg(don));
console.log('Close above the base pivot         '.padEnd(40), agg(piv));
console.log(`Donchian: resolved within 60 bars ${(don.filter((r) => r.resolved).length / don.length * 100).toFixed(1)}%`);
console.log('resolved'.padEnd(40), agg(don.filter((r) => r.resolved)));
console.log('never resolved'.padEnd(40), agg(don.filter((r) => !r.resolved)));
for (const [lo, hi] of [[0, 2], [2, 5], [5, 10], [10, 99]]) console.log(`don ${lo}-${hi}% under pivot`.padEnd(40), agg(don.filter((r) => r.gap >= lo && r.gap < hi)));
for (let d = 1980; d <= 2020; d += 10) {
  console.log(`${d}s donchian`.padEnd(40), agg(don.filter((r) => r.year >= d && r.year < d + 10)));
  console.log(`${d}s pivot   `.padEnd(40), agg(piv.filter((r) => r.year >= d && r.year < d + 10)));
}
