// Does sector strength separate breakout outcomes?
//
// The screen shows "Technology #1" on a card and ranks sectors by the median
// RS score of their members, but nothing has ever been measured about it. This
// reuses the graded breakouts and the cross-sectional RS from
// confidence-study.mjs and adds, for each breakout date, where the stock's
// sector stood among all sectors that session.
//
// Labels are current sector memberships from the public Nasdaq screener, applied
// backwards. Sector membership is stable, so this is sound for symbols that
// still list; symbols that have since delisted carry no label and drop out of
// the sector cuts, which biases those cuts toward survivors. The RS and
// confidence cuts in the companion study carry no such bias.
import fs from 'fs';

const CACHE = './study-cache';
const rows = JSON.parse(fs.readFileSync(`${CACHE}/confidence-rows.json`, 'utf8'));
const sectorOf = JSON.parse(fs.readFileSync(`${CACHE}/sectors.json`, 'utf8'));

const files = fs.readdirSync(CACHE).filter((f) => f.endsWith('.json') && !f.startsWith('^') && !/-(rows|study|agg)\.json$/.test(f) && !/^(META|market-health|sectors)\.json$/.test(f));
const load = (sym) => JSON.parse(fs.readFileSync(`${CACHE}/${sym}.json`, 'utf8')).filter((r) => Array.isArray(r) && r.length >= 6 && Number.isFinite(r[0]) && r[0] > 0 && r[0] < 4e9 && r.slice(1, 5).every((v) => Number.isFinite(v) && v > 0));

console.log(`loading ${files.length} symbols...`);
const dateSet = new Set();
const series = new Map();
for (const f of files) {
  const sym = f.slice(0, -5);
  let a; try { a = load(sym); } catch { continue; }
  if (a.length < 320) continue;
  const dates = a.map((r) => new Date(r[0] * 1000).toISOString().slice(0, 10));
  for (const d of dates) dateSet.add(d);
  series.set(sym, { dates, c: Float64Array.from(a, (r) => r[4]), sector: sectorOf[sym] || null });
}
const axis = [...dateSet].sort();
const axisIdx = new Map(axis.map((d, i) => [d, i]));
for (const [, s] of series) { s.byGlobal = new Map(); for (let i = 0; i < s.dates.length; i++) s.byGlobal.set(axisIdx.get(s.dates[i]), i); }
console.log(`${series.size} symbols on ${axis.length} sessions`);

const wanted = new Map();
for (const r of rows) { r.secRank = null; r.secCount = null; r.sector = sectorOf[r.sym] || null;
  if (!wanted.has(r.gi)) wanted.set(r.gi, []); wanted.get(r.gi).push(r); }

const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const symList = [...series.values()];
let dn = 0;
for (const [g, rs] of wanted) {
  const bySector = new Map();
  for (const s of symList) {
    if (!s.sector) continue;
    const i = s.byGlobal.get(g);
    if (i == null || i < 63) continue;
    const c = s.c;
    const score = 0.5 * ((c[i] / c[i - 63] - 1) * 100) + 0.3 * ((c[i] / c[i - 21] - 1) * 100) + 0.2 * ((c[i] / c[i - 5] - 1) * 100);
    if (!Number.isFinite(score)) continue;
    if (!bySector.has(s.sector)) bySector.set(s.sector, []);
    bySector.get(s.sector).push(score);
  }
  // A sector needs members before its median means anything
  const ranked = [...bySector.entries()].filter(([, v]) => v.length >= 5)
    .map(([k, v]) => [k, median(v)]).sort((a, b) => b[1] - a[1]);
  if (ranked.length < 5) continue;
  const rankOf = new Map(ranked.map(([k], i) => [k, i + 1]));
  for (const r of rs) {
    if (r.sector && rankOf.has(r.sector)) { r.secRank = rankOf.get(r.sector); r.secCount = ranked.length; }
  }
  if (++dn % 2000 === 0) console.log(`  ${dn}/${wanted.size} sessions`);
}
fs.writeFileSync(`${CACHE}/sector-rows.json`, JSON.stringify(rows));

const agg = (rs) => { const n = rs.length; if (!n) return 'n=0';
  const w = rs.filter((r) => r.ret20 > 0).length, st = rs.filter((r) => r.stopped).length;
  const m = rs.reduce((a, r) => a + r.ret60, 0) / n, hit = rs.filter((r) => r.run60 >= 20).length;
  let g = 0, l = 0; for (const r of rs) { const v = Math.max(r.ret20, -7); v > 0 ? g += v : l -= v; }
  return `n=${String(n).padStart(6)} win=${(w / n * 100).toFixed(1)}% stop=${(st / n * 100).toFixed(1)}% mean60=${m.toFixed(2)}% reach=${(hit / n * 100).toFixed(1)}% PF=${(l ? g / l : 99).toFixed(2)}`; };
const line = (l, rs) => console.log(l.padEnd(36), agg(rs));

const withSec = rows.filter((r) => r.secRank != null);
const withRs = rows.filter((r) => r.rs != null);
console.log(`\npool ${rows.length} | with a sector rank ${withSec.length} | with RS ${withRs.length}\n`);
line('ALL', rows);
console.log('\n=== where the sector stood that session ===');
line('sector rank 1', withSec.filter((r) => r.secRank === 1));
line('sector rank 2-3', withSec.filter((r) => r.secRank >= 2 && r.secRank <= 3));
line('sector rank 4-6', withSec.filter((r) => r.secRank >= 4 && r.secRank <= 6));
line('sector rank 7-9', withSec.filter((r) => r.secRank >= 7 && r.secRank <= 9));
line('sector rank 10+', withSec.filter((r) => r.secRank >= 10));
console.log('  --- as a gate would split it ---');
line('top third of sectors', withSec.filter((r) => r.secRank <= r.secCount / 3));
line('rest', withSec.filter((r) => r.secRank > r.secCount / 3));

console.log('\n=== sector rank inside the RS>=89 population ===');
const lead = withSec.filter((r) => r.rs != null && r.rs >= 89);
line('RS>=89, all', lead);
line('  RS>=89 & sector top third', lead.filter((r) => r.secRank <= r.secCount / 3));
line('  RS>=89 & sector bottom third', lead.filter((r) => r.secRank > (r.secCount * 2) / 3));

console.log('\n=== candidate gates, side by side ===');
line('current: RS>=89 & conf>=0.80', withRs.filter((r) => r.rs >= 89 && r.conf >= 0.8));
line('RS>=89 alone', withRs.filter((r) => r.rs >= 89));
line('RS>=89 & sector top third', lead.filter((r) => r.secRank <= r.secCount / 3));
line('RS>=95 alone', withRs.filter((r) => r.rs >= 95));
line('RS>=95 & sector top third', withSec.filter((r) => r.rs >= 95 && r.secRank <= r.secCount / 3));
line('baseline: every graded breakout', rows);
