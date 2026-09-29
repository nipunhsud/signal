// Does the institutional register moving tell you anything about a breakout?
//
// The chip on the row says "423 funds · +197". The honest question is whether
// that +197 has ever meant anything for what the breakout did next, or whether
// it is just a description of a stock that already went up — funds buy what has
// worked, so ownership growth and past performance are the same fact twice.
//
// Data. Every Form 13F filed since 2013, from SEC's quarterly datasets: 54
// window zips, 53 usable quarters, 65.7M positions after deduplication,
// restricted to the symbols this cache holds bars for. CUSIP mapped to ticker
// through SEC's fails-to-deliver files. Build it with scripts/f13f-ingest.mjs,
// or the shell pipeline documented at the bottom of this file.
//
// No look-ahead, and this matters more here than anywhere else in these
// studies. A 13F is due 45 days after the quarter ends, so on the day of a
// breakout the newest register a reader could actually have seen is the last
// quarter whose deadline had passed — between 45 and 135 days old. Every
// feature below is computed from that quarter and the one before it, never from
// the quarter the breakout is sitting in.
//
// Units. 13F VALUE was reported in thousands until 2023 and in whole dollars
// after, and a large minority of filers still report thousands. Each row's
// value/shares is refereed against the symbol's own close on the period end and
// rescaled or dropped, exactly as the ingest does.
//
// Breakout cohort: the same gates as every other study behind the grades —
// $750k average daily turnover, close above a rising 200-day, base 25% deep or
// less, blue-sky pivot.
//
// Outcome: entry at the breakout close. win = positive 20 bars on. stop = the
// low touched 7% under the entry inside 20 bars. reach = a close 20% above the
// entry inside 60 bars. PF = gross gains over gross losses, losses floored
// at -7%.
//
// ── What it found, 49,382 graded breakouts, 2003–2026 ───────────────────────
//
// The register moving does not predict the breakout. The cohort runs a 1.71
// profit factor, and bucketing on the change in holder count gives a U, not a
// slope:
//
//   holders fell more than 10%   PF 1.95
//   fell 3-10%                   PF 1.80
//   flat, within 3%              PF 1.64
//   grew 3-10%                   PF 1.60   ← the most common "positive" reading
//   grew 10-25%                  PF 1.76      is the worst bucket in the table
//   grew more than 25%           PF 2.04
//
// Both ends beat the middle, which is the shape of a volatility proxy rather
// than a signal. Dropping the sign proves it: bucketed on the ABSOLUTE size of
// the move, PF climbs 1.64 → 1.64 → 1.78 → 2.02 → 2.00, monotonically. A
// register that moves a lot belongs to a stock something is happening to. Which
// way it moved adds nothing.
//
// Restricting to holders that are neither index complexes nor market makers
// gives the same U to two decimal places, so the separation that makes the
// panel readable does not rescue it as a predictor.
//
// The pooled comparison does lean positive — "grew 10%+" against "did not" runs
// 1.96/1.77, 1.91/1.64, 1.72/1.63 and 1.94/1.62 across four bands of dollar
// volume, and stays ahead inside every band of 3-month return. But year by
// year, against its own control, it wins 9 of 18. The pooled gap is 2020
// (+1.28) and 2018 (+0.85) against 2012 (-0.50) and 2010 (-0.44), not an edge
// that was there each year.
//
// And where it does lead, the fail-level touch rate leads with it: on names up
// more than 40% in three months, a grown register touches the fail level 63.6%
// of the time against 58.2%. Wider both ways.
//
// One more tell. Sorting on how STALE the register was at the breakout — 45-70
// days, 70-100, 100-140 — gives PF 1.45, 1.72, 1.87. An older filing scoring
// better is not a thing a real signal does; it is the calendar showing through.
//
// So 13F ships as what the panel already calls it: who owns the company, by
// name, as of a stated quarter. Context for reading a chart. Not a ranking
// input, not part of the alert gate.
import fs from 'fs';
import readline from 'readline';
import { detectBases } from '../base-detect.js';

const CACHE = './study-cache';
const DATA = process.argv[2] || '/private/tmp/claude-501/-Users-nipunsud-github-signal/fe12a00f-6d38-4f0f-bf1a-782be32326e6/scratchpad/study13f';
const SORTED = `${DATA}/sorted.tsv`;
const PASSIVE = `${DATA}/passive-ciks.txt`;
const FILING_LAG_DAYS = 45;

