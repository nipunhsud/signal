import { test } from "node:test";
import assert from "node:assert/strict";
import { closedBelowMa, sma, trailingStop, afterClose } from "./exits.js";

test("sma needs n closes", () => {
  assert.equal(sma([1, 2, 3], 5), null);
  assert.equal(sma([1, 2, 3, 4, 5], 5), 3);
});

test("closedBelowMa fires only on a close under the average", () => {
  const flat = Array(50).fill(100);
  assert.equal(closedBelowMa([...flat, 100], 50), false); // MA is 100 exactly
  assert.equal(closedBelowMa([...flat, 99], 50), true);
  assert.equal(closedBelowMa([...flat, 105], 50), false);
  assert.equal(closedBelowMa(flat.slice(0, 30), 50), false); // not enough history
});

test("trailingStop only moves up and only by a meaningful step", () => {
  // entry 100, hard stop 93, trail 20%: peak 110 → candidate 88 → no move
  assert.equal(
    trailingStop({ peakHigh: 110, trailPct: 20, currentStop: 93 }),
    null,
  );
  // peak 125 → candidate 100 → moves
  assert.equal(
    trailingStop({ peakHigh: 125, trailPct: 20, currentStop: 93 }),
    100,
  );
  // tiny improvement (100.2 vs 100) is ignored
  assert.equal(
    trailingStop({ peakHigh: 125.25, trailPct: 20, currentStop: 100 }),
    null,
  );
  assert.equal(
    trailingStop({ peakHigh: 130, trailPct: 20, currentStop: 100 }),
    104,
  );
});

test("afterClose respects New York hours and weekends", () => {
  assert.equal(afterClose(new Date("2026-09-04T20:10:00Z")), true); // Fri 16:10 ET (EDT)
  assert.equal(afterClose(new Date("2026-09-04T19:00:00Z")), false); // Fri 15:00 ET
  assert.equal(afterClose(new Date("2026-09-05T20:10:00Z")), false); // Sat
});
