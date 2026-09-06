import { test } from "node:test";
import assert from "node:assert/strict";
import { getConfig, validateConfig } from "./config.js";

const base = { ALPACA_API_KEY: "k", ALPACA_API_SECRET: "s" };

test("default profile is the fully-invested operating point", () => {
  const c = getConfig({ ...base });
  assert.equal(c.profile, "invested");
  assert.equal(c.maxOpenPositions, 10);
  assert.equal(c.riskPerTradePct, 1);
  assert.deepEqual(c.trailGrades, ["S", "A+", "A"]);
  assert.equal(c.trailPct, 20);
  assert.equal(c.holdDays, 365);
  assert.deepEqual(validateConfig(c), []);
});

test("conservative profile holds cash with five slots", () => {
  const c = getConfig({ ...base, TRADE_PROFILE: "conservative" });
  assert.equal(c.maxOpenPositions, 5);
  assert.deepEqual(c.trailGrades, ["S", "A+", "A"]);
});

test("explicit variables override the profile", () => {
  const c = getConfig({
    ...base,
    TRADE_PROFILE: "conservative",
    TRADE_MAX_OPEN_POSITIONS: "8",
    TRADE_TRAIL_GRADES: "S",
  });
  assert.equal(c.maxOpenPositions, 8);
  assert.deepEqual(c.trailGrades, ["S"]);
});

test("unknown profile is refused", () => {
  assert.throws(
    () => getConfig({ ...base, TRADE_PROFILE: "yolo" }),
    /TRADE_PROFILE/,
  );
});

test("live mode needs the explicit confirmation", () => {
  const c = getConfig({ ...base, TRADING_MODE: "live" });
  assert.ok(validateConfig(c).some((p) => /TRADING_LIVE_CONFIRM/.test(p)));
  const ok = getConfig({
    ...base,
    TRADING_MODE: "live",
    TRADING_LIVE_CONFIRM: "I_UNDERSTAND",
  });
  assert.deepEqual(validateConfig(ok), []);
});
