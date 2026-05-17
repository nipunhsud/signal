import { globalRateLimiter } from "./rate-limiter.js";
import axios from "axios";

interface DelistingCache {
  [symbol: string]: { isDelisted: boolean; checkedAt: number; reason?: string };
}

const delistingCache: DelistingCache = {};
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Check if a stock is delisted by verifying FMP profile data
 * A stock is considered delisted if:
 * 1. Profile endpoint returns no data
 * 2. The symbol is known to be acquired/delisted
 */
export async function isDelisted(
  symbol: string,
  apiKey: string,
): Promise<{ delisted: boolean; reason?: string }> {
  // Check cache first
  const cached = delistingCache[symbol];
  if (cached && Date.now() - cached.checkedAt < CACHE_TTL) {
    return {
      delisted: cached.isDelisted,
      reason: cached.reason,
    };
  }

  try {
    const profileData = await globalRateLimiter.execute(async () => {
      const res = await axios.get(
        `https://financialmodelingprep.com/api/v3/profile/${symbol}`,
        {
          params: { apikey: apiKey },
          timeout: 10000,
        },
      );
      return res.data;
    });

    // If profile returns empty array or no data, stock is likely delisted
    if (
      !profileData ||
      (Array.isArray(profileData) && profileData.length === 0)
    ) {
      const result = { delisted: true, reason: "No profile data available" };
      delistingCache[symbol] = {
        isDelisted: true,
        checkedAt: Date.now(),
        reason: "No profile data available",
      };
      return result;
    }

    // Check if profile has active exchange status
    if (Array.isArray(profileData) && profileData.length > 0) {
      const profile = profileData[0];

      // Some APIs return isActive or similar field
      if (profile.isActive === false) {
        const result = { delisted: true, reason: "Marked as inactive" };
        delistingCache[symbol] = {
          isDelisted: true,
          checkedAt: Date.now(),
          reason: "Marked as inactive",
        };
        return result;
      }

      // Check if exchange field exists (delisted stocks may not have it)
      if (!profile.exchange && !profile.exchangeShortName) {
        const result = { delisted: true, reason: "No exchange information" };
        delistingCache[symbol] = {
          isDelisted: true,
          checkedAt: Date.now(),
          reason: "No exchange information",
        };
        return result;
      }
    }

    // Stock appears to be active
    const result = { delisted: false };
    delistingCache[symbol] = {
      isDelisted: false,
      checkedAt: Date.now(),
    };
    return result;
  } catch (error) {
    console.warn(`Failed to check delisting status for ${symbol}:`, error);
    // On error, assume not delisted (conservative approach)
    const result = { delisted: false };
    delistingCache[symbol] = {
      isDelisted: false,
      checkedAt: Date.now(),
    };
    return result;
  }
}

/**
 * Check if a symbol matches known delisted patterns
 * This is a supplementary check to catch common delistings quickly
 */
export function isKnownDelisted(symbol: string): boolean {
  // Known delistings (add to this list as they occur)
  const knownDelistings = new Set([
    "WNS", // Acquired by Capgemini in October 2025
  ]);

  return knownDelistings.has(symbol.toUpperCase());
}

/**
 * Filter out delisted stocks from a list
 * Uses known delistings only (API verification is too slow for full universe)
 */
export async function filterDelistedStocks(
  symbols: string[],
): Promise<string[]> {
  console.log(
    `[Delistings] Checking ${symbols.length} symbols for delisting status...`,
  );

  const delisted: string[] = [];

  // Quick check for known delistings
  const active = symbols.filter((symbol) => {
    if (isKnownDelisted(symbol)) {
      delisted.push(symbol);
      return false;
    }
    return true;
  });

  if (delisted.length > 0) {
    console.log(
      `[Delistings] Found ${delisted.length} known delistings: ${delisted.join(", ")}`,
    );
  } else {
    console.log(`[Delistings] No known delistings found`);
  }

  return active;
}

/**
 * Clear delistings cache (useful for testing or manual refresh)
 */
export function clearDelistingCache(): void {
  Object.keys(delistingCache).forEach((key) => delete delistingCache[key]);
  console.log("[Delistings] Cache cleared");
}
