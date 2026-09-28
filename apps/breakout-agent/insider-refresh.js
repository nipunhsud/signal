// Writing the Form 4 rollup to the InsiderActivity table.
//
// Kept out of server.js so the nightly job and the one-off backfill script run
// the same code. Takes the Prisma handle rather than owning one.
import { summarizeInsider } from './insider.js';
import { loadForm4s } from './insider-sec.js';

// A row is good for most of a day: Form 4s land continuously but the window is
// 90 days long, so a few hours of staleness changes nothing the reader can see.
export const INSIDER_STALE_MS = 20 * 60 * 60 * 1000;

const toRow = (cik, s) => ({
  cik, windowDays: s.windowDays,
  buys: s.buys, sells: s.sells, realSells: s.realSells,
  plannedSells: s.plannedSells, exerciseSells: s.exerciseSells,
  buyers: s.buyers, sellers: s.sellers,
  buyShares: s.buyShares, sellShares: s.sellShares,
  buyValue: s.buyValue, sellValue: s.sellValue,
  tone: s.tone, cluster: s.cluster, filings: s.filings,
  lastFiledAt: s.lastFiledAt || null,
  latestAt: s.latest?.date || null,
  latestKind: s.latest?.kind || null,
  latestOwner: s.latest?.owner || null,
  latestRole: s.latest?.role || null,
  latestShares: s.latest?.shares ?? null,
  latestPrice: s.latest?.price ?? null,
  latestPlanned: !!s.latest?.planned,
  latestLink: s.latest?.link || null,
  checkedAt: new Date(),
});

export async function refreshInsiderFor(db, symbol) {
  const asset = String(symbol || '').toUpperCase();
  if (!asset) return null;
  const { cik, filings } = await loadForm4s(asset);
  const row = toRow(cik, summarizeInsider(filings));
  await db.insiderActivity.upsert({ where: { asset }, create: { asset, ...row }, update: row });
  return { asset, ...row };
}

// A cached read that only reaches SEC when the stored row is missing or stale.
export async function insiderFor(db, symbol, { refresh = true } = {}) {
  const asset = String(symbol || '').toUpperCase();
  if (!asset) return null;
  let row = null;
  try { row = await db.insiderActivity.findUnique({ where: { asset } }); } catch { return null; }
  if (row && Date.now() - new Date(row.checkedAt).getTime() < INSIDER_STALE_MS) return row;
  if (!refresh) return row;
  try { return await refreshInsiderFor(db, asset); } catch (err) {
    console.warn(`[form4] ${asset}: ${err?.message || err}`);
    return row;
  }
}

// Every stock the screen has touched lately, the ones checked longest ago
// first, so an interrupted run resumes instead of starting over.
export async function assetsNeedingInsiders(db, { days = 30, limit = 400 } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db.$queryRaw`
    SELECT bs.asset
    FROM "BreakoutSignal" bs
    LEFT JOIN "InsiderActivity" ia ON ia.asset = bs.asset
    WHERE bs."createdAt" >= ${since} AND bs."assetType" = 'stock'
    GROUP BY bs.asset, ia."checkedAt"
    ORDER BY ia."checkedAt" ASC NULLS FIRST
    LIMIT ${limit}`;
  return rows.map((r) => r.asset);
}

export async function refreshInsiderActivity(db, { days = 30, limit = 400 } = {}) {
  let assets = [];
  try {
    assets = await assetsNeedingInsiders(db, { days, limit });
  } catch (err) {
    console.warn('[form4] asset list failed:', err?.message || err);
    return { ok: 0, total: 0 };
  }
  let ok = 0, buying = 0;
  const started = Date.now();
  for (const asset of assets) {
    try {
      const r = await refreshInsiderFor(db, asset);
      ok++;
      if (r?.tone === 'buying' || r?.tone === 'mixed') buying++;
    } catch (err) {
      console.warn(`[form4] ${asset}: ${err?.message || err}`);
    }
  }
  console.log(`[form4] refreshed ${ok}/${assets.length} symbols in ${Math.round((Date.now() - started) / 1000)}s — ${buying} with insider buying`);
  return { ok, total: assets.length, buying };
}
