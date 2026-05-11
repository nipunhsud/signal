/**
 * Scans the database for delisted stocks and identifies them
 * Run: npx ts-node --esm src/scripts/scan-delisted-stocks.ts
 */
import { db } from "../db";
import { isDelisted, isKnownDelisted } from "../tools/delistings";

async function scanDelistedStocks() {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    console.error("FMP_API_KEY not set");
    process.exit(1);
  }

  console.log("Scanning database for delisted stocks...\n");

  // Get all unique assets from breakoutSignal table
  const breakoutSignals = await db.breakoutSignal.findMany({
    select: { asset: true },
    distinct: ["asset"],
  });

  // Get all unique assets from signal table
  const signals = await db.signal.findMany({
    select: { asset: true },
    distinct: ["asset"],
  });

  // Combine and deduplicate
  const allAssets = [
    ...new Set([
      ...breakoutSignals.map((s) => s.asset),
      ...signals.map((s) => s.asset),
    ]),
  ];

  console.log(`Found ${allAssets.length} unique assets in database\n`);

  const delistedAssets: string[] = [];
  const activeAssets: string[] = [];
  let checked = 0;

  for (const asset of allAssets) {
    // Quick check first
    if (isKnownDelisted(asset)) {
      delistedAssets.push(asset);
      console.log(`✗ ${asset}: KNOWN DELISTING`);
      continue;
    }

    // API check
    const result = await isDelisted(asset, apiKey);
    if (result.delisted) {
      delistedAssets.push(asset);
      console.log(`✗ ${asset}: DELISTED - ${result.reason}`);
    } else {
      activeAssets.push(asset);
    }

    checked++;
    if (checked % 50 === 0) {
      console.log(`[Progress] Checked ${checked}/${allAssets.length}`);
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`RESULTS:`);
  console.log(`  Active stocks: ${activeAssets.length}`);
  console.log(`  Delisted stocks: ${delistedAssets.length}`);
  console.log(`${"=".repeat(60)}\n`);

  if (delistedAssets.length > 0) {
    console.log("DELISTED STOCKS FOUND:");
    delistedAssets.forEach((asset) => {
      console.log(`  - ${asset}`);
    });

    console.log("\nRECOMMENDATIONS:");
    console.log("1. Remove delisted stocks from alerts");
    console.log("2. Archive or delete their signals");
    console.log("3. Update known delistings list in delistings.ts\n");

    // Show counts by table
    const delistedInBreakout = await db.breakoutSignal.count({
      where: { asset: { in: delistedAssets } },
    });
    const delistedInSignal = await db.signal.count({
      where: { asset: { in: delistedAssets } },
    });

    console.log(`DATA TO CLEAN:
  - ${delistedInBreakout} breakout signals
  - ${delistedInSignal} setup signals\n`);
  }

  process.exit(0);
}

scanDelistedStocks().catch((error) => {
  console.error("Error scanning delisted stocks:", error);
  process.exit(1);
});
