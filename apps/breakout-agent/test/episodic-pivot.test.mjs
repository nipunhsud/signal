// The repricing bar a base is built on. Pure detection, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectBases } from '../base-detect.js';

// A run-up, one repricing bar, a base on top of it, then a breakout.
function series({ epGain = 25, epVol = 4, baseBars = 20 } = {}) {
  const bars = [];
  let t = 0;
  const day = () => { t++; return `2026-${String(Math.floor(t / 28) + 1).padStart(2, '0')}-${String((t % 28) + 1).padStart(2, '0')}`; };
  for (let i = 0; i < 40; i++) bars.push({ time: day(), open: 50, high: 51, low: 49, close: 50, volume: 1e6 });
  const prev = bars[bars.length - 1].close;
  const epClose = prev * (1 + epGain / 100);
  bars.push({ time: day(), open: prev, high: epClose * 1.01, low: prev, close: epClose, volume: 1e6 * epVol });
  // base under the repricing high
  for (let i = 0; i < baseBars; i++) {
    const c = epClose * (i % 2 ? 0.94 : 0.96);
    bars.push({ time: day(), open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 6e5 });
  }
  const top = epClose * 1.01;
  bars.push({ time: day(), open: top, high: top * 1.03, low: top * 0.99, close: top * 1.02, volume: 2.5e6 });
  return bars;
}

test('TWLO shape: a 25% day on 4x volume, a base on top, and the base carries it', () => {
  const b = detectBases(series()).pop();
  assert.ok(b, 'a base was found');
  assert.ok(b.episodicPivot, 'and it carries the repricing bar');
  assert.equal(b.episodicPivot.gainPct, 25);
  assert.equal(b.episodicPivot.volumeRatio, 4);
  assert.ok(b.episodicPivot.barsBeforePivot <= 15, 'found within the lookback');
});

test('size and volume both have to be there', () => {
  // 8% and 3x are the edge of the measured effect; below either, nothing.
  assert.equal(detectBases(series({ epGain: 7.5 })).pop().episodicPivot, null, 'a 7.5% day is an ordinary up day');
  assert.equal(detectBases(series({ epVol: 2.5 })).pop().episodicPivot, null, '2.5x does not confirm a repricing');
  assert.ok(detectBases(series({ epGain: 8.5, epVol: 3.2 })).pop().episodicPivot, 'just past both, it counts');
});

test('a quiet base carries nothing', () => {
  const bars = [];
  let t = 0;
  const day = () => { t++; return `2026-${String(Math.floor(t / 28) + 1).padStart(2, '0')}-${String((t % 28) + 1).padStart(2, '0')}`; };
  for (let i = 0; i < 45; i++) bars.push({ time: day(), open: 50 + i * 0.2, high: 51 + i * 0.2, low: 49 + i * 0.2, close: 50.5 + i * 0.2, volume: 1e6 });
  for (let i = 0; i < 20; i++) { const c = 58 - (i % 3); bars.push({ time: day(), open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 7e5 }); }
  bars.push({ time: day(), open: 60, high: 62, low: 59.5, close: 61.5, volume: 2.5e6 });
  const b = detectBases(bars).pop();
  if (b) assert.equal(b.episodicPivot, null);
});

test('the biggest repricing bar wins when there are two', () => {
  const bars = detectBases((() => {
    const s = series({ epGain: 10, epVol: 3.5 });
    // insert a bigger one two bars later, still inside the lookback
    const i = 41;
    const prev = s[i].close;
    s.splice(i + 1, 0, { time: '2026-02-15', open: prev, high: prev * 1.3, low: prev, close: prev * 1.28, volume: 5e6 });
    return s;
  })()).pop();
  assert.ok(bars.episodicPivot);
  assert.ok(bars.episodicPivot.gainPct > 20, `kept the larger one (${bars.episodicPivot.gainPct}%)`);
});
