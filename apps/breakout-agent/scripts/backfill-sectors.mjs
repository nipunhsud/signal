// Fill the sector on stocks the profile feed left blank.
//
//   node scripts/backfill-sectors.mjs          # report only
//   node scripts/backfill-sectors.mjs --write  # apply
//
// Reads Nasdaq's public screener, translates its vocabulary to the screen's
// (sector-map.js), and updates only rows with no sector or "Unclassified".
// An existing sector is never touched.
import { PrismaClient } from '@prisma/client';
import { toScreenSector, needsSector } from '../sector-map.js';

const WRITE = process.argv.includes('--write');
const db = new PrismaClient();

const url = 'https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&download=true';
const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
if (!res.ok) throw new Error(`Nasdaq screener: HTTP ${res.status}`);
const json = await res.json();
const listings = json?.data?.rows || json?.data?.table?.rows || [];
if (!listings.length) throw new Error('Nasdaq screener returned no rows');

const map = new Map();
for (const r of listings) {
  const mapped = toScreenSector(r.sector);
  if (mapped && r.symbol) map.set(String(r.symbol).trim().toUpperCase(), mapped);
}
console.log(`Nasdaq: ${listings.length} listings, ${map.size} with a sector we can translate`);

const rows = await db.assetReturn.findMany({
  where: { assetType: 'stock' },
  select: { asset: true, sector: true, region: true },
});
const gaps = rows.filter(needsSector);
console.log(`screen: ${rows.length} stocks, ${gaps.length} with no sector`);

const fillable = gaps.map((r) => ({ ...r, mapped: map.get(r.asset.toUpperCase()) })).filter((r) => r.mapped);
const byNew = {};
for (const r of fillable) byNew[r.mapped] = (byNew[r.mapped] || 0) + 1;
console.log(`fillable: ${fillable.length} of ${gaps.length}`);
for (const [k, v] of Object.entries(byNew).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
const left = gaps.filter((r) => !map.get(r.asset.toUpperCase()));
console.log(`still unknown: ${left.length}${left.length ? ' — ' + left.slice(0, 15).map((r) => r.asset).join(', ') : ''}`);

if (!WRITE) { console.log('\nreport only; pass --write to apply'); await db.$disconnect(); process.exit(0); }
let n = 0;
for (const r of fillable) {
  await db.assetReturn.update({ where: { asset: r.asset }, data: { sector: r.mapped } });
  n++;
}
console.log(`\nupdated ${n} rows`);
await db.$disconnect();
