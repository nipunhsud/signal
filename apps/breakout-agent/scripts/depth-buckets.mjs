// Depth-bucket check for the grade cut: does <10% deep beat 10-15% within sky bases?
// Uses only files already in the study cache (no network).
// Run: node scripts/depth-buckets.mjs (after backtest-exits.js has filled study-cache/)
import { detectBases } from "../base-detect.js";
import fs from "fs";
const CACHE = new URL("../study-cache", import.meta.url).pathname;
const STOP = 0.07;
const rows = [];
for (const f of fs.readdirSync(CACHE)) {
  if (!f.endsWith(".json") || f.startsWith("exit-") || f.startsWith("grade-")) continue;
  const a = JSON.parse(fs.readFileSync(`${CACHE}/${f}`, "utf8"));
  if (a.length < 300) continue;
  const bars = a.map(r => ({ time: new Date(r[0]*1000).toISOString().slice(0,10), open:r[1], high:r[2], low:r[3], close:r[4], volume:r[5] }));
  const idx = new Map(bars.map((b,i)=>[b.time,i]));
  const ma200 = new Float64Array(bars.length); let s=0;
  for (let i=0;i<bars.length;i++){ s+=bars[i].close; if(i>=200) s-=bars[i-200].close; if(i>=199) ma200[i]=s/200; }
  for (const b of detectBases(bars)) {
    if (!b.breakout) continue;
    const p = idx.get(b.pivotDate), i = idx.get(b.breakout.date);
    if (p==null || i==null || i<200 || i+63>=bars.length) continue;
    let av=0; for (let k=i-20;k<i;k++) av+=bars[k].volume; if (av/20<100000) continue;
    const pivot = bars[p].high; let hi=0; for (let k=Math.max(0,p-251);k<=p;k++) hi=Math.max(hi,bars[k].high);
    if (!(pivot>=hi*0.98) || !(bars[i].close>ma200[i]) || b.depthPct>25) continue;
    const e = bars[i].close;
    let minLow=Infinity; for (let k=i+1;k<=i+20;k++) minLow=Math.min(minLow,bars[k].low);
    let minLow63=Infinity, maxHigh63=0; for (let k=i+1;k<=i+63;k++){ minLow63=Math.min(minLow63,bars[k].low); maxHigh63=Math.max(maxHigh63,bars[k].high); }
    rows.push({ depth:b.depthPct, bars:b.bars, year:+b.breakout.date.slice(0,4),
      ret20:(bars[i+20].close-e)/e, stop20:minLow<=e*(1-STOP), ret63:(bars[i+63].close-e)/e, stop63:minLow63<=e*(1-STOP), hit20:maxHigh63>=e*1.2 });
  }
}
const agg = (rs) => { const n=rs.length; if(!n) return "n=0"; const m=(f)=>rs.reduce((a,r)=>a+f(r),0)/n;
  return `n=${String(n).padStart(6)}  20d: win ${(m(r=>r.ret20>0)*100).toFixed(1)}% stop ${(m(r=>r.stop20)*100).toFixed(1)}% mean ${(m(r=>r.ret20)*100).toFixed(2)}%   63d: win ${(m(r=>r.ret63>0)*100).toFixed(1)}% stop ${(m(r=>r.stop63)*100).toFixed(1)}% mean ${(m(r=>r.ret63)*100).toFixed(2)}% reached+20% ${(m(r=>r.hit20)*100).toFixed(1)}%`; };
console.log(`sky bases above 200MA, depth<=25%: ${rows.length} breakouts`);
const buckets = [[0,5],[5,10],[10,15],[15,20],[20,25]];
for (const [lo,hi] of buckets) console.log(`depth ${String(lo).padStart(2)}-${hi}%  all bars   ${agg(rows.filter(r=>r.depth>lo&&r.depth<=hi))}`);
console.log("");
for (const [lo,hi] of buckets) console.log(`depth ${String(lo).padStart(2)}-${hi}%  >=25 bars  ${agg(rows.filter(r=>r.depth>lo&&r.depth<=hi&&r.bars>=25))}`);
console.log("");
for (const [lo,hi] of buckets) console.log(`depth ${String(lo).padStart(2)}-${hi}%  >=80 bars  ${agg(rows.filter(r=>r.depth>lo&&r.depth<=hi&&r.bars>=80))}`);
console.log("\nby grade (production cut):");
console.log(`S  (<=15%, >=80b)   ${agg(rows.filter(r=>r.depth<=15&&r.bars>=80))}`);
console.log(`A+ (<=15%, 25-79b)  ${agg(rows.filter(r=>r.depth<=15&&r.bars>=25&&r.bars<80))}`);
console.log(`A  (rest <=25%)     ${agg(rows.filter(r=>!(r.depth<=15&&r.bars>=25)))}`);
console.log(`\n2010+ only:`);
for (const [lo,hi] of buckets) console.log(`depth ${String(lo).padStart(2)}-${hi}%  >=25 bars  ${agg(rows.filter(r=>r.year>=2010&&r.depth>lo&&r.depth<=hi&&r.bars>=25))}`);
