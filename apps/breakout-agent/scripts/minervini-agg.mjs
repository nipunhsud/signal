import fs from 'fs';
const rows = JSON.parse(fs.readFileSync('./study-cache/minervini-rows.json', 'utf8'));
const agg = (rs) => {
  const n = rs.length; if (!n) return 'n=0';
  const w = rs.filter((r) => r.ret20 > 0).length, s = rs.filter((r) => r.stopped).length;
  const m = (k) => rs.reduce((a, r) => a + r[k], 0) / n;
  const hit20 = rs.filter((r) => r.run60 >= 20).length;
  const med = rs.map((r) => r.ret20).sort((a, b) => a - b)[Math.floor(n / 2)];
  const pf = (() => { let g = 0, l = 0; for (const r of rs) { const v = Math.max(r.ret20, -7); if (v > 0) g += v; else l -= v; } return l ? g / l : 99; })();
  return `n=${String(n).padStart(6)} win=${(w / n * 100).toFixed(1)}% stop=${(s / n * 100).toFixed(1)}% mean20=${m('ret20').toFixed(2)}% med=${med.toFixed(2)}% mean60=${m('ret60').toFixed(2)}% hit+20%=${(hit20 / n * 100).toFixed(1)}% PF=${pf.toFixed(2)}`;
};
const line = (label, rs) => console.log(label.padEnd(30), agg(rs));
const aa = rows.filter((r) => r.grade === 'A+' || r.grade === 'A');
console.log(`rows=${rows.length}  A+/A pool=${aa.length}  years ${Math.min(...rows.map(r=>r.year))}-${Math.max(...rows.map(r=>r.year))}`);
line('ALL A+/A', aa); line('A+', aa.filter((r) => r.grade === 'A+')); line('A', aa.filter((r) => r.grade === 'A'));

console.log('\n=== RS percentile (IBD-style 12m weighted) ===');
for (const [lo, hi] of [[1, 49], [50, 69], [70, 79], [80, 88], [89, 94], [95, 99]]) line(`rs ${lo}-${hi}`, aa.filter((r) => r.rs != null && r.rs >= lo && r.rs <= hi));
line('rs null', aa.filter((r) => r.rs == null));
console.log('--- product-style rs (3m/1m/1w) ---');
for (const [lo, hi] of [[1, 49], [50, 69], [70, 79], [80, 88], [89, 99]]) line(`rsp ${lo}-${hi}`, aa.filter((r) => r.rsp != null && r.rsp >= lo && r.rsp <= hi));

console.log('\n=== Trend template components ===');
line('close>150MA', aa.filter((r) => r.a150)); line('close<=150MA', aa.filter((r) => !r.a150));
line('150>200', aa.filter((r) => r.m150g200)); line('150<=200', aa.filter((r) => !r.m150g200));
line('200MA rising 1m', aa.filter((r) => r.m200up)); line('200MA not rising', aa.filter((r) => !r.m200up));
line('50>150', aa.filter((r) => r.m50g150)); line('50<=150', aa.filter((r) => !r.m50g150));
line('>=30% above 52w low', aa.filter((r) => r.aboveLow >= 30)); line('<30% above 52w low', aa.filter((r) => r.aboveLow < 30));
line('within 25% of 52wH', aa.filter((r) => r.distHigh <= 25)); line('further than 25%', aa.filter((r) => r.distHigh > 25));
const tt = (r) => r.a150 && r.m150g200 && r.m200up && r.m50g150 && r.aboveLow >= 30 && r.distHigh <= 25;
line('TT full (ex RS)', aa.filter(tt)); line('TT fails', aa.filter((r) => !tt(r)));
line('TT full + rs>=70', aa.filter((r) => tt(r) && r.rs >= 70)); line('TT full + rs>=89', aa.filter((r) => tt(r) && r.rs >= 89));
line('TT full + rs<70', aa.filter((r) => tt(r) && r.rs != null && r.rs < 70));
const ttCore = (r) => r.a150 && r.m150g200 && r.m200up && r.m50g150;
line('TT core (MAs only)', aa.filter(ttCore)); line('TT core fails', aa.filter((r) => !ttCore(r)));

