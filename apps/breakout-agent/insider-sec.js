// The SEC side of Form 4: ticker → CIK → the filings themselves.
//
// No API key and no vendor. Two public endpoints:
//   www.sec.gov/files/company_tickers.json        every listed ticker → CIK
//   data.sec.gov/submissions/CIK##########.json   that issuer's recent filings
// then the filing's own XML out of the Archives.
//
// SEC asks for a declaring User-Agent and no more than 10 requests a second.
// We hold ourselves to 6, serialised through one gap so a burst of symbols
// cannot stack up, and we never call this from the scanner shards — the nightly
// refresh in server.js is one process with one limiter.
import { parseForm4 } from './insider.js';

const UA = process.env.SEC_USER_AGENT || 'DataQuant breakout screener (nipunhsud@gmail.com)';
const MIN_GAP_MS = 1000 / 6;
const TICKER_MAP_TTL = 24 * 60 * 60 * 1000;

let lastCall = 0;
async function secFetch(url, { json = false } = {}) {
  const wait = lastCall + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' } });
  if (!res.ok) throw new Error(`SEC ${res.status} ${url}`);
  return json ? res.json() : res.text();
}

let tickerMap = { at: 0, byTicker: new Map() };
export async function cikFor(symbol) {
  const sym = String(symbol || '').toUpperCase().replace(/\./g, '-');
  if (!sym) return null;
  if (Date.now() - tickerMap.at > TICKER_MAP_TTL) {
    const data = await secFetch('https://www.sec.gov/files/company_tickers.json', { json: true });
    const byTicker = new Map();
    for (const row of Object.values(data || {})) {
      if (row?.ticker) byTicker.set(String(row.ticker).toUpperCase(), String(row.cik_str).padStart(10, '0'));
    }
    if (byTicker.size) tickerMap = { at: Date.now(), byTicker };
  }
  return tickerMap.byTicker.get(sym) || null;
}

// The Form 4 accessions this issuer's insiders filed since `since` (YYYY-MM-DD).
// `filings.recent` holds the newest ~1000 filings of every type, which covers a
// 90-day window for all but the most prolific filers; we do not page further
// back because anything older than the window would be dropped anyway.
export async function form4RefsSince(cik, since) {
  const data = await secFetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { json: true });
  const r = data?.filings?.recent;
  if (!r?.form) return { name: data?.name || null, refs: [] };
  const refs = [];
  for (let i = 0; i < r.form.length; i++) {
    if (r.form[i] !== '4') continue;
    if (since && r.filingDate[i] < since) continue;
    refs.push({
      accession: r.accessionNumber[i],
      filedAt: r.filingDate[i],
      primaryDocument: r.primaryDocument[i],
    });
  }
  return { name: data?.name || null, refs };
}

// The rendered document sits under xslF345X0N/; the raw XML is the same name at
// the directory root. Strip the prefix rather than guess the filename.
const rawDoc = (primaryDocument) => String(primaryDocument || '').replace(/^xsl[^/]*\//, '');

export function filingUrl(cik, accession, primaryDocument) {
  const bare = String(accession).replace(/-/g, '');
  const dir = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${bare}`;
  return primaryDocument ? `${dir}/${rawDoc(primaryDocument)}` : `${dir}/`;
}
// What a person should open: EDGAR's human-readable filing index.
export function humanUrl(cik, accession) {
  const bare = String(accession).replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${bare}/${accession}-index.htm`;
}

// Every Form 4 for a symbol in the window, parsed. Filings that fail to parse
// are skipped rather than failing the symbol — one malformed document should
// not cost us the other twenty.
export async function loadForm4s(symbol, { windowDays = 90, max = 60 } = {}) {
  const cik = await cikFor(symbol);
  if (!cik) return { cik: null, filings: [] };
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { refs } = await form4RefsSince(cik, since);
  const filings = [];
  for (const ref of refs.slice(0, max)) {
    try {
      const xml = await secFetch(filingUrl(cik, ref.accession, ref.primaryDocument));
      const parsed = parseForm4(xml);
      if (parsed) filings.push({ ...parsed, filedAt: ref.filedAt, link: humanUrl(cik, ref.accession) });
    } catch (err) {
      console.warn(`[form4] ${symbol} ${ref.accession}: ${err?.message || err}`);
    }
  }
  return { cik, filings };
}
