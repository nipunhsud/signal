// Nasdaq's sector names are not ours.
//
// The screen's sectors come from FMP company profiles, which use the
// Yahoo-style taxonomy. When a profile has no sector the stock lands in
// "Unclassified", and on 2026-09-26 that bucket held 98 names and ranked third
// in the Sector Strength tab — missing data presented as a peer of Energy and
// Technology.
//
// Nasdaq publishes a sector for most US listings on a public endpoint, and it
// covers the ones FMP leaves blank (CIX, CLMB and SGP, the three names that
// bucket was showing as its leaders, are all classified there). It uses a
// different vocabulary, so anything backfilled has to be translated or the
// same sector ends up split across two names.
//
// "Miscellaneous" is Nasdaq's own unclassified and is deliberately absent:
// filling one unknown with another is worse than leaving the gap visible.
export const NASDAQ_TO_SCREEN = {
  'Basic Materials': 'Basic Materials',
  'Consumer Discretionary': 'Consumer Cyclical',
  'Consumer Staples': 'Consumer Defensive',
  Energy: 'Energy',
  Finance: 'Financial Services',
  'Health Care': 'Healthcare',
  Industrials: 'Industrials',
  'Real Estate': 'Real Estate',
  Technology: 'Technology',
  Telecommunications: 'Communication Services',
  Utilities: 'Utilities',
};

// The vocabulary the screen already uses, so a backfill can never introduce a
// thirteenth spelling of a sector it already has.
export const SCREEN_SECTORS = new Set(Object.values(NASDAQ_TO_SCREEN));

export function toScreenSector(nasdaqSector) {
  if (!nasdaqSector) return null;
  return NASDAQ_TO_SCREEN[String(nasdaqSector).trim()] ?? null;
}

// Rows worth filling: a stock with no sector, or one parked in the bucket the
// tab renders as "Unclassified". Never overwrite a sector we already know.
export function needsSector(row) {
  const s = row && row.sector;
  return !s || s === 'Unclassified';
}