console.log('\n=== Right side shape (bars from base low to breakout) ===');
for (const [lo, hi] of [[0, 5], [6, 10], [11, 20], [21, 40], [41, 9999]]) line(`rightBars ${lo}-${hi}`, aa.filter((r) => r.rightBars >= lo && r.rightBars <= hi));
line('lateLow (low in last 1/3)', aa.filter((r) => r.lateLow)); line('not lateLow', aa.filter((r) => !r.lateLow));
for (const [lo, hi] of [[0, 0.25], [0.25, 0.5], [0.5, 1], [1, 2], [2, 99]]) line(`vshape ${lo}-${hi} %/bar`, aa.filter((r) => r.vshape >= lo && r.vshape < hi));

console.log('\n=== Final tightness: 10-bar range before breakout, % of pivot ===');
for (const [lo, hi] of [[0, 3], [3, 5], [5, 8], [8, 12], [12, 99]]) line(`tight10 ${lo}-${hi}%`, aa.filter((r) => r.tight10 >= lo && r.tight10 < hi));

console.log('\n=== Breakout bar: gap and close position ===');
for (const [lo, hi] of [[-99, -0.5], [-0.5, 0.5], [0.5, 2], [2, 5], [5, 10], [10, 999]]) line(`gap ${lo}..${hi}%`, aa.filter((r) => r.gap >= lo && r.gap < hi));
for (const [lo, hi] of [[0, 0.5], [0.5, 0.75], [0.75, 0.9], [0.9, 1.01]]) line(`closePos ${lo}-${hi}`, aa.filter((r) => r.closePos >= lo && r.closePos < hi));

console.log('\n=== Breadth regime: % of universe above own 50-day on the breakout date ===');
for (const [lo, hi] of [[0, 30], [30, 40], [40, 50], [50, 60], [60, 70], [70, 101]]) line(`b50 ${lo}-${hi}%`, aa.filter((r) => r.b50 != null && r.b50 >= lo && r.b50 < hi));
line('SPX > 200MA', aa.filter((r) => r.spx === true)); line('SPX < 200MA', aa.filter((r) => r.spx === false));
line('SPX>200 & b50>=50', aa.filter((r) => r.spx === true && r.b50 >= 50)); line('SPX>200 & b50<50', aa.filter((r) => r.spx === true && r.b50 < 50));
line('SPX>200 & b50<40', aa.filter((r) => r.spx === true && r.b50 < 40));

console.log('\n=== Volume tag reference ===');
line('quiet <1.2x', aa.filter((r) => r.vr < 1.2)); line('confirmed 1.2-2x', aa.filter((r) => r.vr >= 1.2 && r.vr < 2)); line('power >=2x', aa.filter((r) => r.vr >= 2));

console.log('\n=== Per-decade robustness: RS>=80 vs <50, TT full vs fails ===');
for (let d = 1980; d <= 2020; d += 10) {
  const inD = aa.filter((r) => r.year >= d && r.year < d + 10);
  line(`${d}s rs>=80`, inD.filter((r) => r.rs >= 80)); line(`${d}s rs<50`, inD.filter((r) => r.rs != null && r.rs < 50));
  line(`${d}s TT full`, inD.filter(tt)); line(`${d}s TT fails`, inD.filter((r) => !tt(r)));
}
console.log('\n=== Combined candidate gates ===');
line('A+/A & rs>=80', aa.filter((r) => r.rs >= 80));
line('A+/A & rs>=80 & TTcore', aa.filter((r) => r.rs >= 80 && ttCore(r)));
line('A+/A & rs>=80 & gap<5', aa.filter((r) => r.rs >= 80 && r.gap < 5));
line('A+/A & rs>=80 & tight10<8', aa.filter((r) => r.rs >= 80 && r.tight10 < 8));
line('A+/A & rs>=80 & rightBars>=6', aa.filter((r) => r.rs >= 80 && r.rightBars >= 6));
line('A+/A & rs<50', aa.filter((r) => r.rs != null && r.rs < 50));
line('A+ & rs>=80', aa.filter((r) => r.grade === 'A+' && r.rs >= 80));
line('A+ & rs>=89', aa.filter((r) => r.grade === 'A+' && r.rs >= 89));
line('post-2010 A+/A', aa.filter((r) => r.year >= 2010));
line('post-2010 A+/A & rs>=80', aa.filter((r) => r.year >= 2010 && r.rs >= 80));
line('post-2010 A+/A & rs<50', aa.filter((r) => r.year >= 2010 && r.rs != null && r.rs < 50));
line('post-2010 rs>=80 & TT full', aa.filter((r) => r.year >= 2010 && r.rs >= 80 && tt(r)));
