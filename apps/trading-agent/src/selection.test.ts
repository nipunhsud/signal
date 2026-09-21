import { test } from "node:test";
import assert from "node:assert/strict";
import { passesActivityFloor, passesRsFloor, passesSectorFloor, rankCandidates, regimeFrom } from "./selection.js";

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

test("activity and sector rank order the ties inside an RS band; floors default off", () => {
  const out = rankCandidates([
    { asset: "A_LOW_ACT", rsRating: 95, baseGrade: "A", alertSentAt: d("2026-09-05T13:00Z"), activityScore: 1, sectorRank: 1 },
    { asset: "A_HI_ACT_LAGGING_SECTOR", rsRating: 95, baseGrade: "A", alertSentAt: d("2026-09-05T13:00Z"), activityScore: 6, sectorRank: 9 },
    { asset: "A_HI_ACT_LEADING_SECTOR", rsRating: 95, baseGrade: "A", alertSentAt: d("2026-09-05T13:00Z"), activityScore: 6, sectorRank: 2 },
    { asset: "RS_WINS_ANYWAY", rsRating: 97, baseGrade: "A", alertSentAt: d("2026-09-05T13:00Z"), activityScore: 0, sectorRank: 11 },
  ]);
  assert.deepEqual(out.map((c) => c.asset), ["RS_WINS_ANYWAY", "A_HI_ACT_LEADING_SECTOR", "A_HI_ACT_LAGGING_SECTOR", "A_LOW_ACT"]);
  assert.equal(passesActivityFloor(null, 0), true);
  assert.equal(passesActivityFloor(null, 3), false);
  assert.equal(passesActivityFloor(5, 3), true);
  assert.equal(passesSectorFloor(4, 3), false);
  assert.equal(passesSectorFloor(2, 3), true);
  assert.equal(passesSectorFloor(null, 0), true);
});
