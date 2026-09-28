// Does insider buying or selling say anything about what a breakout does next?
//
// The question, put by the user: insiders have different motivations to buy and
// to sell, and they cannot move the market — so is any of it worth showing?
//
// The data. Every Form 4 filed since 2010, from SEC's quarterly Insider
// Transactions Data Sets (66 zips, 2.75M non-derivative transactions). Codes
// kept: P open-market purchase, S open-market sale, M and X option exercises,
// so an exercise-and-sell can be told from a discretionary sale. Build the
// input first: node scripts/form4-dataset.mjs
//
// No look-ahead. A Form 4 is filed up to two business days after the
// transaction, so every window here counts only filings whose FILING_DATE is on
// or before the breakout date. What the screen could actually have known.
//
// Breakout cohort: identical gates to every other study behind the grades —
// $750k average daily turnover, close above a rising 200-day, base 25% deep or
// less, blue-sky pivot — restricted to 2010-07-01 onward so the 90-day insider
// window is inside the filing data on the first bar measured.
//
// Outcome: entry at the breakout close. win = positive 20 bars on. stop = the
// low touched 7% under the entry inside 20 bars. reach = a close 20% above the
// entry inside 60 bars. PF = gross gains / gross losses with losses floored
// at -7%.
//
// ── What it found, 57,032 graded breakouts, 2010-07-01 to 2026-06-30 ────────
//
// Nothing usable. The cohort runs a 1.76 profit factor; insider buying in the
// 90 days before the breakout runs 1.80, discretionary selling 1.72, and no
// filing at all 1.78. Win rate is 54% in every cell.
//
// The cells that look better are thinner and wilder, not better informed.
// "Bought 0.5 to 2 days of average dollar volume" shows PF 2.33 and 23.5%
// reaching +20% — on a median $5.4M a day against the cohort's $27.8M, with the
// spread of 20-day returns up from 9.6 to 12.4 and the fail-level touch rate up
// from 32% to 40%. That is the signature of a thin stock, not of information.
// The same artifact makes 10b5-1 planned SALES look good (PF 2.05, 24.7%
// reaching +20%, stops 40.7%), which is the tell: if selling and buying both
// improve the numbers, neither is doing it.
//
// Holding liquidity constant kills what is left. Inside one band of dollar
// volume, buying against no buying: $0.75-5M 1.82 vs 1.89, $5-25M 1.77 vs
// 1.77, $25-100M 1.68 vs 1.67, $100M+ 1.96 vs 1.71. One band of four, n=1,432.
// Cluster buys by year swing from PF 0.77 to 4.88 on ~100 breakouts a year.
//
// Which matches the user's objection exactly: insiders buy and sell for
// different reasons, and they are too small to move the tape. So Form 4 ships
// as context on the row, in the drawer and in the email — who did what, when,
// and which kind of sale it was — and it does not rank a name or gate an alert.
import fs from 'fs';
import zlib from 'zlib';
import { detectBases } from '../base-detect.js';

const CACHE = './study-cache';
const WINDOW_DAYS = 90;
const FROM = '2010-07-01';
const UNTIL = '2026-06-30'; // the filing data ends with 2026q2

// ── the filings, symbol → transactions sorted by filing date ────────────────
const TRANS = `${CACHE}/form4-trans.tsv.gz`;
if (!fs.existsSync(TRANS)) {
  console.error(`missing ${TRANS} — run: node scripts/form4-dataset.mjs`);
  process.exit(1);
}
const bySym = new Map();
{
  const text = zlib.gunzipSync(fs.readFileSync(TRANS)).toString('utf8');
  let lineNo = 0, kept = 0;
  for (const line of text.split('\n')) {
    if (lineNo++ === 0 || !line) continue;
    const f = line.split('\t');
    const [symbol, transDate, filedAt, code, shares, price, ownerCik, planned] = f;
    if (!symbol || !filedAt || !transDate) continue;
    let a = bySym.get(symbol);
    if (!a) bySym.set(symbol, (a = []));
    a.push({ t: transDate, f: filedAt, c: code, s: +shares || 0, p: +price || 0, o: ownerCik, pl: planned === '1' });
    kept++;
  }
  for (const a of bySym.values()) a.sort((x, y) => (x.f < y.f ? -1 : x.f > y.f ? 1 : 0));
  console.log(`filings: ${kept.toLocaleString()} transactions across ${bySym.size.toLocaleString()} symbols`);
}

