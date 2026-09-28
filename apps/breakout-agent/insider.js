// Form 4 — what the people who run the company did with their own shares.
//
// Why this and not 13F: a 13F is a quarterly snapshot filed up to 45 days after
// the quarter ends, so it can be 135 days stale. Section 16 insiders (officers,
// directors) and any 10% owner must file a Form 4 within two business days of
// the transaction. It is the only ownership filing that keeps pace with a base.
//
// What counts. Only open-market transactions say anything about conviction:
//   P  purchase   — bought with their own money
//   S  sale       — sold
// Everything else is compensation plumbing and is counted separately, never as
// a buy or a sell:
//   A grant/award   M option exercise   F shares withheld for tax
//   D disposition to the issuer   G gift   C conversion   X in-the-money exercise
//
// Two honesty adjustments the raw counts miss:
//   · a sale filed under a 10b5-1 plan was scheduled months earlier, so it is
//     not a read on today's price — `plannedSells` separates those out
//   · an S on the same day as an M is an exercise-and-sell, mechanically a
//     compensation event, not a decision to reduce a held position
//
// Pure functions over already-fetched filings. The fetching lives in
// insider-sec.js; the storage in the InsiderActivity table.

const OPEN_MARKET = new Set(['P', 'S']);

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : null;
};
// <transactionShares><value>50000</value></transactionShares>
const valueOf = (xml, name) => {
  const block = tag(xml, name);
  if (block == null) return null;
  const v = tag(block, 'value');
  return v == null ? (block.includes('<') ? null : block) : v;
};
const num = (s) => {
  if (s == null || s === '') return null;
  const n = Number(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
const blocks = (xml, name) => {
  const out = [];
  const re = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g');
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
};

// One Form 4 XML → the facts we keep. Returns null if it is not a Form 4.
export function parseForm4(xml) {
  if (!xml || !/<ownershipDocument/.test(xml)) return null;
  const docType = valueOf(xml, 'documentType') || tag(xml, 'documentType');
  if (docType && docType !== '4') return null;

  const issuer = tag(xml, 'issuer') || '';
  const ownerBlock = tag(xml, 'reportingOwner') || '';
  const rel = tag(ownerBlock, 'reportingOwnerRelationship') || '';
  const isDirector = tag(rel, 'isDirector') === '1';
  const isOfficer = tag(rel, 'isOfficer') === '1';
  const isTenPercent = tag(rel, 'isTenPercentOwner') === '1';
  const officerTitle = valueOf(rel, 'officerTitle');

  // Document-level 10b5-1 affirmation. Newer filings also carry a per-
  // transaction flag; either one marks the sale as pre-scheduled.
  const docPlanned = (valueOf(xml, 'aff10b5One') || tag(xml, 'aff10b5One')) === '1';

  const nonDeriv = tag(xml, 'nonDerivativeTable') || '';
  const transactions = [];
  for (const t of blocks(nonDeriv, 'nonDerivativeTransaction')) {
    const coding = tag(t, 'transactionCoding') || '';
    const code = tag(coding, 'transactionCode');
    if (!code) continue;
    const amounts = tag(t, 'transactionAmounts') || '';
    transactions.push({
      date: valueOf(t, 'transactionDate'),
      code,
      shares: num(valueOf(amounts, 'transactionShares')),
      price: num(valueOf(amounts, 'transactionPricePerShare')),
      ad: valueOf(amounts, 'transactionAcquiredDisposedCode'), // A acquired | D disposed
      planned: docPlanned || tag(t, 'rule10b5One') === '1',
    });
  }

  return {
    symbol: (tag(issuer, 'issuerTradingSymbol') || '').toUpperCase() || null,
    issuerCik: tag(issuer, 'issuerCik') || null,
    periodOfReport: valueOf(xml, 'periodOfReport') || tag(xml, 'periodOfReport'),
    owner: tag(tag(ownerBlock, 'reportingOwnerId') || '', 'rptOwnerName'),
    isDirector, isOfficer, isTenPercent, officerTitle,
    role: roleWords({ isDirector, isOfficer, isTenPercent, officerTitle }),
    transactions,
  };
}

export function roleWords(f) {
  if (!f) return null;
  if (f.officerTitle) return f.officerTitle;
  if (f.isTenPercent) return '10% owner';
  if (f.isOfficer) return 'officer';
  if (f.isDirector) return 'director';
  return null;
}

// Fold a list of parsed filings into the 90-day picture stored per symbol.
// `filings` carry a `filedAt` (YYYY-MM-DD) and `link` added by the fetcher.
export function summarizeInsider(filings, { asOf = new Date(), windowDays = 90 } = {}) {
  const cutoff = new Date(asOf.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const dayKey = (d) => (d ? String(d).slice(0, 10) : null);
  let buys = 0, sells = 0, buyShares = 0, sellShares = 0, buyValue = 0, sellValue = 0;
  let plannedSells = 0, exerciseSells = 0;
  const buyers = new Set(), sellers = new Set();
  let latest = null, lastFiledAt = null;
  let considered = 0;

  for (const f of filings || []) {
    if (f?.filedAt && (!lastFiledAt || f.filedAt > lastFiledAt)) lastFiledAt = f.filedAt;
    if (!f?.transactions?.length) continue;
    // Which days in this filing also carried an option exercise.
    const exerciseDays = new Set(
      f.transactions.filter((t) => t.code === 'M' || t.code === 'X').map((t) => dayKey(t.date)),
    );
    let counted = false;
    for (const t of f.transactions) {
      if (!OPEN_MARKET.has(t.code)) continue;
      const d = dayKey(t.date);
      if (d && new Date(`${d}T00:00:00Z`) < cutoff) continue;
      counted = true;
      const shares = t.shares || 0;
      const value = shares * (t.price || 0);
      const isBuy = t.code === 'P';
      if (isBuy) {
        buys++; buyShares += shares; buyValue += value;
        if (f.owner) buyers.add(f.owner);
      } else {
        sells++; sellShares += shares; sellValue += value;
        if (f.owner) sellers.add(f.owner);
        if (t.planned) plannedSells++;
        if (d && exerciseDays.has(d)) exerciseSells++;
      }
      if (!latest || (d && d > latest.date)) {
        latest = {
          date: d, kind: isBuy ? 'buy' : 'sell', owner: f.owner || null,
          role: f.role || null, shares, price: t.price ?? null,
          planned: !isBuy && !!t.planned, link: f.link || null,
        };
      }
    }
    if (counted) considered++;
  }

  // Tone. Discretionary sales are what carry information, so scheduled sales
  // and exercise-and-sells come out of the count before we call it selling.
  const realSells = Math.max(0, sells - plannedSells - exerciseSells);
  let tone = 'quiet';
  if (buys && realSells) tone = 'mixed';
  else if (buys) tone = 'buying';
  else if (realSells) tone = 'selling';

  return {
    windowDays,
    buys, sells, realSells, plannedSells, exerciseSells,
    buyers: buyers.size, sellers: sellers.size,
    buyShares, sellShares,
    buyValue: Math.round(buyValue), sellValue: Math.round(sellValue),
    netValue: Math.round(buyValue - sellValue),
    // Two or more different insiders buying inside the window. A single
    // director adding is one opinion; three is a pattern.
    cluster: buyers.size >= 2,
    tone, latest, lastFiledAt,
    filings: considered,
  };
}

const money = (v) => {
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${Math.round(v / 1e3)}k`;
  return `$${Math.round(v)}`;
};
const shareCount = (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : String(Math.round(v)));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// Two words for the badge: what insiders did, nothing about what to do.
export function insiderTag(s) {
  if (!s) return null;
  if (s.tone === 'buying') return s.cluster ? 'insider cluster buy' : 'insider buy';
  if (s.tone === 'mixed') return 'insiders both ways';
  if (s.tone === 'selling') return 'insider selling';
  return null;
}

// One sentence, in the product voice: what happened, who, how much, how stale.
export function insiderWords(s, { asOf = new Date() } = {}) {
  if (!s) return '';
  if (!s.buys && !s.sells) {
    return s.lastFiledAt
      ? `No open-market insider buying or selling in the last ${s.windowDays} days. The newest Form 4 is ${s.lastFiledAt} and reported compensation only.`
      : `No Form 4 filed in the last ${s.windowDays} days.`;
  }
  const parts = [];
  if (s.buys) parts.push(`${plural(s.buyers, 'insider')} bought ${shareCount(s.buyShares)} shares, ${money(s.buyValue)}`);
  if (s.sells) {
    // The denominator matters: 38 planned sales reads very differently when
    // there were 41 sales than when there were 400.
    const of = (n) => `${n} of ${s.sells}`;
    const caveat = [
      s.plannedSells ? `${of(s.plannedSells)} under a 10b5-1 plan` : null,
      s.exerciseSells ? `${of(s.exerciseSells)} an exercise and sell` : null,
    ].filter(Boolean).join(', ');
    parts.push(`${plural(s.sellers, 'insider')} sold ${shareCount(s.sellShares)} shares, ${money(s.sellValue)} over ${plural(s.sells, 'sale')}${caveat ? ` (${caveat})` : ''}`);
  }
  let out = `${parts.join(' and ')} in the last ${s.windowDays} days.`;
  if (s.latest?.date) {
    const days = Math.round((asOf.getTime() - new Date(`${s.latest.date}T00:00:00Z`).getTime()) / 86400000);
    const who = [s.latest.owner, s.latest.role].filter(Boolean).join(', ');
    const at = s.latest.price ? ` at $${s.latest.price.toFixed(2)}` : '';
    out += ` The newest was ${s.latest.kind === 'buy' ? 'a purchase' : 'a sale'} of ${shareCount(s.latest.shares)} shares${at} on ${s.latest.date}${days >= 0 ? `, ${days === 0 ? 'today' : plural(days, 'day') + ' ago'}` : ''}${who ? ` by ${who}` : ''}.`;
  }
  return out;
}
