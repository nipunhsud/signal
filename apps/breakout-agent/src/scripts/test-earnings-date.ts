import assert from "node:assert";
import { isEarningsDateFresh } from "../tools/market-data.js";

// Self-check for the earnings post-window (today/yesterday in America/New_York).
// Run: npx tsx src/scripts/test-earnings-date.ts

// Anchor "now" at 2026-08-17 18:00 ET (22:00 UTC) — after-close on a Monday.
const now = new Date("2026-08-17T22:00:00Z");

assert.equal(isEarningsDateFresh("2026-08-17", now), true, "today matches");
assert.equal(isEarningsDateFresh("2026-08-16", now), true, "yesterday matches (after-close grace)");
assert.equal(isEarningsDateFresh("2026-08-15", now), false, "two days ago is stale");
assert.equal(isEarningsDateFresh("2026-08-18", now), false, "future does not match");
assert.equal(isEarningsDateFresh("2026-08-17T00:00:00.000Z", now), true, "tolerates datetime suffix");

console.log("✓ isEarningsDateFresh window checks passed");
