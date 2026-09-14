// The alert ledger: the numbers behind the Saturday post, /pulse?w= and the
// Backtest tab. Pure functions, no database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeAlerts, summarize, composeReceipts, weekWindow } from '../alert-ledger.js';

const row = (asset, entry, stop, latest, extra = {}) => ({
  asset, entryPrice: entry, stopLoss: stop, currentPrice: entry, latestPrice: latest,
  lastAlertAt: new Date('2026-09-08T14:00:00Z'), baseGrade: 'A', baseBars: 40, ...extra,
});

test('each alert is judged from the emailed pivot against the latest price', () => {
  const alerts = gradeAlerts([
    row('PAST', 100, 93, 110),
    row('FELL', 100, 93, 92.5),
    row('BELOW', 100, 93, 97),
  ]);
  assert.deepEqual(alerts.map((a) => a.status), ['past', 'fell', 'below']);
  assert.equal(alerts[0].pct, 10);
  assert.equal(alerts[1].pct, -7.5);
  assert.equal(alerts[1].cappedPct, -7, 'a fall through the fail level is credited at the fail level');
  assert.equal(alerts[2].cappedPct, -3);
  assert.equal(alerts[0].baseWeeks, 8);
  assert.equal(alerts[0].kind, 'pivot');
});

test('a shelf alert is counted with its kind', () => {
  const [a] = gradeAlerts([row('SHELF', 70.75, 65.8, 74, { basePivot: 84.79, baseDepthPct: 22, currentPrice: 71.67 })]);
  assert.equal(a.kind, 'low-cheat');
});

test('legacy rows without a stored fail level use 7% below the pivot', () => {
  const [a] = gradeAlerts([row('X', 50, null, 46)]);
  assert.equal(a.fail, 46.5);
  assert.equal(a.status, 'fell');
});

test('a row the screen could not price is left out rather than counted at zero', () => {
  const alerts = gradeAlerts([row('NOENTRY', null, null, 10, { basePivot: null }), row('NOPRICE', 10, 9.3, 0, { currentPrice: 0 })]);
  assert.equal(alerts.length, 0);
});

test('the summary counts three ways and they add up', () => {
  const alerts = gradeAlerts([row('A', 100, 93, 110), row('B', 100, 93, 90), row('C', 100, 93, 99), row('D', 100, 93, 103)]);
  const s = summarize(alerts);
  assert.equal(s.count, 4);
  assert.equal(s.past + s.fell + s.below, s.count);
  assert.equal(s.best.asset, 'A');
  assert.equal(s.worst.asset, 'B');
  // (10 + -7 + -1 + 3) / 4, losses capped at the fail level
  assert.equal(s.avgCappedPct, 1.3);
});

test('the Saturday post says exactly what the ledger holds, in the product voice', () => {
  const alerts = gradeAlerts([row('SWKS', 70, 65.1, 87.4), row('ANL', 20, 18.6, 19.76), row('MTW', 21.34, 19.85, 22)]);
  const [main, reply] = composeReceipts({ alerts, summary: summarize(alerts) }, '2026-09-12');
  assert.match(main, /^Last week the screen produced 3 breakouts\. 2 are still past the pivot and 0 fell through the fail level\./);
  assert.match(main, /Best was SWKS at \+24\.9%\./);
  assert.match(main, /Worst was ANL at -1\.2%\./);
  assert.match(main, /Screen output for research, not advice\.$/);
  assert.equal(reply, 'Every one of them, with the levels: https://dataquant.ai/pulse?w=2026-09-12');
  for (const t of [main, reply]) {
    assert.ok(t.length <= 280, `tweet within 280 chars (${t.length})`);
    assert.doesNotMatch(t, /\b(stop|entry|buy|trade|setup|actionable)\b/i, 'no recommendation vocabulary');
    assert.doesNotMatch(t, /[🚀🔥🚨📈]/u);
  }
});

test('one alert reads as one alert', () => {
  const alerts = gradeAlerts([row('ONE', 10, 9.3, 9.8)]);
  const [main] = composeReceipts({ alerts, summary: summarize(alerts) }, '2026-09-12');
  assert.match(main, /produced 1 breakout\. 0 are still past the pivot/);
  assert.doesNotMatch(main, /Best was/, 'no best when nothing is past the pivot');
  assert.match(main, /Worst was ONE at -2\.0%/);
});

test('a week is the seven days ending on the posted date', () => {
  const { weekEnding, since, until } = weekWindow('2026-09-12', '2026-09-13');
  assert.equal(weekEnding, '2026-09-12');
  assert.equal(until.getTime() - since.getTime(), 7 * 24 * 60 * 60 * 1000);
  assert.equal(weekWindow('garbage', '2026-09-13').weekEnding, '2026-09-13');
});
