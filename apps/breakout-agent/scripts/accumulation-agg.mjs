// Tables for the tape accumulation study (see accumulation-study.mjs).
import fs from 'fs';
const rows = JSON.parse(fs.readFileSync('./study-cache/accumulation-rows.json', 'utf8'));
const agg = (rs) => {
  const n = rs.length; if (!n) return 'n=0';
  const w = rs.filter((r) => r.ret20 > 0).length, s = rs.filter((r) => r.stopped).length;
  const m = (k) => rs.reduce((a, r) => a + r[k], 0) / n;
  const hit20 = rs.filter((r) => r.run60 >= 20).length;
  const pf = (() => { let g = 0, l = 0; for (const r of rs) { const v = Math.max(r.ret20, -7); if (v > 0) g += v; else l -= v; } return l ? g / l : 99; })();
  return `n=${String(n).padStart(6)} win=${(w / n * 100).toFixed(1)}% stop=${(s / n * 100).toFixed(1)}% mean20=${m('ret20').toFixed(2)}% mean60=${m('ret60').toFixed(2)}% hit+20%=${(hit20 / n * 100).toFixed(1)}% PF=${pf.toFixed(2)}`;
};
const line = (label, rs) => console.log(label.padEnd(34), agg(rs));
const aa = rows;
console.log(`rows=${rows.length}  years ${Math.min(...rows.map(r=>r.year))}-${Math.max(...rows.map(r=>r.year))}`);
line('ALL A+/A', aa);

console.log('\n=== Net accumulation days (acc - dist) in the 50 sessions before the breakout ===');
for (const [lo, hi] of [[-99, -3], [-2, -1], [0, 0], [1, 2], [3, 4], [5, 99]]) line(`net ${lo}..${hi}`, aa.filter((r) => r.net >= lo && r.net <= hi));
console.log('--- accumulation days alone ---');
for (const [lo, hi] of [[0, 0], [1, 2], [3, 4], [5, 7], [8, 99]]) line(`acc ${lo}..${hi}`, aa.filter((r) => r.acc >= lo && r.acc <= hi));
console.log('--- distribution days alone ---');
for (const [lo, hi] of [[0, 0], [1, 2], [3, 4], [5, 99]]) line(`dist ${lo}..${hi}`, aa.filter((r) => r.dist >= lo && r.dist <= hi));

console.log('\n=== Big institutional prints: >=2% up on >=2x volume within 5% of the 52w high, 50 sessions ===');
for (const [lo, hi] of [[0, 0], [1, 1], [2, 2], [3, 4], [5, 99]]) line(`bigUp ${lo}..${hi}`, aa.filter((r) => r.bigUp >= lo && r.bigUp <= hi));

console.log('\n=== Base up/down volume ratio ===');
for (const [lo, hi] of [[0, 0.8], [0.8, 1], [1, 1.25], [1.25, 1.5], [1.5, 2], [2, 99]]) line(`udv ${lo}-${hi}`, aa.filter((r) => r.udv >= lo && r.udv < hi));

console.log('\n=== OBV drift across the base (share of base volume) ===');
for (const [lo, hi] of [[-2, -0.2], [-0.2, -0.05], [-0.05, 0.05], [0.05, 0.2], [0.2, 2]]) line(`obv ${lo}..${hi}`, aa.filter((r) => r.obv >= lo && r.obv < hi));

console.log('\n=== Volume dry-up in the base (base avg / prior 50) — reference ===');
for (const [lo, hi] of [[0, 0.7], [0.7, 0.9], [0.9, 1.1], [1.1, 1.5], [1.5, 99]]) line(`dry ${lo}-${hi}`, aa.filter((r) => r.dry >= lo && r.dry < hi));

// Composite: points for each footprint, 0..10.
const score = (r) => {
  let p = 0;
  p += r.net >= 5 ? 3 : r.net >= 3 ? 2 : r.net >= 1 ? 1 : 0;
  p += r.bigUp >= 3 ? 3 : r.bigUp >= 2 ? 2 : r.bigUp >= 1 ? 1 : 0;
  p += r.udv >= 2 ? 2 : r.udv >= 1.5 ? 1 : 0;
  p += r.obv >= 0.2 ? 2 : r.obv >= 0.05 ? 1 : 0;
  return p;
};
for (const r of aa) r.score = score(r);
console.log('\n=== Composite accumulation score 0..10 ===');
for (const [lo, hi] of [[0, 0], [1, 2], [3, 4], [5, 6], [7, 10]]) line(`score ${lo}..${hi}`, aa.filter((r) => r.score >= lo && r.score <= hi));

console.log('\n=== Controlled for RS (the known lever) ===');
for (const [rlo, rhi] of [[1, 69], [70, 88], [89, 99]]) {
  const inR = aa.filter((r) => r.rs != null && r.rs >= rlo && r.rs <= rhi);
  line(`rs ${rlo}-${rhi} · score 0-2`, inR.filter((r) => r.score <= 2));
  line(`rs ${rlo}-${rhi} · score 3-4`, inR.filter((r) => r.score >= 3 && r.score <= 4));
  line(`rs ${rlo}-${rhi} · score 5+`, inR.filter((r) => r.score >= 5));
}

console.log('\n=== Per decade: score 5+ vs 0-2 ===');
for (let d = 1980; d <= 2020; d += 10) {
  const inD = aa.filter((r) => r.year >= d && r.year < d + 10);
  line(`${d}s score 5+`, inD.filter((r) => r.score >= 5)); line(`${d}s score 0-2`, inD.filter((r) => r.score <= 2));
}
console.log('\n=== Volume tag reference ===');
line('quiet <1.2x', aa.filter((r) => r.vr < 1.2)); line('confirmed 1.2-2x', aa.filter((r) => r.vr >= 1.2 && r.vr < 2)); line('power >=2x', aa.filter((r) => r.vr >= 2));
line('score 5+ & power', aa.filter((r) => r.score >= 5 && r.vr >= 2)); line('score 0-2 & quiet', aa.filter((r) => r.score <= 2 && r.vr < 1.2));
