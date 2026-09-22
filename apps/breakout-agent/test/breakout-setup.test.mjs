// The breakout definition behind every alert: the base detector's pivot and
// the graded-base gate. Runs against the compiled agent code (npm run build).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectBases } from '../base-detect.js';
import { analyzeBreakout } from '../dist/tools/breakout-logic.js';

// Synthetic daily series: a run-up, a pivot high at 100, then a base under it.
function series({ baseBars = 15, wick = false, closeAbove = null }) {
  const bars = [];
  let t = 0;
  const day = () => `2026-01-${String(++t).padStart(2, '0')}`;
  for (let i = 0; i < 5; i++) bars.push({ time: day(), open: 90 + i, high: 91 + i, low: 89 + i, close: 90.5 + i, volume: 1e6 });
  bars.push({ time: day(), open: 96, high: 100, low: 95, close: 98, volume: 1.5e6 }); // pivot bar
  for (let i = 0; i < baseBars; i++) {
    const poke = wick && i === Math.floor(baseBars / 2);
    bars.push({ time: day(), open: 96, high: poke ? 100.1 : 97 + (i % 3), low: 92, close: poke ? 96 : 95 + (i % 3), volume: 8e5 });
  }
  if (closeAbove != null) bars.push({ time: day(), open: 98, high: closeAbove + 0.5, low: 97, close: closeAbove, volume: 2e6 });
  return bars;
}

test('a base resolves only on a CLOSE above the pivot; a wick through it is a failed poke', () => {
  const forming = detectBases(series({ wick: true }));
  assert.equal(forming.length, 1);
  assert.equal(forming[0].pivot, 100);
  assert.equal(forming[0].status, 'forming');
  assert.equal(forming[0].failedPokes, 1);

  const resolved = detectBases(series({ closeAbove: 101 }));
  assert.equal(resolved[0].status, 'breakout');
  assert.equal(resolved[0].breakout.entryClose, 101, 'the entry the ledger judges from is the breakout close');
});

test('a base that is too short is not a base', () => {
  assert.equal(detectBases(series({ baseBars: 6, closeAbove: 101 })).length, 0);
});

const md = (over = {}) => ({
  asset: 'T', assetType: 'stock',
  open: 99, close: 101, high: 101.5, low: 98.5, volume: 2e6, avgVolume: 1e6,
  ma20: 97, ma50: 94, ma150: 90, ma200: 85,
  highs: Array(20).fill(99), lows: Array(20).fill(92),
  high52w: 100, barsInRange: 6, priorBaseDays: 20, priorBaseRangePercent: 12,
  ...over,
});
const gb = (over = {}) => ({ pivot: 100, pivotDate: '2026-01-06', bars: 30, depthPct: 12, sky: true, status: 'breakout', breakoutDate: '2026-02-01', brokeOutToday: true, ...over });

test('the alert gate: graded base (blue sky, <=25% deep, above the 200-day) and a close above its pivot', () => {
  const r = analyzeBreakout(md({ gradedBase: gb() }));
  assert.equal(r.baseGrade, 'A+');
  assert.equal(r.gradedBreakoutToday, true);
  assert.equal(r.basePivot, 100);

  assert.equal(analyzeBreakout(md({ gradedBase: gb({ bars: 85, depthPct: 14 }) })).baseGrade, 'S');
  assert.equal(analyzeBreakout(md({ gradedBase: gb({ bars: 20, depthPct: 22 }) })).baseGrade, 'A');
  assert.equal(analyzeBreakout(md({ gradedBase: gb({ depthPct: 34.6 }) })).baseGrade, null, 'a 34.6% deep base (SWKS, Sep 2026) does not grade');
  assert.equal(analyzeBreakout(md({ gradedBase: gb({ sky: false }) })).baseGrade, null, 'no blue-sky pivot, no grade');
  assert.equal(analyzeBreakout(md({ ma200: 105, gradedBase: gb() })).baseGrade, null, 'under the 200-day, no grade');
  assert.equal(analyzeBreakout(md({ gradedBase: gb({ brokeOutToday: false, status: 'forming' }) })).gradedBreakoutToday, false, 'graded but still forming is not a breakout');
});

test('a shelf breakout inside an ungraded base still classifies as Type1 for tracking, but carries no grade', () => {
  // The 20-bar high is cleared on volume with a bullish candle and a prior base:
  // the screener shows it, the ledger does not count it and no email goes out.
  const r = analyzeBreakout(md({ gradedBase: gb({ depthPct: 34.6, brokeOutToday: false, status: 'forming' }) }));
  assert.equal(r.breakoutType, 'Type1');
  assert.equal(r.baseGrade, null);
  assert.equal(r.gradedBreakoutToday, false);
});

