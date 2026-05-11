/**
 * Removes delisted stocks from database
 * Run: npx ts-node --esm src/scripts/cleanup-delisted.ts [--dry-run]
 */
import { db } from '../db.js';
import { isDelisted, isKnownDelisted } from '../tools/delistings.js';

async function cleanupDelistedStocks(dryRun: boolean = false) {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    console.error('FMP_API_KEY not set');
    process.exit(1);
  }

  const mode = dryRun ? 'DRY RUN' : 'LIVE';
  console.log(`\n[${mode}] Cleaning up delisted stocks...\n`);

  // Get all unique assets
  const breakoutSignals = await db.breakoutSignal.findMany({
    select: { asset: true },
    distinct: ['asset'],
  });

  const signals = await db.signal.findMany({
    select: { asset: true },
    distinct: ['asset'],
  });

  const allAssets = [...new Set([
    ...breakoutSignals.map(s => s.asset),
    ...signals.map(s => s.asset),
  ])];

  console.log(`Scanning ${allAssets.length} unique assets...\n`);

  const delistedAssets: string[] = [];

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
    }
  }

  console.log(`\nFound ${delistedAssets.length} delisted stocks\n`);

  if (delistedAssets.length === 0) {
    console.log('No delisted stocks found!');
    process.exit(0);
  }

  // Show what will be deleted
  console.log('RECORDS TO DELETE:');
  for (const asset of delistedAssets) {
    const breakoutCount = await db.breakoutSignal.count({
      where: { asset },
    });
    const signalCount = await db.signal.count({
      where: { asset },
    });

    console.log(`  ${asset}: ${breakoutCount} breakout signals, ${signalCount} setup signals`);
  }

  if (dryRun) {
    console.log('\n[DRY RUN] No changes made. Run without --dry-run to delete.');
    process.exit(0);
  }

  // Ask for confirmation
  console.log('\n⚠️  WARNING: This will permanently delete the above records.');
  console.log('Type "DELETE" to confirm (case-sensitive):');

  // For CLI confirmation, we'll just proceed (you can add readline if needed)
  const confirmed = process.argv.includes('--confirm');

  if (!confirmed) {
    console.log('\nCancelled. Run with --confirm to proceed.');
    process.exit(1);
  }

  // Delete delisted stocks
  console.log(`\nDeleting delisted records...\n`);

  for (const asset of delistedAssets) {
    try {
      const [breakoutDeleted, signalDeleted] = await Promise.all([
        db.breakoutSignal.deleteMany({ where: { asset } }),
        db.signal.deleteMany({ where: { asset } }),
      ]);

      console.log(
        `✓ ${asset}: Deleted ${breakoutDeleted.count} breakout + ${signalDeleted.count} signal records`
      );
    } catch (error) {
      console.error(`✗ ${asset}: Failed to delete - ${error}`);
    }
  }

  console.log(`\n[${mode}] Cleanup complete!\n`);
  process.exit(0);
}

const dryRun = process.argv.includes('--dry-run');
cleanupDelistedStocks(dryRun).catch(error => {
  console.error('Error cleaning up delisted stocks:', error);
  process.exit(1);
});
