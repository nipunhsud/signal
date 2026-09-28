// Build study-cache/form4-trans.tsv.gz — every Form 4 transaction since 2010.
//
// Source: SEC's quarterly Insider Transactions Data Sets, the same structured
// TSV treatment the financial-statement sets get. Free, no key, no vendor.
//   https://www.sec.gov/data-research/sec-markets-data/insider-transactions-data-sets
//
// Downloads each quarter's zip, then flattens three of its tables into one
// gzip TSV: SUBMISSION (symbol, filing date, 10b5-1 affirmation) joined to
// NONDERIV_TRANS (transaction date, code, shares, price) and REPORTINGOWNER
// (who filed). Codes kept: P purchase, S sale, and M/X option exercises so an
// exercise-and-sell can be told apart from a discretionary sale.
//
//   node scripts/form4-dataset.mjs                # 2010 onward, ~700MB of zips
//   node scripts/form4-dataset.mjs --from 2020q1
//
// Then: node scripts/insider-study.mjs
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { execFileSync } from 'child_process';

const UA = process.env.SEC_USER_AGENT || 'DataQuant breakout screener (nipunhsud@gmail.com)';
const CACHE = './study-cache';
const ZIPS = path.join(CACHE, 'form345-zips');
const OUT = path.join(CACHE, 'form4-trans.tsv.gz');
const FROM = (process.argv.includes('--from') ? process.argv[process.argv.indexOf('--from') + 1] : '2010q1').toLowerCase();
const KEEP = new Set(['P', 'S', 'M', 'X']);
const INDEX = 'https://www.sec.gov/data-research/sec-markets-data/insider-transactions-data-sets';

fs.mkdirSync(ZIPS, { recursive: true });

// SEC has moved these files between /files/structureddata/ and
// /files/datastandardsinnovation/, so read the paths off the index page rather
// than guessing them.
const page = await (await fetch(INDEX, { headers: { 'User-Agent': UA } })).text();
const paths = [...new Set([...page.matchAll(/href="([^"]*_form345\.zip)"/g)].map((m) => m[1]))]
  .filter((p) => path.basename(p).split('_')[0] >= FROM)
  .sort();
console.log(`${paths.length} quarters from ${FROM}`);

for (const p of paths) {
  const name = path.basename(p);
  const dest = path.join(ZIPS, name);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) continue;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`https://www.sec.gov${p}`, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      console.log(`  ${name} ${(fs.statSync(dest).size / 1e6).toFixed(0)}MB`);
      break;
    } catch (err) {
      console.warn(`  ${name} attempt ${attempt}: ${err.message}`);
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  await new Promise((r) => setTimeout(r, 300));
}

// ── flatten ─────────────────────────────────────────────────────────────────
const MON = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
// Quarters mix '2026-09-16' and '16-SEP-2026', sometimes with a time after it.
const ymd = (v) => {
  const s = String(v || '').trim();
  if (!s) return '';
  if (s.length >= 10 && s[4] === '-' && s[7] === '-') return s.slice(0, 10);
  const [d, mon, y] = s.split(/\s+/)[0].split('-');
  if (!MON[(mon || '').toUpperCase()]) return '';
  const yr = y?.length === 2 ? (Number(y) < 70 ? `20${y}` : `19${y}`) : y;
  return `${yr}-${MON[mon.toUpperCase()]}-${String(Number(d)).padStart(2, '0')}`;
};
// The TSVs are tab separated with no quoting, so a plain split is correct.
const table = (zip, member) => {
  const text = execFileSync('unzip', ['-p', zip, member], { maxBuffer: 1 << 30, encoding: 'utf8' });
  const lines = text.split('\n');
  const head = lines[0].split('\t');
  const col = (name) => head.indexOf(name);
  return { lines, col };
};

const out = zlib.createGzip();
const file = fs.createWriteStream(OUT);
out.pipe(file);
out.write('symbol\ttransDate\tfiledAt\tcode\tshares\tprice\townerCik\tplanned\trel\n');
let total = 0;
for (const name of fs.readdirSync(ZIPS).filter((f) => f.endsWith('.zip')).sort()) {
  const zip = path.join(ZIPS, name);
  const subs = new Map();
  {
    const { lines, col } = table(zip, 'SUBMISSION.tsv');
    const [cA, cF, cD, cS, cP] = ['ACCESSION_NUMBER', 'FILING_DATE', 'DOCUMENT_TYPE', 'ISSUERTRADINGSYMBOL', 'AFF10B5ONE'].map(col);
    for (let i = 1; i < lines.length; i++) {
      const f = lines[i].split('\t');
      if ((f[cD] || '').trim() !== '4') continue;
      const sym = (f[cS] || '').trim().toUpperCase();
      if (!sym || ['NONE', 'N/A', '-'].includes(sym)) continue;
      subs.set(f[cA], [sym, ymd(f[cF]), ['1', 'true', 'TRUE', 'Y'].includes((f[cP] || '').trim()) ? '1' : '0']);
    }
  }
  const owners = new Map();
  {
    const { lines, col } = table(zip, 'REPORTINGOWNER.tsv');
    const [cA, cC, cR] = ['ACCESSION_NUMBER', 'RPTOWNERCIK', 'RPTOWNER_RELATIONSHIP'].map(col);
    for (let i = 1; i < lines.length; i++) {
      const f = lines[i].split('\t');
      if (!f[cA] || owners.has(f[cA])) continue;
      owners.set(f[cA], [(f[cC] || '').trim(), (f[cR] || '').trim()]);
    }
  }
  let n = 0;
  {
    const { lines, col } = table(zip, 'NONDERIV_TRANS.tsv');
    const [cA, cT, cC, cS, cP] = ['ACCESSION_NUMBER', 'TRANS_DATE', 'TRANS_CODE', 'TRANS_SHARES', 'TRANS_PRICEPERSHARE'].map(col);
    for (let i = 1; i < lines.length; i++) {
      const f = lines[i].split('\t');
      const sub = subs.get(f[cA]);
      if (!sub) continue;
      const code = (f[cC] || '').trim().toUpperCase();
      if (!KEEP.has(code)) continue;
      const td = ymd(f[cT]);
      if (!td) continue;
      const [cik, rel] = owners.get(f[cA]) || ['', ''];
      out.write(`${sub[0]}\t${td}\t${sub[1]}\t${code}\t${f[cS] || ''}\t${f[cP] || ''}\t${cik}\t${sub[2]}\t${rel}\n`);
      n++;
    }
  }
  total += n;
  console.log(`${name}: ${n} rows (running ${total})`);
}
await new Promise((r) => { file.on('finish', r); out.end(); });
console.log(`\n${total.toLocaleString()} transactions -> ${OUT}`);
