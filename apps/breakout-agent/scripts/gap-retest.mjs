// Gap-retest entry (the DE Aug 20 -> Aug 27 -> Aug 31 shape), causal.
// Gap day g: open >= 4% above the prior close, closes up, volume >= 1.5x the
// 20-day average, close above the 200MA. Then within 15 bars a pullback of at
// least 2% from the highest close since g whose lows hold above the gap day's
// low. Trigger: the first bar after the pullback low that closes above the
// prior bar's high (still within 20 bars of g). Entry = that close.
// Also tagged: was the trigger inside a blue-sky base (pivot within 15% above,
// base 25+ bars old)? -- the graded-base context.
import fs from 'fs';
const CACHE = './study-cache';
const startTs = Date.UTC(1985, 0, 1) / 1000;
const files = fs.readdirSync(CACHE).filter((f) => f.endsWith('.json') && !f.startsWith('^') && !f.startsWith('grade-') && !f.startsWith('minervini-'));
const load = (sym) => JSON.parse(fs.readFileSync(`${CACHE}/${sym}.json`, 'utf8')).filter((r) => Array.isArray(r) && r.length >= 6 && Number.isFinite(r[0]) && r[0] > 0 && r[0] < 4e9 && r.slice(1, 5).every((v) => Number.isFinite(v) && v > 0));
const ev = [];
let done = 0;
for (const f of files) {
  let a; try { a = load(f.slice(0, -5)); } catch { continue; }
  const n = a.length; if (n < 600) continue;
  const O = new Float64Array(n), H = new Float64Array(n), L = new Float64Array(n), C = new Float64Array(n), V = new Float64Array(n);
  for (let i = 0; i < n; i++) { O[i] = a[i][1]; H[i] = a[i][2]; L[i] = a[i][3]; C[i] = a[i][4]; V[i] = a[i][5]; }
  const cs = new Float64Array(n + 1), vs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) { cs[i + 1] = cs[i] + C[i]; vs[i + 1] = vs[i] + V[i]; }
  for (let g = 260; g + 80 < n; g++) {
    if (a[g][0] < startTs) continue;
    const av = (vs[g] - vs[g - 20]) / 20; if (av < 100000) continue;
    if (!(O[g] >= C[g - 1] * 1.04) || !(C[g] > O[g]) || V[g] < av * 1.5) continue;
    if (!(C[g] > (cs[g + 1] - cs[g - 199]) / 200)) continue;
    // pullback search
    let maxC = C[g], lowIdx = -1, lowVal = Infinity, ok = true;
    for (let i = g + 1; i <= g + 15; i++) {
      if (L[i] < L[g]) { ok = false; break; } // gap failed
      if (C[i] > maxC) { maxC = C[i]; if (lowIdx >= 0 && (maxC - lowVal) / lowVal > 0.02) break; }
      if (i >= g + 2 && C[i] < lowVal && (maxC - C[i]) / maxC >= 0.02) { lowVal = C[i]; lowIdx = i; }
    }
    if (!ok || lowIdx < 0) continue;
    // trigger
    let t = -1;
    for (let i = lowIdx + 1; i <= g + 20 && i < n; i++) { if (L[i] < L[g]) break; if (C[i] > H[i - 1]) { t = i; break; } }
    if (t < 0 || t + 60 >= n) continue;
    const e = C[t]; let ml = Infinity, mc = -Infinity;
    for (let k = t + 1; k <= t + 20; k++) ml = Math.min(ml, L[k]);
    for (let k = t + 1; k <= t + 60; k++) mc = Math.max(mc, C[k]);
    // context: blue-sky base overhead within 15%?
    let hi250 = 0, hiIdx = -1; for (let k = Math.max(0, t - 250); k < t; k++) if (H[k] > hi250) { hi250 = H[k]; hiIdx = k; }
    let sky = 0; for (let k = Math.max(0, hiIdx - 252); k < hiIdx; k++) sky = Math.max(sky, H[k]);
    const underPivot = (hi250 - e) / e * 100;
    const inBase = e <= hi250 && underPivot <= 15 && t - hiIdx >= 25 && hi250 >= sky * 0.98;
    const newHigh = e > hi250;
    ev.push({ year: new Date(a[t][0] * 1000).getUTCFullYear(), ret20: (C[t + 20] - e) / e * 100, ret60: (C[t + 60] - e) / e * 100, stopped: ml <= e * 0.93, run60: (mc - e) / e * 100, inBase, newHigh, gapPct: (O[g] / C[g - 1] - 1) * 100, lag: t - g, pull: (maxC - lowVal) / maxC * 100 });
    g = t; // don't re-use the same gap
  }
  if (++done % 1000 === 0) console.log(`${done}/${files.length} ev=${ev.length}`);
}
const agg = (rs) => {
  const n = rs.length; if (!n) return 'n=0';
  const m = (k) => rs.reduce((s, r) => s + r[k], 0) / n;
  const pf = (() => { let g = 0, l = 0; for (const r of rs) { const v = Math.max(r.ret20, -7); if (v > 0) g += v; else l -= v; } return l ? g / l : 99; })();
  return `n=${String(n).padStart(6)} win=${(rs.filter((r) => r.ret20 > 0).length / n * 100).toFixed(1)}% stop=${(rs.filter((r) => r.stopped).length / n * 100).toFixed(1)}% mean20=${m('ret20').toFixed(2)}% mean60=${m('ret60').toFixed(2)}% reach+20=${(rs.filter((r) => r.run60 >= 20).length / n * 100).toFixed(1)}% PF=${pf.toFixed(2)}`;
};
console.log('\n=== Gap-retest entries (close-based pullback, low >= 2 bars after the gap) ===');
console.log('all'.padEnd(36), agg(ev));
console.log('inside blue-sky base (<=15% under)'.padEnd(36), agg(ev.filter((r) => r.inBase)));
console.log('already at new high'.padEnd(36), agg(ev.filter((r) => r.newHigh)));
console.log('neither'.padEnd(36), agg(ev.filter((r) => !r.inBase && !r.newHigh)));
for (const [lo, hi] of [[4, 6], [6, 10], [10, 99]]) console.log(`gap ${lo}-${hi}%`.padEnd(36), agg(ev.filter((r) => r.gapPct >= lo && r.gapPct < hi)));
for (const [lo, hi] of [[2, 4], [4, 7], [7, 99]]) console.log(`pullback ${lo}-${hi}%`.padEnd(36), agg(ev.filter((r) => r.pull >= lo && r.pull < hi)));
for (let d = 1980; d <= 2020; d += 10) console.log(`${d}s`.padEnd(36), agg(ev.filter((r) => r.year >= d && r.year < d + 10)));
console.log('reference: pivot close-above (causal) = n=24699 win=56.3% stop=27.1% mean20=0.87% mean60=2.66% reach+20=14.1% PF=1.91');