// The 90-day open-market picture as of `asOf`, counting only what was filed by
// then. Mirrors summarizeInsider in insider.js.
const daysBefore = (d, n) => new Date(new Date(`${d}T00:00:00Z`).getTime() - n * 86400000).toISOString().slice(0, 10);
function windowAt(sym, asOf) {
  const a = bySym.get(sym);
  if (!a) return null;
  const from = daysBefore(asOf, WINDOW_DAYS);
  // Exercise days per owner, so an S on the same day is an exercise-and-sell.
  const exDays = new Set();
  const rows = [];
  for (const r of a) {
    if (r.f > asOf) break;         // not filed yet — unknowable at the breakout
    if (r.t < from || r.t > asOf) continue;
    if (r.c === 'M' || r.c === 'X') exDays.add(`${r.o}|${r.t}`);
    else rows.push(r);
  }
  if (!rows.length) return { buys: 0, sells: 0, realSells: 0, plannedSells: 0, exerciseSells: 0, buyers: 0, sellers: 0, buyValue: 0, sellValue: 0, tenPctBuy: false };
  let buys = 0, sells = 0, plannedSells = 0, exerciseSells = 0, buyValue = 0, sellValue = 0;
  const buyers = new Set(), sellers = new Set();
  for (const r of rows) {
    const v = r.s * r.p;
    if (r.c === 'P') { buys++; buyValue += v; buyers.add(r.o); }
    else if (r.c === 'S') {
      sells++; sellValue += v; sellers.add(r.o);
      if (r.pl) plannedSells++;
      if (exDays.has(`${r.o}|${r.t}`)) exerciseSells++;
    }
  }
  const realSells = Math.max(0, sells - plannedSells - exerciseSells);
  return { buys, sells, realSells, plannedSells, exerciseSells, buyers: buyers.size, sellers: sellers.size, buyValue, sellValue };
}

// ── the breakouts ───────────────────────────────────────────────────────────
const files = fs.readdirSync(CACHE).filter((f) => f.endsWith('.json') && !f.startsWith('^') && !/-(rows|study|agg)\.json$/.test(f) && !/^(META|market-health|sectors)\.json$/.test(f));
const load = (sym) => JSON.parse(fs.readFileSync(`${CACHE}/${sym}.json`, 'utf8')).filter((r) => Array.isArray(r) && r.length >= 6 && Number.isFinite(r[0]) && r[0] > 0 && r[0] < 4e9 && r.slice(1, 5).every((v) => Number.isFinite(v) && v > 0));

