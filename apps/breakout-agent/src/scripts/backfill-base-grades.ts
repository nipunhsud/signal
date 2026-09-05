// Backfill X-ray base grades onto existing BreakoutSignal rows so past alerts
// and dashboard history reflect the graded system (full-history validation,
// Sep 2026). For each asset: fetch daily bars, segment bases once, then label
// every row with the grade of the base that was active (or had just resolved)
// on the row's signal date. History is labeled, never rewritten — alertSentAt,
// types, and confidences stay untouched; rows gain baseGrade/volumeTag/
// basePivot/baseBars/baseDepthPct. Grade "X" = evaluated but unqualified under
// the new rules (non-sky, >25% deep, or below the 200MA at the time).
//
// Usage (inside a container with DATABASE_URL):
//   node dist/scripts/backfill-base-grades.js [--dry-run] [--asset TICKER]
// @ts-ignore — plain-JS module at the app root, shared with the dashboard
import { detectBases } from "../../base-detect.js";
import { db } from "../db.js";

interface Bar { date: string; open: number; high: number; low: number; close: number; volume: number }

async function yahooBars(symbol: string): Promise<Bar[]> {
  // period1/period2 epochs: range=max silently downgrades to monthly bars.
  const from = Math.floor(new Date("2023-01-01").getTime() / 1000);
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${from}&period2=9999999999&interval=1d`,
    { headers: { "User-Agent": "Mozilla/5.0" } },
  );
  if (!res.ok) throw new Error(`Yahoo ${res.status}`);
  const r = ((await res.json()) as any)?.chart?.result?.[0];
  const ts = r?.timestamp, q = r?.indicators?.quote?.[0];
  if (!ts || !q) throw new Error("empty");
  const bars: Bar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    if (o == null || h == null || l == null || c == null) continue;
    bars.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), open: o, high: h, low: l, close: c, volume: q.volume[i] ?? 0 });
  }
  return bars;
}

const sma200 = (bars: Bar[], i: number) => {
  if (i + 1 < 200) return null;
  let s = 0;
  for (let k = i - 199; k <= i; k++) s += bars[k].close;
  return s / 200;
};
const avgVol20 = (bars: Bar[], i: number) => {
  if (i < 20) return null;
  let s = 0;
  for (let k = i - 20; k < i; k++) s += bars[k].volume;
  return s / 20;
};

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const assetArg = process.argv.indexOf("--asset");
  const onlyAsset = assetArg > -1 ? process.argv[assetArg + 1].toUpperCase() : null;

  const where: any = onlyAsset ? { asset: onlyAsset } : {};
  const assets = await db.breakoutSignal.groupBy({ by: ["asset"], where, _count: true });
  console.log(`${assets.length} assets to backfill${dryRun ? " (dry run)" : ""}`);

  let updated = 0, unqualified = 0, skipped = 0, errors = 0;
  for (const { asset } of assets) {
    try {
      const rows = await db.breakoutSignal.findMany({
        where: { asset },
        select: { id: true, signalDate: true, createdAt: true, volumeRatio: true, breakoutType: true },
        orderBy: { createdAt: "asc" },
      });
      if (!rows.length) continue;
      const bars = await yahooBars(asset);
      if (bars.length < 60) { skipped += rows.length; continue; }
      const idxByDate = new Map(bars.map((b, i) => [b.date, i]));
      const bases = detectBases(
        bars.map((b) => ({ time: b.date, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume })),
      ) as any[];

      for (const row of rows) {
        const rowDate = (row.signalDate ?? row.createdAt).toISOString().slice(0, 10);
        // Bar at (or last before) the row's date — weekend-created rows map
        // back to Friday's bar.
        let i = idxByDate.get(rowDate) ?? -1;
        if (i < 0) {
          for (let k = bars.length - 1; k >= 0; k--) if (bars[k].date <= rowDate) { i = k; break; }
        }
        if (i < 0) { skipped++; continue; }
        // Originating base: the last base whose pivot formed before this date.
        const base = [...bases].reverse().find((b) => b.pivotDate <= rowDate);
        if (!base) { skipped++; continue; }
        const pIdx = idxByDate.get(base.pivotDate) ?? 0;
        const priorHigh = Math.max(...bars.slice(Math.max(0, pIdx - 251), pIdx + 1).map((b) => b.high));
        const sky = base.pivot >= priorHigh * 0.98;
        const ma200 = sma200(bars, i);
        const above200 = ma200 != null && bars[i].close > ma200;
        let grade = "X";
        if (sky && above200 && base.depthPct <= 25) {
          grade = base.depthPct <= 15 && base.bars >= 80 ? "S" : base.depthPct <= 15 && base.bars >= 25 ? "A+" : "A";
        }
        const vr = row.volumeRatio ?? (() => {
          const av = avgVol20(bars, i);
          return av && av > 0 ? bars[i].volume / av : null;
        })();
        const volumeTag = vr == null ? null : vr >= 2 ? "power" : vr >= 1.2 ? "confirmed" : "quiet";

        if (grade === "X") unqualified++;
        if (!dryRun) {
          await db.breakoutSignal.update({
            where: { id: row.id },
            data: {
              baseGrade: grade,
              volumeTag,
              basePivot: base.pivot,
              baseBars: base.bars,
              baseDepthPct: base.depthPct,
            },
          });
        }
        updated++;
      }
      if (updated % 500 < rows.length) console.log(`  ${asset}: ${rows.length} rows (total ${updated})`);
      await new Promise((r) => setTimeout(r, 120));
    } catch (e: any) {
      errors++;
      console.warn(`  ${asset}: ${e?.message}`);
    }
  }
  console.log(`\nDone. labeled=${updated} (unqualified X=${unqualified}) skipped=${skipped} asset-errors=${errors}${dryRun ? " — DRY RUN, nothing written" : ""}`);
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
