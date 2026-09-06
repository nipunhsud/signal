import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sizePosition,
  dailyLossBreached,
  entryZone,
  isUsSymbol,
} from "./risk.js";

const base = {
  equity: 100_000,
  cash: 100_000,
  riskPerTradePct: 1,
  maxPositionPct: 20,
};

test("risk budget binds when the stop is wide", () => {
  const r = sizePosition({ ...base, price: 100, stopPrice: 93 });
  assert.ok(r.ok);
  // $1,000 risk / $7 per share = 142 shares; cap would allow 200
  assert.equal(r.sizing.qty, 142);
  assert.equal(r.sizing.binding, "risk");
  assert.equal(r.sizing.riskAmount, 142 * 7);
});

test("position cap binds when the stop is tight", () => {
  const r = sizePosition({ ...base, price: 100, stopPrice: 99 });
  assert.ok(r.ok);
  assert.equal(r.sizing.qty, 200);
  assert.equal(r.sizing.binding, "position-cap");
});

test("cash binds when the account is mostly deployed", () => {
  const r = sizePosition({ ...base, cash: 5_000, price: 100, stopPrice: 93 });
  assert.ok(r.ok);
  assert.equal(r.sizing.qty, 50);
  assert.equal(r.sizing.binding, "cash");
});

test("rejects when even one share breaks the budget", () => {
  const r = sizePosition({
    ...base,
    equity: 500,
    cash: 500,
    price: 400,
    stopPrice: 372,
  });
  assert.equal(r.ok, false);
});

test("rejects a stop at or above price", () => {
  assert.equal(sizePosition({ ...base, price: 100, stopPrice: 100 }).ok, false);
  assert.equal(sizePosition({ ...base, price: 100, stopPrice: 105 }).ok, false);
});

test("daily loss cap", () => {
  assert.equal(dailyLossBreached(100_000, 97_500, 3), false);
  assert.equal(dailyLossBreached(100_000, 97_000, 3), true);
  assert.equal(dailyLossBreached(0, 97_000, 3), false);
});

test("entry zone mirrors the dashboard's fresh/extended split", () => {
  assert.equal(entryZone(99, 100, 5), "below-pivot");
  assert.equal(entryZone(104, 100, 5), "fresh");
  assert.equal(entryZone(105.5, 100, 5), "extended");
});

test("Indian tickers are not US symbols", () => {
  assert.equal(isUsSymbol("RELIANCE.NS"), false);
  assert.equal(isUsSymbol("TCS.BO"), false);
  assert.equal(isUsSymbol("BRK-B"), true);
});
