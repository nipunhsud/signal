// Caches the S&P 500 daily series (Yahoo ^GSPC, compact arrays like the study
// cache) for portfolio-sim's --regime filter.
import * as fs from "fs";
const CACHE = process.env.STUDY_CACHE_DIR || "./study-cache";
async function fetchIndex(sym: string) {
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=0&period2=9999999999&interval=1d`, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j: any = await res.json();
  const r = j.chart.result[0];
  const ts: number[] = r.timestamp, q = r.indicators.quote[0];
  const out: number[][] = [];
  for (let i = 0; i < ts.length; i++) if (q.close[i] != null) out.push([ts[i], q.open[i], q.high[i], q.low[i], q.close[i], q.volume[i] ?? 0]);
  fs.writeFileSync(`${CACHE}/${sym}.json`, JSON.stringify(out));
  console.log(`${sym}: ${out.length} bars, ${new Date(out[0][0] * 1000).toISOString().slice(0, 10)} → ${new Date(out[out.length - 1][0] * 1000).toISOString().slice(0, 10)}`);
}
async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  for (const sym of process.argv.slice(2).length ? process.argv.slice(2) : ["^GSPC", "^IXIC"]) await fetchIndex(sym);
}
main().catch((e) => { console.error(e); process.exit(1); });
