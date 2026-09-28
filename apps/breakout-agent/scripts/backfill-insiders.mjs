// Fill the InsiderActivity table from SEC EDGAR.
//
// The server does this nightly at 18:30 ET for the 400 least recently checked
// stocks. This is the same code for a first run, or to widen the window:
//
//   node scripts/backfill-insiders.mjs --limit 800 --days 60
//   node scripts/backfill-insiders.mjs RSKD MXL QMCO      # just these
//
// SEC is called at 6 requests a second from one process. A symbol costs one
// submissions lookup plus one fetch per Form 4 in the last 90 days, so budget
// roughly a second or two each.
import { PrismaClient } from '@prisma/client';
import { refreshInsiderFor, refreshInsiderActivity } from '../insider-refresh.js';
import { insiderWords } from '../insider.js';

const db = new PrismaClient();
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : dflt;
};
const symbols = args.filter((a) => !a.startsWith('--') && !/^\d+$/.test(a)).map((a) => a.toUpperCase());

try {
  if (symbols.length) {
    for (const sym of symbols) {
      const r = await refreshInsiderFor(db, sym);
      console.log(`${sym.padEnd(6)} ${String(r.tone).padEnd(8)} ${insiderWords({ ...r, latest: r.latestAt ? { date: r.latestAt, kind: r.latestKind, owner: r.latestOwner, role: r.latestRole, shares: r.latestShares, price: r.latestPrice, planned: r.latestPlanned } : null })}`);
    }
  } else {
    await refreshInsiderActivity(db, { days: flag('days', 30), limit: flag('limit', 400) });
  }
} finally {
  await db.$disconnect();
}
