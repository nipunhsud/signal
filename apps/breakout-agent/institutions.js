// Form 13F — which institutions hold a stock, by name.
//
// Every manager with over $100M under discretion files within 45 days of each
// quarter end, listing each US equity position with its share count and market
// value. That makes 13F the complete institutional roster and also the slowest
// ownership filing: at its worst a position is 135 days old by the time anyone
// can read it. It is a picture of the register, not a signal about today.
//
// The distinction that makes it readable: BlackRock, Vanguard, State Street and
// Geode hold nearly every listed company, because they run index funds and have
// to. Their presence on a register carries no opinion. Nor does a market
// maker's, whose 13F line is inventory against customer flow rather than a
// view. What is worth naming is the manager who chose the position — a
// Renaissance, an Alyeska, a Capital World — and, more than that, who opened or
// exited one since last quarter.
//
// One caveat on the change counts. Positions are compared by the filer's CIK,
// which survives a rename, but an index complex that splits itself into several
// filing entities — Vanguard did exactly that — shows the new entities as fresh
// positions and the old one as an exit. So "new this quarter" is only ever
// claimed for a holder that is neither an index complex nor a market maker.
//
// Pure functions. The ingest lives in scripts/f13f-ingest.mjs.

// Index and passive complexes. Matched loosely on the filer name as it appears
// on the cover page, which is why these are fragments rather than exact names.
export const INDEX_MANAGERS = [
  'BLACKROCK', 'VANGUARD', 'STATE STREET', 'GEODE CAPITAL', 'NORTHERN TRUST',
  'BANK OF NEW YORK MELLON', 'BNY MELLON', 'MELLON INVESTMENTS',
  'CHARLES SCHWAB INVESTMENT MANAGEMENT', 'DIMENSIONAL FUND', 'LEGAL & GENERAL',
  'NUVEEN', 'TEACHERS INSURANCE', 'NORGES BANK', 'INVESCO LTD', 'FIRST TRUST',
  'RAFFERTY ASSET', 'PROSHARE', 'ISHARES', 'SSGA', 'AMUNDI', 'DEKA INVESTMENT',
  'UBS ASSET MANAGEMENT', 'DWS INVESTMENT', 'CALIFORNIA PUBLIC EMPLOYEES',
  'CALIFORNIA STATE TEACHERS', 'SWISS NATIONAL BANK',
];

// Market makers and prime brokers. A 13F line here is inventory, not a view.
export const MARKET_MAKERS = [
  'JANE STREET', 'CITADEL ADVISORS', 'SUSQUEHANNA', 'TWO SIGMA SECURITIES',
  'OPTIVER', 'JUMP FINANCIAL', 'WOLVERINE', 'IMC CHICAGO', 'HRT FINANCIAL',
  'SIMPLEX TRADING', 'GROUP ONE TRADING', 'PEAK6', 'CTC TRADING',
  'BARCLAYS PLC', 'GOLDMAN SACHS GROUP', 'MORGAN STANLEY', 'JPMORGAN CHASE',
  'BANK OF AMERICA CORP', 'CITIGROUP', 'ROYAL BANK OF CANADA', 'WELLS FARGO',
];

const has = (name, list) => {
  const n = String(name || '').toUpperCase();
  return list.some((frag) => n.includes(frag));
};
export const isIndexManager = (name) => has(name, INDEX_MANAGERS);
export const isMarketMaker = (name) => has(name, MARKET_MAKERS);
// Neither chose the position for a reason we can read off the filing.
export const isPassiveHolder = (name) => isIndexManager(name) || isMarketMaker(name);

// The managers worth naming: they are not index funds and not market makers.
export function notableHolders(holders, limit = 6) {
  return (holders || []).filter((h) => !isPassiveHolder(h.manager)).slice(0, limit);
}

