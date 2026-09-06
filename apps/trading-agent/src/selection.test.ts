import { test } from "node:test";
import assert from "node:assert/strict";
import { passesRsFloor, rankCandidates, regimeFrom } from "./selection.js";

const d = (s: string) => new Date(s);

test("strongest RS first, grade breaks ties, unknown RS last", () => {
  const out = rankCandidates([
    {
      asset: "LOW",
      rsRating: 40,
      baseGrade: "S",
      alertSentAt: d("2026-09-05T14:00Z"),
    },
    {
      asset: "NONE",
      rsRating: null,
      baseGrade: "S",
      alertSentAt: d("2026-09-05T13:00Z"),
    },
    {
      asset: "HI_A",
      rsRating: 95,
      baseGrade: "A",
      alertSentAt: d("2026-09-05T15:00Z"),
    },
    {
      asset: "HI_S",
      rsRating: 95,
      baseGrade: "S",
      alertSentAt: d("2026-09-05T16:00Z"),
    },
  ]);
  assert.deepEqual(
    out.map((c) => c.asset),
    ["HI_S", "HI_A", "LOW", "NONE"],
  );
});

test("RS floor", () => {
  assert.equal(passesRsFloor(85, 80), true);
  assert.equal(passesRsFloor(79, 80), false);
  assert.equal(passesRsFloor(null, 80), false);
  assert.equal(passesRsFloor(null, 0), true);
});

test("regime from closes", () => {
  const flat = Array(200).fill(100);
  assert.equal(
    regimeFrom("SPY", "2026-09-05", [...flat.slice(1), 101], 200)?.above,
    true,
  );
  assert.equal(
    regimeFrom("SPY", "2026-09-05", [...flat.slice(1), 99], 200)?.above,
    false,
  );
  assert.equal(regimeFrom("SPY", "2026-09-05", flat.slice(0, 150), 200), null);
});