const rows = [];
let done = 0, covered = 0, uncovered = 0;
for (const f of files) {
  const sym = f.slice(0, -5);
  let a; try { a = load(sym); } catch { continue; }
  const n = a.length; if (n < 340) continue;
  const hasFilings = bySym.has(sym);
  try {
    const bars = a.map((r) => ({ time: new Date(r[0] * 1000).toISOString().slice(0, 10), open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }));
    const idx = new Map(bars.map((b, i) => [b.time, i]));
    const cs = new Float64Array(n + 1), vs = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) { cs[i + 1] = cs[i] + bars[i].close; vs[i + 1] = vs[i] + bars[i].volume; }
    const sma = (i, k) => (i + 1 >= k ? (cs[i + 1] - cs[i + 1 - k]) / k : null);
    let bases; try { bases = detectBases(bars); } catch { done++; continue; }
    for (const base of bases) {
      if (!base.breakout) continue;
      const date = base.breakout.date;
      if (date < FROM || date > UNTIL) continue;
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

      if (hasFilings) covered++; else uncovered++;
      const w = windowAt(sym, date) || { buys: 0, sells: 0, realSells: 0, plannedSells: 0, exerciseSells: 0, buyers: 0, sellers: 0, buyValue: 0, sellValue: 0 };

      const entry = bars[i].close;
      let minLow = Infinity, maxC = -Infinity;
      for (let k = i + 1; k <= i + 20; k++) minLow = Math.min(minLow, bars[k].low);
      for (let k = i + 1; k <= i + 60; k++) maxC = Math.max(maxC, bars[k].close);
      rows.push({
        sym, date, year: +date.slice(0, 4), hasFilings, dv: Math.round(dollarVol),
        ...w,
        // how big the buying was against the tape it had to move
        buyDays: dollarVol > 0 ? +(w.buyValue / dollarVol).toFixed(3) : 0,
        sellDays: dollarVol > 0 ? +(w.sellValue / dollarVol).toFixed(3) : 0,
        ret20: +(((bars[i + 20].close - entry) / entry) * 100).toFixed(2),
        stopped: minLow <= entry * 0.93,
        run60: +(((maxC - entry) / entry) * 100).toFixed(2),
      });
    }
  } catch { /* skip */ }
  if (++done % 800 === 0) console.log(`  ${done}/${files.length} breakouts=${rows.length}`);
}
fs.writeFileSync(`${CACHE}/insider-rows.json`, JSON.stringify(rows));
console.log(`\n${rows.length.toLocaleString()} graded breakouts ${FROM}..${UNTIL} — ${covered.toLocaleString()} on symbols with Form 4 history, ${uncovered.toLocaleString()} without\n`);

// ── the table ───────────────────────────────────────────────────────────────
const agg = (rs) => {
  if (!rs.length) return 'n=0';
  const w = rs.filter((x) => x.ret20 > 0).length;
  const st = rs.filter((x) => x.stopped).length;
  const hit = rs.filter((x) => x.run60 >= 20).length;
  let g = 0, l = 0;
  for (const x of rs) { const v = Math.max(x.ret20, -7); v > 0 ? g += v : l -= v; }
  const med = rs.map((x) => x.ret20).sort((a, b) => a - b)[Math.floor(rs.length / 2)];
  const mean = rs.reduce((t, x) => t + x.ret20, 0) / rs.length;
  const sd = Math.sqrt(rs.reduce((t, x) => t + (x.ret20 - mean) ** 2, 0) / rs.length);
  const dv = rs.map((x) => x.dv || 0).sort((a, b) => a - b)[Math.floor(rs.length / 2)];
  return `n=${String(rs.length).padStart(6)} win=${(w / rs.length * 100).toFixed(1)}% stop=${(st / rs.length * 100).toFixed(1)}% reach=${(hit / rs.length * 100).toFixed(1)}% PF=${(l ? g / l : 99).toFixed(2)} med=${med >= 0 ? '+' : ''}${med.toFixed(2)}% sd=${sd.toFixed(1)} $vol=${(dv / 1e6).toFixed(1)}M`;
};
const show = (title, groups) => {
  console.log(`── ${title}`);
  for (const [label, rs] of groups) console.log(`   ${label.padEnd(34)} ${agg(rs)}`);
  console.log('');
};

// Only symbols we have filing history for; otherwise "quiet" mixes "nobody
// bought" with "we have no data", which is the classic way to fake a result.
const R = rows.filter((r) => r.hasFilings);
console.log(`baseline, symbols with filing history: ${agg(R)}\n`);

const tone = (r) => (r.buys && r.realSells ? 'mixed' : r.buys ? 'buying' : r.realSells ? 'selling' : 'quiet');
show('Tone in the 90 days before the breakout', [
  ['buying only', R.filter((r) => tone(r) === 'buying')],
  ['buying and selling', R.filter((r) => tone(r) === 'mixed')],
  ['discretionary selling only', R.filter((r) => tone(r) === 'selling')],
  ['nothing open-market', R.filter((r) => tone(r) === 'quiet')],
]);