if (!fs.existsSync(SORTED)) { console.error(`missing ${SORTED}`); process.exit(1); }
const passiveCik = new Set(fs.existsSync(PASSIVE) ? fs.readFileSync(PASSIVE, 'utf8').split('\n').filter(Boolean) : []);
console.log(`passive filers recognised: ${passiveCik.size}`);

const load = (sym) => JSON.parse(fs.readFileSync(`${CACHE}/${sym}.json`, 'utf8'))
  .filter((r) => Array.isArray(r) && r.length >= 6 && Number.isFinite(r[0]) && r[0] > 0 && r[0] < 4e9 && r.slice(1, 5).every((v) => Number.isFinite(v) && v > 0));

const addDays = (ymd, n) => new Date(new Date(`${ymd}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

const rows = [];
let symbols = 0, noBars = 0;

// One symbol's whole 13F history arrives together, sorted by period.
function processSymbol(sym, byPeriod) {
  let a;
  try { a = load(sym); } catch { noBars++; return; }
  const n = a.length;
  if (n < 340) return;
  const bars = a.map((r) => ({ time: new Date(r[0] * 1000).toISOString().slice(0, 10), open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }));
  const idx = new Map(bars.map((b, i) => [b.time, i]));
  const cs = new Float64Array(n + 1), vs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) { cs[i + 1] = cs[i] + bars[i].close; vs[i + 1] = vs[i] + bars[i].volume; }
  const sma = (i, k) => (i + 1 >= k ? (cs[i + 1] - cs[i + 1 - k]) / k : null);

  // Close on or before each period end, to referee the value unit.
  const closeAt = (ymd) => {
    let lo = 0, hi = n - 1, best = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (bars[m].time <= ymd) { best = m; lo = m + 1; } else hi = m - 1; }
    return best >= 0 ? bars[best].close : null;
  };

  // Fold each period into totals, correcting units per row.
  const periods = [...byPeriod.keys()].sort();
  const roll = new Map();
  for (const period of periods) {
    const px = closeAt(period);
    if (!(px > 0)) continue;
    const held = new Map();
    let shares = 0, value = 0, activeShares = 0;
    for (const [cik, pos] of byPeriod.get(period)) {
      let v = pos.value;
      const implied = pos.shares > 0 ? v / pos.shares : 0;
      if (implied >= px * 0.6 && implied <= px * 1.6) { /* dollars */ }
      else if (implied * 1000 >= px * 0.6 && implied * 1000 <= px * 1.6) { v *= 1000; }
      else continue; // unusable row, or an outright filing error
      held.set(cik, pos.shares);
      shares += pos.shares; value += v;
      if (!passiveCik.has(cik)) activeShares += pos.shares;
    }
    if (held.size) roll.set(period, { held, shares, value, activeShares, holders: held.size, active: [...held.keys()].filter((c) => !passiveCik.has(c)).length });
  }
  const known = [...roll.keys()].sort();
  if (known.length < 2) return;

  // The newest register a reader could have seen on date `d`.
  const registerAt = (d) => {
    let pick = null;
    for (const p of known) { if (addDays(p, FILING_LAG_DAYS) <= d) pick = p; else break; }
    if (!pick) return null;
    const i = known.indexOf(pick);
    if (i < 1) return null;
    return { period: pick, cur: roll.get(pick), prior: roll.get(known[i - 1]), ageDays: Math.round((new Date(`${d}T00:00:00Z`) - new Date(`${pick}T00:00:00Z`)) / 86400000) };
  };

  let bases;
  try { bases = detectBases(bars); } catch { return; }
  for (const base of bases) {
    if (!base.breakout) continue;
    const date = base.breakout.date;
    const p = idx.get(base.pivotDate), i = idx.get(date);
    if (p == null || i == null || i + 60 >= n || i < 260) continue;
    const avgVolume = (vs[i] - vs[i - 20]) / 20;
    const dollarVol = avgVolume * bars[i].close;
    if (!(dollarVol >= 750_000)) continue;
    const ma200 = sma(i, 200), ma200Prev = sma(i - 1, 200);
    if (!(bars[i].close > ma200 && ma200 > ma200Prev)) continue;
    if (base.depthPct > 25) continue;
    let skyAt = 0; for (let k = Math.max(0, p - 251); k <= p; k++) if (bars[k].high > skyAt) skyAt = bars[k].high;
    if (!(bars[p].high >= skyAt * 0.98)) continue;

    const reg = registerAt(date);
    if (!reg) continue;
    const { cur, prior } = reg;

    let opened = 0, closedOut = 0, added = 0, reduced = 0;
    for (const [cik, sh] of cur.held) {
      const before = prior.held.get(cik);
      if (before == null) opened++;
      else if (sh > before * 1.02) added++;
      else if (sh < before * 0.98) reduced++;
    }
    for (const cik of prior.held.keys()) if (!cur.held.has(cik)) closedOut++;

    const entry = bars[i].close;
    let minLow = Infinity, maxC = -Infinity;
    for (let k = i + 1; k <= i + 20; k++) minLow = Math.min(minLow, bars[k].low);
    for (let k = i + 1; k <= i + 60; k++) maxC = Math.max(maxC, bars[k].close);
    // Funds buy what has already worked, so the register's growth has to be
    // judged against the momentum it is probably just restating.
    const mom63 = i >= 63 ? ((bars[i].close - bars[i - 63].close) / bars[i - 63].close) * 100 : null;

    rows.push({
      sym, date, year: +date.slice(0, 4), period: reg.period, ageDays: reg.ageDays,
      holders: cur.holders, holdersPrior: prior.holders,
      holdersPct: prior.holders ? ((cur.holders - prior.holders) / prior.holders) * 100 : null,
      active: cur.active, activePct: prior.active ? ((cur.active - prior.active) / prior.active) * 100 : null,
      sharesPct: prior.shares ? ((cur.shares - prior.shares) / prior.shares) * 100 : null,
      activeSharesPct: prior.activeShares ? ((cur.activeShares - prior.activeShares) / prior.activeShares) * 100 : null,
      opened, closed: closedOut, added, reduced,
      openedPct: prior.holders ? (opened / prior.holders) * 100 : null,
      mom63, dv: Math.round(dollarVol),
      ret20: +(((bars[i + 20].close - entry) / entry) * 100).toFixed(2),
      stopped: minLow <= entry * 0.93,
      run60: +(((maxC - entry) / entry) * 100).toFixed(2),
    });
  }
}

const rl = readline.createInterface({ input: fs.createReadStream(SORTED), crlfDelay: Infinity });
let curSym = null, byPeriod = new Map();
for await (const line of rl) {
  const t = line.split('\t');
  if (t.length < 5) continue;
  const [sym, period, cik, shares, value] = t;
  if (sym !== curSym) {
    if (curSym) { processSymbol(curSym, byPeriod); if (++symbols % 500 === 0) console.log(`  ${symbols} symbols, ${rows.length} breakouts`); }
    curSym = sym; byPeriod = new Map();
  }
  let p = byPeriod.get(period);
  if (!p) byPeriod.set(period, (p = new Map()));
  const cur = p.get(cik);
  if (cur) { cur.shares += +shares; cur.value += +value; }
  else p.set(cik, { shares: +shares, value: +value });
}
if (curSym) { processSymbol(curSym, byPeriod); symbols++; }

fs.writeFileSync(`${CACHE}/institutional-ownership-rows.json`, JSON.stringify(rows));
console.log(`\n${rows.length.toLocaleString()} graded breakouts with a readable register, across ${symbols.toLocaleString()} symbols`);
const yrs = rows.map((r) => r.year);
console.log(`years ${Math.min(...yrs)}–${Math.max(...yrs)} · register age at the breakout: median ${median(rows.map((r) => r.ageDays)).toFixed(0)} days\n`);

function median(xs) { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; }
function agg(rs) {
  if (!rs.length) return 'n=0';
  const w = rs.filter((x) => x.ret20 > 0).length;
  const st = rs.filter((x) => x.stopped).length;
  const hit = rs.filter((x) => x.run60 >= 20).length;
  let g = 0, l = 0;
  for (const x of rs) { const v = Math.max(x.ret20, -7); v > 0 ? g += v : l -= v; }
  const mean = rs.reduce((t, x) => t + x.ret20, 0) / rs.length;
  const sd = Math.sqrt(rs.reduce((t, x) => t + (x.ret20 - mean) ** 2, 0) / rs.length);
  return `n=${String(rs.length).padStart(6)} win=${(w / rs.length * 100).toFixed(1)}% stop=${(st / rs.length * 100).toFixed(1)}% reach=${(hit / rs.length * 100).toFixed(1)}% PF=${(l ? g / l : 99).toFixed(2)} med=${median(rs.map((x) => x.ret20)) >= 0 ? '+' : ''}${median(rs.map((x) => x.ret20)).toFixed(2)}% sd=${sd.toFixed(1)} $vol=${(median(rs.map((x) => x.dv)) / 1e6).toFixed(1)}M`;
}
const show = (title, groups) => {
  console.log(`── ${title}`);
  for (const [label, rs] of groups) console.log(`   ${label.padEnd(30)} ${agg(rs)}`);
  console.log('');
};
const R = rows;
console.log(`baseline: ${agg(R)}\n`);

const band = (f, edges, labels) => labels.map((lab, k) => [lab, R.filter((r) => {
  const v = f(r);
  if (v == null) return false;
  return v >= edges[k] && v < edges[k + 1];
})]);

show('Holder count, change on the quarter', band((r) => r.holdersPct, [-Infinity, -10, -3, 3, 10, 25, Infinity],
  ['fell more than 10%', 'fell 3-10%', 'flat, within 3%', 'grew 3-10%', 'grew 10-25%', 'grew more than 25%']));

show('Holders that are not index funds or market makers', band((r) => r.activePct, [-Infinity, -10, -3, 3, 10, 25, Infinity],
  ['fell more than 10%', 'fell 3-10%', 'flat, within 3%', 'grew 3-10%', 'grew 10-25%', 'grew more than 25%']));

show('Shares held, change on the quarter', band((r) => r.sharesPct, [-Infinity, -10, -3, 3, 10, 25, Infinity],
  ['fell more than 10%', 'fell 3-10%', 'flat, within 3%', 'grew 3-10%', 'grew 10-25%', 'grew more than 25%']));

show('Managers opening a position, as a share of the register', band((r) => r.openedPct, [0, 3, 6, 10, 20, Infinity],
  ['under 3%', '3-6%', '6-10%', '10-20%', '20% and up']));

show('Opened against exited', [
  ['more exits than openings', R.filter((r) => r.closed > r.opened)],
  ['about even', R.filter((r) => r.closed <= r.opened && r.opened < r.closed * 1.5)],
  ['openings 1.5-3x exits', R.filter((r) => r.opened >= r.closed * 1.5 && r.opened < r.closed * 3)],
  ['openings 3x exits or more', R.filter((r) => r.closed > 0 && r.opened >= r.closed * 3)],
]);

// The control that matters: funds buy what already went up.
console.log('── Is register growth just momentum? Holders grown 10%+ against not, inside one band of 3-month return');
for (const [lo, hi, lab] of [[-Infinity, 0, 'down over 3 months'], [0, 15, 'up 0-15%'], [15, 40, 'up 15-40%'], [40, Infinity, 'up more than 40%']]) {
  const b = R.filter((r) => r.mom63 != null && r.mom63 >= lo && r.mom63 < hi);
  console.log(`   ${lab}`);
  console.log(`     register grew 10%+     ${agg(b.filter((r) => r.holdersPct != null && r.holdersPct >= 10))}`);
  console.log(`     it did not            ${agg(b.filter((r) => r.holdersPct != null && r.holdersPct < 10))}`);
}

console.log('\n── And inside one band of dollar volume, because thinner is wilder');
for (const [lo, hi, lab] of [[0.75e6, 5e6, '$0.75M to $5M'], [5e6, 25e6, '$5M to $25M'], [25e6, 100e6, '$25M to $100M'], [100e6, Infinity, '$100M and up']]) {
  const b = R.filter((r) => r.dv >= lo && r.dv < hi);
  console.log(`   ${lab}`);
  console.log(`     register grew 10%+     ${agg(b.filter((r) => r.holdersPct != null && r.holdersPct >= 10))}`);
  console.log(`     it did not            ${agg(b.filter((r) => r.holdersPct != null && r.holdersPct < 10))}`);
}

console.log('\n── Does the best bucket hold up year by year?');
const years = [...new Set(R.map((r) => r.year))].sort();
for (const y of years) {
  const b = R.filter((r) => r.year === y && r.holdersPct != null && r.holdersPct >= 10);
  if (b.length >= 20) console.log(`   ${y} grew 10%+          ${agg(b)}`);
}
