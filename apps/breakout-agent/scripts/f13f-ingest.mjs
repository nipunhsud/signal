// Who owns this stock, by name, from Form 13F.
//
// Every institutional manager with over $100M under discretion files a 13F
// within 45 days of each quarter end, listing every US equity position: issuer,
// CUSIP, share count and market value. SEC publishes the lot as quarterly
// structured TSVs, free and with no key:
//   https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets
//
// Three problems this script solves, none of them obvious from the raw files.
//
// 1. 13F reports CUSIP, never a ticker. The mapping comes from SEC's own
//    fails-to-deliver files, which carry CUSIP and SYMBOL side by side for
//    essentially every US-listed equity. Also free, also official.
//
// 2. VALUE changed units. Filings were in $thousands until 2023 and in whole
//    dollars after, and a meaningful minority of filers still report thousands
//    — 494 of NVDA's holders for 2026-06-30, carrying 32% of its reported share
//    count. Netting them together understates ownership by a third. So every
//    row is refereed against the actual close on the period end: value/shares
//    must land near the close, or near it after multiplying by 1000, or the row
//    is dropped as unusable. That also catches outright filing errors, like a
//    pension fund reporting 7.0 billion NVDA shares.
//
// 3. Amendments restate. For each (manager CIK, period) only the accession with
//    the latest filing date is kept, so an amendment replaces the original
//    rather than doubling it.
//
// Usage:
//   node scripts/f13f-ingest.mjs --dry-run          # validate, write nothing
//   node scripts/f13f-ingest.mjs                    # 4 windows into Postgres
//   node scripts/f13f-ingest.mjs --windows 8
//
// Cadence. 13F is quarterly and due 45 days after the quarter ends, so there is
// nothing new to fetch between deadlines and this is not a job for the server
// process — it moves 100MB a window and about 12M rows. Run it by hand, or from
// cron, in the week after each deadline: mid-February, mid-May, mid-August,
// mid-November. `--windows 2` is the cheap incremental run and the minimum that
// still produces the quarter-over-quarter change counts, because the prior
// quarter has to be in the same pass to be compared against.
//
// Zips and the CUSIP map are cached under study-cache/13f, so a rerun only
// downloads what it does not already have.
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { execFileSync, spawnSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { INDEX_MANAGERS, isIndexManager } from '../institutions.js';

const UA = process.env.SEC_USER_AGENT || 'DataQuant breakout screener (nipunhsud@gmail.com)';
const CACHE = './study-cache/13f';
const ZIPS = path.join(CACHE, 'zips');
const FAILS = path.join(CACHE, 'fails');
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt;
};
const DRY = process.argv.includes('--dry-run');
const WINDOWS = Number(arg('windows', 4));
const TOP_HOLDERS = 25;

fs.mkdirSync(ZIPS, { recursive: true });
fs.mkdirSync(FAILS, { recursive: true });

const get = async (url) => {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res;
};
const download = async (url, dest) => {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return false;
  fs.writeFileSync(dest, Buffer.from(await (await get(url)).arrayBuffer()));
  return true;
};

// ── 1. CUSIP → symbol, from the fails-to-deliver files ──────────────────────
// Each half-month file carries ~13k CUSIP/SYMBOL pairs. Eighteen of them cover
// the whole listed market; when a ticker changed, the newest settlement date
// wins.
async function cusipMap() {
  const page = await (await get('https://www.sec.gov/data/foiadocsfailsdatahtm')).text();
  const paths = [...new Set([...page.matchAll(/href="([^"]*cnsfails[^"]*\.zip)"/g)].map((m) => m[1]))].slice(0, 18);
  for (const p of paths) await download(`https://www.sec.gov${p}`, path.join(FAILS, path.basename(p)));
  const best = new Map(); // cusip -> [settlementDate, symbol]
  for (const f of fs.readdirSync(FAILS).filter((f) => f.endsWith('.zip'))) {
    const text = execFileSync('unzip', ['-p', path.join(FAILS, f)], { maxBuffer: 1 << 30, encoding: 'utf8' });
    for (const line of text.split('\n')) {
      const c = line.split('|');
      if (c.length < 5 || c[1] === 'CUSIP') continue;
      const [date, cusip, symbol] = c;
      if (!cusip || !symbol) continue;
      const cur = best.get(cusip);
      if (!cur || cur[0] < date) best.set(cusip, [date, symbol.trim().toUpperCase()]);
    }
  }
  const map = new Map([...best].map(([c, [, s]]) => [c, s]));
  console.log(`cusip map: ${map.size.toLocaleString()} CUSIPs`);
  return map;
}

