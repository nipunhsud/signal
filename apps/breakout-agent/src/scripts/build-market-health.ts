// Replays the dashboard's market-health score (server.js getMarketHealth) over
// history so portfolio-sim can test its thresholds:
//   trend        50 pts  (>MA50 25 · >MA200 15 · MA50 rising 10), averaged over ^GSPC and ^IXIC
//   distribution 25 pts  (25 − 5 × distribution days in the last 25 sessions, worse index)
//   breadth      25 pts  (15 × share of universe up on the month + 10 × share up on the week)
// Output: study-cache/market-health.json  [[date, score, trend, dist, breadth], ...]
import * as fs from "fs";
const CACHE = process.env.STUDY_CACHE_DIR || "./study-cache";
const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

function loadIndex(sym: string) {
  const raw: number[][] = JSON.parse(fs.readFileSync(`${CACHE}/${sym}.json`, "utf8"));
  return raw.map((r) => ({ date: day(r[0]), close: r[4], volume: r[5] }));
}
function gauge(bars: { date: string; close: number; volume: number }[]) {
  const out = new Map<string, { trend: number; dist: number }>();
  let s50 = 0, s200 = 0, sPrev = 0; // sPrev = sum of closes[i-60 .. i-11]
  for (let i = 0; i < bars.length; i++) {
    s50 += bars[i].close; if (i >= 50) s50 -= bars[i - 50].close;
    s200 += bars[i].close; if (i >= 200) s200 -= bars[i - 200].close;
    if (i >= 10) sPrev += bars[i - 10].close; if (i >= 60) sPrev -= bars[i - 60].close;
    if (i < 200) continue;
    const last = bars[i].close, ma50 = s50 / 50, ma200 = s200 / 200, prev = sPrev / 50;
    let trend = 0;
    if (last > ma50) trend += 25;
    if (last > ma200) trend += 15;
    if (ma50 > prev) trend += 10;
    const win = bars.slice(i - 25, i + 1);
    const hasVolume = win.filter((b) => b.volume > 0).length > 20;
    let dist = 0;
    for (let k = 1; k < win.length; k++) {
      const downEnough = win[k].close <= win[k - 1].close * 0.998;
      if (hasVolume) { if (downEnough && win[k].volume > win[k - 1].volume) dist++; }
      else if (win[k].close <= win[k - 1].close * 0.99) dist++;
    }
    out.set(bars[i].date, { trend, dist });
  }
  return out;
}

function main() {
  const spx = gauge(loadIndex("^GSPC"));
  const ndq = gauge(loadIndex("^IXIC"));
  // breadth: share of the universe with positive 21-bar and 5-bar returns per date
  const up1m = new Map<string, [number, number]>(), up1w = new Map<string, [number, number]>();
  const files = fs.readdirSync(CACHE).filter((f) => /^[A-Z]{1,5}\.json$/.test(f));
  let n = 0;
  for (const f of files) {
    const raw: number[][] = JSON.parse(fs.readFileSync(`${CACHE}/${f}`, "utf8"));
    if (raw.length < 300) continue;
    for (let i = 21; i < raw.length; i++) {
      const d = day(raw[i][0]);
      const m = up1m.get(d) ?? [0, 0]; m[1]++; if (raw[i][4] > raw[i - 21][4]) m[0]++; up1m.set(d, m);
      const w = up1w.get(d) ?? [0, 0]; w[1]++; if (raw[i][4] > raw[i - 5][4]) w[0]++; up1w.set(d, w);
    }
    if (++n % 500 === 0) console.log(`breadth ${n}/${files.length}`);
  }
  const rows: number[][] = [];
  const dates = [...spx.keys()].filter((d) => ndq.has(d)).sort();
  for (const d of dates) {
    const a = spx.get(d)!, b = ndq.get(d)!;
    const trend = Math.round((a.trend + b.trend) / 2);
    const dist = Math.max(0, 25 - Math.max(a.dist, b.dist) * 5);
    const m = up1m.get(d), w = up1w.get(d);
    const pm = m && m[1] >= 50 ? m[0] / m[1] : null, pw = w && w[1] >= 50 ? w[0] / w[1] : null;
    const breadth = pm == null ? 12 : Math.round(pm * 15) + Math.round((pw ?? pm) * 10);
    rows.push([+d.replace(/-/g, ""), trend + dist + breadth, trend, dist, breadth]);
  }
  fs.writeFileSync(`${CACHE}/market-health.json`, JSON.stringify(rows));
  const scores = rows.map((r) => r[1]);
  const share = (f: (s: number) => boolean) => (scores.filter(f).length / scores.length * 100).toFixed(0);
  console.log(`${rows.length} days ${dates[0]} → ${dates[dates.length - 1]} · risk-on(>=70) ${share((s) => s >= 70)}% · caution(45-69) ${share((s) => s >= 45 && s < 70)}% · risk-off(<45) ${share((s) => s < 45)}%`);
  console.log("last 10:", rows.slice(-10).map((r) => `${r[0]}:${r[1]}`).join(" "));
}
main();