export const money = (v) => {
  if (v == null) return '—';
  const a = Math.abs(v);
  if (a >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
  if (a >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  if (a >= 1e3) return `$${Math.round(v / 1e3)}k`;
  return `$${Math.round(v)}`;
};
export const shareCount = (v) => {
  if (v == null) return '—';
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${Math.round(v / 1e3)}k`;
  return String(Math.round(v));
};
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// How the register moved, as a share of the holders that were there before. The
// count is what changes hands quarter to quarter; a handful either way on a
// register of four hundred is noise, so the words only claim a direction when
// the net is worth mentioning.
export function ownershipDrift(o) {
  if (!o || o.holdersPrior == null) return null;
  const net = o.holders - o.holdersPrior;
  const pct = o.holdersPrior ? (net / o.holdersPrior) * 100 : 0;
  const shareNet = o.sharesPrior ? ((o.shares - o.sharesPrior) / o.sharesPrior) * 100 : null;
  return {
    net, pct: Math.round(pct * 10) / 10,
    shareNetPct: shareNet == null ? null : Math.round(shareNet * 10) / 10,
    opened: o.opened, closed: o.closed, added: o.added, reduced: o.reduced,
    direction: pct >= 3 ? 'more' : pct <= -3 ? 'fewer' : 'flat',
    churn: registerChurn(o),
  };
}

// How much the register churned, regardless of which way.
//
// Measured over 49,382 graded breakouts 2003-2026
// (scripts/institutional-ownership-study.mjs): the DIRECTION of the change
// predicts nothing — a register that shrank 25% and one that grew 25% score the
// same. The SIZE of the change does. Breakouts where the register moved 20% or
// more either way, against a base of at least 50 holders, ran a 2.27 profit
// factor against 1.65 and reached +20% within 60 sessions 29.6% of the time
// against 15.5%, with the win rate flat at 52%. They also touched the fail
// level half the time against a third.
//
// So it is a size-of-winner label, the same shape as the tape activity score:
// it ranks a name, it never gates one. It survives both obvious confounds —
// inside one band of 3-month return and inside one band of dollar volume it
// leads on every rung, and the gap is widest in the most liquid band, which is
// the opposite of a thin-and-wild artifact. Reach was higher in all 14 years
// with enough data; profit factor in 10 of 14.
//
// The 50-holder floor is not optional. Without it the bucket fills with names
// carrying a median of five institutions, where going from four holders to six
// reads as +50%.
const CHURN_MIN_REGISTER = 50;
const CHURN_HEAVY_PCT = 20;

export function registerChurn(o) {
  if (!o || o.holdersPrior == null || o.holdersPrior < CHURN_MIN_REGISTER) return null;
  const pct = Math.abs(((o.holders - o.holdersPrior) / o.holdersPrior) * 100);
  return {
    pct: Math.round(pct * 10) / 10,
    heavy: pct >= CHURN_HEAVY_PCT,
    direction: o.holders >= o.holdersPrior ? 'in' : 'out',
    minRegister: CHURN_MIN_REGISTER,
  };
}

// What a churned register did next, in the product voice. Never says which way
// the churn went is good, because the study says it is not.
export function churnWords(c) {
  if (!c || !c.heavy) return '';
  return `The register turned over ${c.pct.toFixed(0)}% on the quarter. Breakouts where it moved 20% or more either way ran a 2.27 profit factor against 1.65 and reached +20% within 60 sessions 30% of the time against 15%, on a flat win rate — and touched the fail level half the time against a third. Size of move, not direction: a register that shrank that much scored the same as one that grew.`;
}

// Two or three words for the chip.
export function ownershipTag(o) {
  if (!o || !o.holders) return null;
  const d = ownershipDrift(o);
  if (!d || d.direction === 'flat') return `${o.holders} funds`;
  return `${o.holders} funds · ${d.net > 0 ? '+' : ''}${d.net}`;
}

// The sentence. Facts, in the order a reader wants them: how many, how much,
// which way it moved, and who is actually there by choice.
export function ownershipWords(o, holders = []) {
  if (!o || !o.holders) return 'No 13F holder reported this position.';
  const asOf = o.period ? ` as of ${o.period}` : '';
  const parts = [`${plural(o.holders, 'institution')} reported ${shareCount(o.shares)} shares worth ${money(o.value)}${asOf}`];
  const d = ownershipDrift(o);
  if (d) {
    const dir = d.net === 0 ? 'the same number as' : d.net > 0 ? `up from ${o.holdersPrior}` : `down from ${o.holdersPrior}`;
    parts.push(`${dir === 'the same number as' ? 'the same count as' : dir} the quarter before, with ${o.opened} opening a position and ${o.closed} exiting`);
  }
  let out = `${parts.join(', ')}.`;
  const notable = notableHolders(holders, 3);
  if (notable.length) {
    out += ` Largest outside the index funds are ${notable.map((h) => `${cleanName(h.manager)} ${money(h.value)}`).join(', ')}.`;
  }
  const fresh = (holders || []).filter((h) => h.priorShares == null && !isPassiveHolder(h.manager)).slice(0, 2);
  if (fresh.length) out += ` New this quarter: ${fresh.map((h) => `${cleanName(h.manager)} ${money(h.value)}`).join(' and ')}.`;
  return out;
}

// A 13F is filed by the MANAGER, not the fund. Fidelity's whole complex —
// Magellan, Contrafund, all of it — arrives as one line reading "FMR LLC", and
// the filing gives no way to split it by fund. (Fund-level holdings exist, in
// monthly N-PORT filings, which is a different ingest.) So the few houses a
// reader would recognise get their household name attached, and nothing else is
// guessed at.
const ALIASES = [
  [/^FMR LLC/i, 'Fidelity (FMR)'],
  [/^CAPITAL WORLD INVESTORS/i, 'Capital World Investors'],
  [/^CAPITAL RESEARCH GLOBAL/i, 'Capital Research Global'],
  [/^PRICE T ROWE/i, 'T. Rowe Price'],
  [/^WELLINGTON MANAGEMENT/i, 'Wellington Management'],
  [/^RENAISSANCE TECHNOLOGIES/i, 'Renaissance Technologies'],
  [/^BERKSHIRE HATHAWAY/i, 'Berkshire Hathaway'],
  [/^BAILLIE GIFFORD/i, 'Baillie Gifford'],
  [/^AKRE CAPITAL/i, 'Akre Capital'],
  [/^TIGER GLOBAL/i, 'Tiger Global'],
  [/^COATUE/i, 'Coatue'],
  [/^LONE PINE/i, 'Lone Pine'],
  [/^VIKING GLOBAL/i, 'Viking Global'],
  [/^D1 CAPITAL/i, 'D1 Capital'],
  [/^WHALE ROCK/i, 'Whale Rock'],
  [/^ALYESKA/i, 'Alyeska'],
  [/^MILLENNIUM MANAGEMENT/i, 'Millennium'],
  [/^POINT72/i, 'Point72'],
  [/^BRIDGEWATER/i, 'Bridgewater'],
  [/^AQR CAPITAL/i, 'AQR Capital'],
  [/^TWO SIGMA INVESTMENTS/i, 'Two Sigma'],
  [/^ARK INVESTMENT/i, 'ARK Invest'],
  [/^D\.? ?E\.? SHAW/i, 'D. E. Shaw'],
  [/^JPMORGAN/i, 'JPMorgan'],
  [/^GOLDMAN SACHS/i, 'Goldman Sachs'],
  [/^MORGAN STANLEY/i, 'Morgan Stanley'],
];

// Filer names are shouted and carry registration suffixes. Title-case them and
// drop the noise, but never expand an abbreviation we were not given.
export function cleanName(name) {
  const raw = String(name || '').trim().replace(/\s+/g, ' ');
  for (const [re, pretty] of ALIASES) if (re.test(raw)) return pretty;
  // The state or registration tag comes off first, or the suffix behind it
  // survives ("SOUTHERN CAPITAL SERVICES INC /ADV").
  let s = raw.replace(/\s*\/[A-Z]{2,3}\/?\s*$/i, '');
  const SUFFIX = /[,\s]+(INC|LLC|L\.?L\.?C|LP|L\.P\.|LTD|PLC|CORP|CO|S\.?A|AG|NV|AB|GMBH|TRUST|HOLDINGS)\.?$/i;
  while (SUFFIX.test(s)) s = s.replace(SUFFIX, '');
  s = s.replace(/[\s,]*&\s*$/, ''); // "D. E. Shaw & Co." leaves a dangling ampersand
  if (s === s.toUpperCase()) {
    // Keep short all-caps tokens as initialisms — FMR, AQR, UBS, BNP, MFS —
    // but never a registration word that slipped through.
    // An initialism is short and has no vowel to pronounce — FMR, AQR, UBS,
    // MFS, DWS, TCW — which keeps NEW, YORK and BANK out of it. A few real
    // initialisms do carry a vowel, so they are named.
    const INITIALISM = new Set(['ARK', 'SSGA', 'AIG', 'ING', 'ABN', 'AXA', 'UBS', 'BNP', 'BNY', 'USB', 'IFP', 'AMP']);
    const SMALL = new Set(['of', 'and', 'the', 'for', 'de', 'du', 'la']);
    s = s.split(' ').map((t, i) => {
      const bare = t.replace(/[^A-Z]/g, '');
      if (bare.length >= 2 && bare.length <= 4 && (INITIALISM.has(bare) || !/[AEIOU]/.test(bare))) return t;
      const lower = t.toLowerCase();
      if (i > 0 && SMALL.has(lower)) return lower;
      return lower.replace(/^([a-z])/, (m) => m.toUpperCase());
    }).join(' ');
  }
  return s.trim();
}