const deepGb = (over = {}) => gb({ depthPct: 28, bars: 56, sky: true, status: 'breakout', brokeOutToday: true, dryUp: 0.7, coil: 0.75, ...over });

test('deep base: 25-35% deep, blue sky, 8wk+, cleared by 3%+ on 1.5x volume', () => {
  // the grade still refuses it — that is the point of the kind
  const r = analyzeBreakout(md({ close: 103, high: 103.5, volume: 1.6e6, gradedBase: deepGb() }));
  assert.equal(r.baseGrade, null, 'past the 25% the grade allows');
  assert.equal(r.deepBase, true);
  assert.equal(r.gradedBreakoutToday, true, 'the trigger is the same close through the pivot');
  assert.equal(r.deepBasePremium, true, 'tight coil and a dry base');
  assert.equal(Math.round(r.pivotClearancePct * 10) / 10, 3, 'closed 3% through the 100 pivot');
});

test('deep base: each condition is load-bearing', () => {
  const deep = (o = {}) => analyzeBreakout(md({ close: 103, high: 103.5, volume: 1.6e6, ...o }));
  assert.equal(deep({ volume: 1.4e6, gradedBase: deepGb() }).deepBase, false, 'under 1.5x volume');
  assert.equal(deep({ close: 101, high: 101.5, gradedBase: deepGb() }).deepBase, false, 'a 1% clearance is not decisive');
  assert.equal(deep({ close: 102.5, high: 103, gradedBase: deepGb() }).deepBase, false, '2.5% is under the 3% floor');
  assert.equal(deep({ gradedBase: deepGb({ depthPct: 24 }) }).deepBase, false, '24% deep is a graded base, not this kind');
  assert.equal(deep({ gradedBase: deepGb({ depthPct: 36 }) }).deepBase, false, 'past 35% is broken structure');
  assert.equal(deep({ gradedBase: deepGb({ bars: 30 }) }).deepBase, false, 'under 8 weeks');
  assert.equal(deep({ gradedBase: deepGb({ sky: false }) }).deepBase, false, 'not blue sky');
  assert.equal(deep({ ma200: 105, gradedBase: deepGb() }).deepBase, false, 'under the 200-day');
  assert.equal(deep({ gradedBase: deepGb({ dryUp: 1.2, coil: 1.1 }) }).deepBasePremium, false, 'premium needs the tight coil and the dry base');
});

test('deep base: the two cases that set the thresholds now qualify', () => {
  // INTC 2026-04-08: 25.3% deep, 52 bars, 1.83x, closed 8.3% through the pivot, ran +112%
  const intc = analyzeBreakout(md({ close: 108.3, high: 109, volume: 1.83e6, gradedBase: deepGb({ depthPct: 25.3, bars: 52, dryUp: 1.12, coil: 1.03 }) }));
  assert.equal(intc.deepBase, true);
  assert.equal(intc.deepBasePremium, false, 'no tight coil, no dry base — it qualifies on the clearance');
  // AMD 2026-09-21: 27.5% deep, 56 bars, 1.84x, closed 5.3% through the pivot
  const amd = analyzeBreakout(md({ close: 105.3, high: 106, volume: 1.84e6, gradedBase: deepGb({ depthPct: 27.5, bars: 56, dryUp: 0.63 }) }));
  assert.equal(amd.deepBase, true);
});

test('deep base does not require tightness into the pivot: the study says it hurts here', () => {
  const src = readFileSync(new URL('../src/tools/breakout-logic.ts', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('const deepShape'), src.indexOf('const deepBasePremium'));
  assert.doesNotMatch(block, /pivotTightPct|tight10/, 'no tightness condition in the gate');
  assert.match(block, /pivotClearancePct >= 3/, 'the clearance is what sorts the band');
  assert.match(src, /Tightness before the breakout is deliberately NOT required/);
});

test('a deep-base alert freezes the close it cleared at, not the pivot it left', () => {
  const src = readFileSync(new URL('../src/agent.ts', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('const flipLevel = isDeepBreakout'), src.indexOf('const levelCleared'));
  assert.match(block, /isDeepBreakout\s*\?\s*data\.close/, 'deep uses the breakout close');
  assert.match(block, /isGradedBreakout && breakoutAnalysis\.basePivot > 0/, 'graded still uses the pivot');
  assert.match(src, /entry is the close, not the pivot/);
});
