// Reading the 13F register out of Postgres for the screener, the drawer and the
// alert email. One place, so all three say the same thing.
//
// Always the newest period we hold. 13F is filed 45 days after a quarter ends,
// so between a quarter end and that deadline the newest complete register is the
// quarter before — the period is carried on every payload so the reader can see
// how old it is rather than assume it is current.
import { ownershipWords, ownershipTag, ownershipDrift, cleanName, isIndexManager, isMarketMaker } from './institutions.js';

const holderOut = (h) => ({
  manager: cleanName(h.manager),
  filer: h.manager,
  shares: h.shares,
  value: h.value,
  rank: h.rank,
  priorShares: h.priorShares,
  // A share change of a couple of percent is rebalancing, not a decision.
  changePct: h.priorShares ? Math.round(((h.shares - h.priorShares) / h.priorShares) * 1000) / 10 : null,
  isNew: h.priorShares == null,
  isIndex: isIndexManager(h.manager),
  isMarketMaker: isMarketMaker(h.manager),
});

export function institutionsPayload(row, holders = []) {
  if (!row) return null;
  const top = holders.map(holderOut);
  // The words take the raw filer names so the passive test matches, and do
  // their own cleaning.
  const words = ownershipWords(row, holders);
  return {
    period: row.period,
    holders: row.holders,
    shares: row.shares,
    value: row.value,
    holdersPrior: row.holdersPrior,
    opened: row.opened,
    closed: row.closed,
    added: row.added,
    reduced: row.reduced,
    activeHolders: row.activeHolders,
    drift: ownershipDrift(row),
    tag: ownershipTag(row),
    words,
    top,
  };
}

// Newest period per asset, with its largest holders. `limit` caps the holders
// returned per asset — eight is enough for a row, twenty-five for a profile.
export async function institutionsFor(db, assets, { limit = 8 } = {}) {
  const list = [...new Set((assets || []).map((a) => String(a || '').toUpperCase()).filter(Boolean))];
  if (!list.length) return new Map();
  let rows = [];
  try {
    rows = await db.$queryRaw`
      SELECT * FROM (
        SELECT io.*, row_number() OVER (PARTITION BY io.asset ORDER BY io.period DESC) rn
        FROM "InstitutionalOwnership" io
        WHERE io.asset = ANY(${list})
      ) t WHERE rn = 1`;
  } catch {
    return new Map(); // table may not exist mid-rollout
  }
  if (!rows.length) return new Map();
  const keys = rows.map((r) => `${r.asset}|${r.period}`);
  let holders = [];
  try {
    holders = await db.$queryRaw`
      SELECT * FROM "InstitutionalHolder"
      WHERE (asset || '|' || period) = ANY(${keys}) AND rank <= ${limit}
      ORDER BY asset, rank`;
  } catch { /* holders are optional */ }
  const byAsset = new Map();
  for (const h of holders) {
    if (!byAsset.has(h.asset)) byAsset.set(h.asset, []);
    byAsset.get(h.asset).push(h);
  }
  const out = new Map();
  for (const r of rows) out.set(r.asset, institutionsPayload(r, byAsset.get(r.asset) || []));
  return out;
}

export async function institutionsForOne(db, asset, { limit = 25 } = {}) {
  return (await institutionsFor(db, [asset], { limit })).get(String(asset || '').toUpperCase()) || null;
}