// ── 2. the 13F window zips ──────────────────────────────────────────────────
async function windowZips() {
  const page = await (await get('https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets')).text();
  const paths = [...new Set([...page.matchAll(/href="([^"]*form13f\.zip)"/g)].map((m) => m[1]))].slice(0, WINDOWS);
  const out = [];
  for (const p of paths) {
    const dest = path.join(ZIPS, path.basename(p));
    const fresh = await download(`https://www.sec.gov${p}`, dest);
    console.log(`  ${path.basename(p)} ${(fs.statSync(dest).size / 1e6).toFixed(0)}MB${fresh ? '' : ' (cached)'}`);
    out.push(dest);
  }
  return out;
}

// 13F dates are DD-MON-YYYY.
const MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const iso = (v) => {
  const s = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const [d, mon, y] = s.split(/\s+/)[0].split('-');
  const m = MON[(mon || '').toUpperCase()];
  if (!m || !y) return '';
  return `${y}-${String(m).padStart(2, '0')}-${String(Number(d)).padStart(2, '0')}`;
};

// One window's holdings, as raw text lines, via unzip and awk. Doing the join
// in awk keeps a 400MB INFOTABLE out of this process entirely.
function extractWindow(zip, mapFile) {
  const cp = `${zip}.coverpage.tsv`;
  const sb = `${zip}.submission.tsv`;
  // Most windows hold their tables at the root; some nest them under a
  // directory named after the window (01JUN2025-31AUG2025_form13f/COVERPAGE.tsv).
  // A leading wildcard matches both — without it that window extracts nothing
  // and the whole quarter goes missing silently.
  for (const [member, dest] of [['*COVERPAGE.tsv', cp], ['*SUBMISSION.tsv', sb]]) {
    fs.writeFileSync(dest, execFileSync('unzip', ['-p', zip, member], { maxBuffer: 1 << 30 }));
  }
  const program = `
BEGIN {
  while ((getline line < cp) > 0) { split(line, f, "\\t"); if (f[1] == "ACCESSION_NUMBER") continue; per[f[1]] = f[2]; mgr[f[1]] = f[10]; }
  while ((getline line < sb) > 0) { split(line, f, "\\t"); if (f[1] == "ACCESSION_NUMBER") continue; cik[f[1]] = f[4]; fdt[f[1]] = f[2]; }
  while ((getline line < mapf) > 0) { split(line, f, "\\t"); sym[f[1]] = f[2]; }
}
NR == 1 { next }
{
  a = $1; if (!(a in per)) next;
  if ($10 != "") next;          # PUTCALL — an option is not a share position
  if ($9 != "SH") next;         # SSHPRNAMTTYPE — shares, not principal amount
  s = sym[$5]; if (s == "") next;
  q = $8 + 0; if (q <= 0) next;
  print per[a] "\\t" s "\\t" mgr[a] "\\t" cik[a] "\\t" a "\\t" fdt[a] "\\t" q "\\t" ($7 + 0);
}`;
  const out = `${zip}.rows.tsv`;
  const fd = fs.openSync(out, 'w');
  const r = spawnSync('sh', ['-c', `unzip -p '${zip}' '*INFOTABLE.tsv' | awk -F'\\t' -v cp='${cp}' -v sb='${sb}' -v mapf='${mapFile}' '${program.replace(/'/g, "'\\''")}'`], { stdio: ['ignore', fd, 'inherit'] });
  fs.closeSync(fd);
  if (r.status !== 0) throw new Error(`extract failed for ${zip}`);
  for (const f of [cp, sb]) fs.unlinkSync(f);
  return out;
}

// ── main ────────────────────────────────────────────────────────────────────
const db = new PrismaClient();
try {
  const map = await cusipMap();
  const mapFile = path.join(CACHE, 'cusip-symbol.tsv');
  fs.writeFileSync(mapFile, [...map].map(([c, s]) => `${c}\t${s}`).join('\n') + '\n');

  console.log(`\n${WINDOWS} filing windows:`);
  const zips = await windowZips();
  const rowFiles = [];
  for (const z of zips) {
    const f = extractWindow(z, mapFile);
    console.log(`  extracted ${path.basename(z)} → ${execFileSync('wc', ['-l', f]).toString().trim().split(' ')[0]} rows`);
    rowFiles.push(f);
  }

  // Pass 1: the winning accession per (cik, period), and the periods present.
  const winner = new Map();
  const periodRows = new Map();
  for (const f of rowFiles) {
    const rl = readline.createInterface({ input: fs.createReadStream(f), crlfDelay: Infinity });
    for await (const line of rl) {
      const c = line.split('\t');
      if (c.length < 8) continue;
      const period = iso(c[0]);
      if (!period) continue;
      periodRows.set(period, (periodRows.get(period) || 0) + 1);
      const key = `${c[3]}|${period}`;
      const filed = iso(c[5]);
      const cur = winner.get(key);
      if (!cur || cur.filed < filed) winner.set(key, { filed, accession: c[4] });
    }
  }
  // Only the quarters that actually arrived in bulk; the trickle of stragglers
  // from older periods is not a complete roster and must not be presented as
  // one.
  const periods = [...periodRows].filter(([, n]) => n >= 500_000).map(([p]) => p).sort().reverse();
  console.log(`\nperiods with a full roster: ${periods.join(', ')}`);
  if (!periods.length) throw new Error('no period had enough rows to be a complete roster');

  // Close on each period end, to referee the VALUE unit.
  const closes = new Map();
  for (const period of periods) {
    const rows = await db.$queryRawUnsafe(
      `SELECT symbol, close FROM (SELECT symbol, close, row_number() OVER (PARTITION BY symbol ORDER BY date DESC) rn FROM "DailyBar" WHERE date <= $1) t WHERE rn = 1`,
      period,
    );
    for (const r of rows) closes.set(`${period}|${r.symbol}`, Number(r.close));
    console.log(`  ${period}: ${rows.length.toLocaleString()} closes`);
  }

  // Pass 2: keep the winning accessions, correct the unit, write one line per
  // (symbol, period, manager) for sorting.
  const keep = path.join(CACHE, 'kept.tsv');
  const w = fs.createWriteStream(keep);
  let kept = 0, unpriced = 0, unusable = 0, rescaled = 0;
  for (const f of rowFiles) {
    const rl = readline.createInterface({ input: fs.createReadStream(f), crlfDelay: Infinity });
    for await (const line of rl) {
      const c = line.split('\t');
      if (c.length < 8) continue;
      const period = iso(c[0]);
      if (!periods.includes(period)) continue;
      const [, symbol, manager, cik, accession] = c;
      if (winner.get(`${cik}|${period}`)?.accession !== accession) continue;
      const shares = Number(c[6]);
      let value = Number(c[7]);
      const px = closes.get(`${period}|${symbol}`);
      // No close means the symbol is outside the universe we carry bars for —
      // most of the 19k CUSIPs in a 13F are. That is not a bad filing.
      if (!(px > 0)) { unpriced++; continue; }
      if (!(shares > 0)) { unusable++; continue; }
      const implied = value / shares;
      if (implied >= px * 0.6 && implied <= px * 1.6) { /* whole dollars */ }
      else if (implied * 1000 >= px * 0.6 && implied * 1000 <= px * 1.6) { value *= 1000; rescaled++; }
      else { unusable++; continue; }
      w.write(`${symbol}\t${period}\t${cik}\t${manager.trim()}\t${shares}\t${value}\n`);
      kept++;
    }
  }
  await new Promise((r) => { w.on('finish', r); w.end(); });
  console.log(`\nkept ${kept.toLocaleString()} positions · rescaled ${rescaled.toLocaleString()} filed in thousands`);
  console.log(`skipped ${unpriced.toLocaleString()} outside our bar universe · ${unusable.toLocaleString()} whose value and share count agree with no plausible price`);

  // Sort by symbol so one symbol's whole history fits in memory at a time.
  const sorted = path.join(CACHE, 'sorted.tsv');
  execFileSync('sh', ['-c', `LC_ALL=C sort -t'\t' -k1,1 -k2,2 '${keep}' > '${sorted}'`], { maxBuffer: 1 << 30 });

  // ── roll up ───────────────────────────────────────────────────────────────
  const newest = periods[0];
  const flush = async (symbol, byPeriod) => {
    const out = [];
    for (const period of periods) {
      const cur = byPeriod.get(period);
      if (!cur) continue;
      const prior = byPeriod.get(periods[periods.indexOf(period) + 1]) || null;
      let shares = 0, value = 0;
      for (const h of cur.values()) { shares += h.shares; value += h.value; }
      let opened = 0, closedOut = 0, added = 0, reduced = 0;
      if (prior) {
        for (const [k, h] of cur) {
          const p = prior.get(k);
          if (!p) opened++;
          else if (h.shares > p.shares * 1.02) added++;
          else if (h.shares < p.shares * 0.98) reduced++;
        }
        for (const k of prior.keys()) if (!cur.has(k)) closedOut++;
      }
      let priorShares = 0, priorValue = 0;
      if (prior) for (const h of prior.values()) { priorShares += h.shares; priorValue += h.value; }
      const holders = [...cur.entries()]
        .map(([k, h]) => ({ ...h, cik: k, priorShares: prior?.get(k)?.shares ?? null }))
        .sort((a, b) => b.value - a.value);
      out.push({
        asset: symbol, period, holders: cur.size, shares, value,
        holdersPrior: prior ? prior.size : null,
        sharesPrior: prior ? priorShares : null,
        valuePrior: prior ? priorValue : null,
        opened: prior ? opened : null,
        closed: prior ? closedOut : null,
        added: prior ? added : null,
        reduced: prior ? reduced : null,
        activeHolders: [...cur.values()].filter((h) => !isIndexManager(h.manager)).length,
        top: holders.slice(0, TOP_HOLDERS),
      });
    }
    if (!out.length) return;
    if (DRY) {
      if (['NVDA', 'MXL', 'RSKD', 'QMCO'].includes(symbol)) {
        const o = out[0];
        const px = closes.get(`${o.period}|${symbol}`);
        console.log(`\n${symbol} ${o.period}: ${o.holders} holders ($${(o.value / 1e9).toFixed(2)}B, ${(o.shares / 1e6).toFixed(1)}M shares, implied $${(o.value / o.shares).toFixed(2)} vs close $${px?.toFixed(2)})`);
        console.log(`  prior ${o.holdersPrior} holders · ${o.opened} opened · ${o.closed} exited · ${o.added} added · ${o.reduced} reduced · ${o.activeHolders} not index funds`);
        for (const h of o.top.slice(0, 6)) {
          const chg = h.priorShares == null ? 'new' : `${h.shares > h.priorShares ? '+' : ''}${(((h.shares - h.priorShares) / h.priorShares) * 100).toFixed(0)}%`;
          console.log(`    ${(h.manager || '').slice(0, 44).padEnd(45)} $${(h.value / 1e6).toFixed(0)}M  ${(h.shares / 1e6).toFixed(2)}M sh  ${chg}${isIndexManager(h.manager) ? '  [index]' : ''}`);
        }
      }
      return;
    }
    for (const o of out) {
      const { top, ...roll } = o;
      await db.institutionalOwnership.upsert({
        where: { asset_period: { asset: roll.asset, period: roll.period } },
        create: roll, update: roll,
      });
      await db.institutionalHolder.deleteMany({ where: { asset: roll.asset, period: roll.period } });
      await db.institutionalHolder.createMany({
        data: top.map((h, i) => ({
          asset: roll.asset, period: roll.period, manager: h.manager || 'unknown',
          cik: h.cik || null, shares: h.shares, value: h.value, rank: i + 1,
          priorShares: h.priorShares, isIndex: isIndexManager(h.manager),
        })),
        skipDuplicates: true,
      });
    }
  };

  let curSymbol = null, byPeriod = new Map(), symbols = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(sorted), crlfDelay: Infinity });
  for await (const line of rl) {
    const [symbol, period, cik, manager, shares, value] = line.split('\t');
    if (symbol !== curSymbol) {
      if (curSymbol) { await flush(curSymbol, byPeriod); symbols++; if (symbols % 2000 === 0) console.log(`  ${symbols} symbols`); }
      curSymbol = symbol; byPeriod = new Map();
    }
    let p = byPeriod.get(period);
    if (!p) byPeriod.set(period, (p = new Map()));
    // Keyed by CIK: a manager that renames its filing entity is the same
    // holder, and keying on the name turned every Vanguard rename into a
    // brand-new position.
    const cur = p.get(cik);
    if (cur) { cur.shares += Number(shares); cur.value += Number(value); }
    else p.set(cik, { shares: Number(shares), value: Number(value), manager });
  }
  if (curSymbol) { await flush(curSymbol, byPeriod); symbols++; }
  console.log(`\n${symbols.toLocaleString()} symbols${DRY ? ' (dry run — nothing written)' : ' written'}`);
  console.log(`index managers recognised: ${INDEX_MANAGERS.length}`);
} finally {
  await db.$disconnect();
}
