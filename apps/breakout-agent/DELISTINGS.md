# Delisted Stock Handling

This document describes how Signal Forge handles delisted stocks (companies that are acquired, go private, or are otherwise removed from public exchanges).

## Problem Statement

Delisted stocks (like WNS, which was acquired by Capgemini for $76.50/share in October 2025) can pollute the signal database with stale data. These stocks:
- Can no longer be traded
- Shouldn't generate new signals
- Should be removed from active monitoring

## Solution Architecture

### 1. **Source Filtering** - Filter Delistings at Asset List Fetch
**File:** `src/tools/delistings.ts`

When fetching assets from FMP API (`fetchAssetsFromFMP()`), the system now:
1. Checks FMP's profile endpoint for each asset
2. Identifies assets with no exchange information (indicator of delisting)
3. Maintains a cache (24-hour TTL) to avoid redundant API calls

```typescript
// Example usage
const activeAssets = await filterDelistedStocks(allAssets, apiKey);
```

### 2. **Known Delistings Registry**
**File:** `src/tools/delistings.ts` → `knownDelistings` Set

For faster filtering, common delistings are pre-registered:
```typescript
const knownDelistings = new Set(['WNS', /* add more as they occur */]);
```

**When to add:**
- Acquired companies (WNS → Capgemini)
- Companies going private or delisting
- Any known delisting events

### 3. **Dynamic Checking** - Check Before Analysis
**File:** `src/tools/market-data.ts` → `fetchFMPData()`

Before fetching market data for analysis, the system validates the stock is still listed:
- Throws `[DELISTED]` error if stock is no longer trading
- Error is caught gracefully in `agent.ts` → `analyzeAsset()`
- Stock is skipped without crashing the analysis pipeline

This handles the edge case where a stock gets delisted between asset list generation and analysis.

### 4. **Existing Data Cleanup**
Two utility scripts scan and clean existing delisted data:

#### Scan Only (No Changes)
```bash
npx ts-node --esm src/scripts/scan-delisted-stocks.ts
```
Output:
- Count of active vs delisted stocks in database
- Lists all delisted stocks found
- Shows breakdown of records to be cleaned

#### Clean Database
```bash
npx ts-node --esm src/scripts/cleanup-delisted.ts --dry-run
```
Dry run shows what would be deleted.

```bash
npx ts-node --esm src/scripts/cleanup-delisted.ts --confirm
```
Actually deletes delisted stock records (requires `--confirm` flag).

## Flow Diagram

```
Asset Fetch
    ↓
[NEW] Filter Delistings ← (Check known list, then FMP API)
    ↓
Asset List (delisted removed)
    ↓
Analyze Market Data
    ↓
[NEW] Dynamic Delisting Check ← (Check before fetching)
    ↓
Signal Generation
```

## Performance Impact

- **Filtering overhead:** ~50-100ms per batch of 20 assets (batched API calls)
- **Cache benefit:** 24-hour TTL prevents re-checking same stocks
- **Dynamic check:** Minimal (uses cache, typically <10ms)
- **Net impact:** <5% increase in total analysis time, worth the accuracy gain

## Integration Points

### 1. Breakout Agent (`agent.ts`)
```typescript
import { filterDelistedStocks } from './tools/delistings.js';

// In fetchAssetsFromFMP()
const activeAssets = await filterDelistedStocks(allAssets, apiKey);
```

### 2. Market Data Fetcher (`market-data.ts`)
```typescript
import { isDelisted } from './tools/delistings.js';

// In fetchFMPData()
const delistingStatus = await isDelisted(symbol, apiKey);
if (delistingStatus.delisted) {
  throw new Error(`[DELISTED] ${symbol}: ${delistingStatus.reason}`);
}
```

### 3. Error Handling in Analysis (`agent.ts`)
```typescript
try {
  const data = await fetchMarketData(...);
} catch (error: any) {
  if (error?.message.includes('[DELISTED]')) {
    console.warn(`⊘ ${asset}: ${error.message}`);
    return null;  // Skip gracefully
  }
  throw error;  // Re-throw other errors
}
```

## Future Enhancements

1. **Automatic Registry Update:** Integrate with SEC/NASDAQ data feed to auto-populate delisting registry
2. **Archive Mode:** Instead of deleting, archive delisted stock signals for historical analysis
3. **Delisting Alerts:** Send notifications when stocks are delisted
4. **Weighted Cache:** Adjust cache TTL based on delistings frequency (higher during M&A season)

## Known Delistings (as of May 11, 2026)

| Symbol | Company | Event | Date |
|--------|---------|-------|------|
| WNS | WNS (Holdings) Limited | Acquired by Capgemini | Oct 2025 |

(Update this table as new delistings occur)