show('Buying: how many different insiders', [
  ['no buyer', R.filter((r) => r.buyers === 0)],
  ['1 buyer', R.filter((r) => r.buyers === 1)],
  ['2 buyers', R.filter((r) => r.buyers === 2)],
  ['3 or more buyers', R.filter((r) => r.buyers >= 3)],
]);

show('Buying: dollars, as days of the average dollar volume', [
  ['none', R.filter((r) => r.buyValue === 0)],
  ['under 0.1 day', R.filter((r) => r.buyValue > 0 && r.buyDays < 0.1)],
  ['0.1 to 0.5 day', R.filter((r) => r.buyDays >= 0.1 && r.buyDays < 0.5)],
  ['0.5 to 2 days', R.filter((r) => r.buyDays >= 0.5 && r.buyDays < 2)],
  ['2 days or more', R.filter((r) => r.buyDays >= 2)],
]);

show('Selling, split the way the screen splits it', [
  ['no sale at all', R.filter((r) => r.sells === 0)],
  ['only 10b5-1 planned sales', R.filter((r) => r.sells > 0 && r.plannedSells === r.sells)],
  ['only exercise-and-sell', R.filter((r) => r.sells > 0 && r.exerciseSells === r.sells && r.plannedSells === 0)],
  ['1 discretionary sale', R.filter((r) => r.realSells === 1)],
  ['2 to 4 discretionary', R.filter((r) => r.realSells >= 2 && r.realSells <= 4)],
  ['5 or more discretionary', R.filter((r) => r.realSells >= 5)],
]);

show('Selling: dollars, as days of the average dollar volume', [
  ['none', R.filter((r) => r.sellValue === 0)],
  ['under 0.5 day', R.filter((r) => r.sellValue > 0 && r.sellDays < 0.5)],
  ['0.5 to 2 days', R.filter((r) => r.sellDays >= 0.5 && r.sellDays < 2)],
  ['2 days or more', R.filter((r) => r.sellDays >= 2)],
]);

show('Does a cluster buy survive a year at a time', [...new Set(R.map((r) => r.year))].sort().map((y) => {
  const c = R.filter((r) => r.year === y && r.buyers >= 2);
  return [`${y}  cluster`, c];
}));

console.log('── The two sides against each other');
const buying = R.filter((r) => r.buyers >= 1);
const sellingOnly = R.filter((r) => r.realSells >= 1 && r.buyers === 0);
const quiet = R.filter((r) => r.buys === 0 && r.sells === 0);
for (const [l, rs] of [['any insider buying', buying], ['discretionary selling, no buying', sellingOnly], ['nothing filed', quiet]]) {
  console.log(`   ${l.padEnd(34)} ${agg(rs)}`);
}


// ── Is any of it an edge, or is it thinness? ────────────────────────────────
// Every bucket above that looked better also carried a higher stop rate and a
// wider spread of outcomes, which is what a thinner, wilder stock looks like,
// not what information looks like. So compare like with like: inside one band
// of dollar volume, does insider buying separate from no insider buying?
const bands = [[0.75e6, 5e6], [5e6, 25e6], [25e6, 100e6], [100e6, Infinity]];
console.log('\n\u2500\u2500 Insider buying against no buying, inside one liquidity band');
for (const [lo, hi] of bands) {
  const band = R.filter((r) => r.dv >= lo && r.dv < hi);
  const label = hi === Infinity ? '$100M and up' : `$${(lo / 1e6).toFixed(lo < 1e6 ? 2 : 0)}M to $${(hi / 1e6).toFixed(0)}M`;
  console.log(`   ${label}`);
  console.log(`     buying (1+)       ${agg(band.filter((r) => r.buyers >= 1))}`);
  console.log(`     cluster (2+)      ${agg(band.filter((r) => r.buyers >= 2))}`);
  console.log(`     no buying         ${agg(band.filter((r) => r.buyers === 0))}`);
}
