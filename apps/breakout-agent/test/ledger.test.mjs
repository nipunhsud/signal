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

// ── Episodes: one card per frozen entry ─────────────────────────────────────
import { foldEpisodes } from '../alert-ledger.js';
const d = (s) => new Date(`${s}T15:00:00Z`);
const scanRow = (date, o) => ({ createdAt: d(date), breakoutType: 'Type1', currentPrice: 10, entryPrice: null, stopLoss: null, basePivot: null, baseGrade: null, baseBars: null, baseDepthPct: null, volumeTag: null, alertSentAt: null, lastAlertAt: null, xPostedAt: null, resistance: null, ...o });

test('a re-segmented base does not split one entry into several cards (DE)', () => {
  const eps = foldEpisodes([
    scanRow('2026-06-26', { entryPrice: 9.11, stopLoss: 8.47, basePivot: 9.11, baseGrade: 'A', baseBars: 30, baseDepthPct: 19, currentPrice: 10.8 }),
    scanRow('2026-07-16', { entryPrice: 9.11, stopLoss: 8.47, basePivot: 11.0, baseGrade: 'A', baseBars: 10, baseDepthPct: 9, currentPrice: 11.3 }),
    scanRow('2026-08-25', { entryPrice: 9.11, stopLoss: 8.47, basePivot: 12.5, baseGrade: 'A', baseBars: 10, baseDepthPct: 8, currentPrice: 12.2 }),
  ]);
  assert.equal(eps.length, 1);
  assert.equal(eps[0].entry, 9.11);
  assert.equal(eps[0].basePivot, 12.5, 'carries the latest base');
  assert.equal(eps[0].status, 'past');
  assert.equal(eps[0].maxPct, 33.9);
});

test('a level under the base pivot is a shelf, and the base pivot rides along (ZETA)', () => {
  const eps = foldEpisodes([
    scanRow('2026-09-01', { entryPrice: 31.05, stopLoss: 28.88, basePivot: 32.81, baseGrade: 'A', baseBars: 10, baseDepthPct: 9, currentPrice: 31.3 }),
    scanRow('2026-09-11', { entryPrice: 31.05, stopLoss: 28.88, basePivot: 32.81, baseGrade: 'A', baseBars: 10, baseDepthPct: 9, currentPrice: 30.21 }),
  ]);
  assert.equal(eps.length, 1);
  assert.equal(eps[0].kind, 'shelf');
  assert.equal(eps[0].basePivot, 32.81);
  assert.equal(eps[0].status, 'below');
});

test('fell through the fail level is credited at the fail level, with the date, whatever came after', () => {
  const eps = foldEpisodes([
    scanRow('2026-07-13', { entryPrice: 22.9, stopLoss: 21.3, basePivot: 22.9, currentPrice: 23.1 }),
    scanRow('2026-07-17', { entryPrice: 22.9, stopLoss: 21.3, basePivot: 22.9, currentPrice: 21.0 }),
    scanRow('2026-08-05', { entryPrice: 22.9, stopLoss: 21.3, basePivot: 22.9, currentPrice: 27.1, lastAlertAt: d('2026-08-05') }),
  ]);
  assert.equal(eps.length, 1);
  assert.equal(eps[0].status, 'fell');
  assert.equal(eps[0].fellAt.toISOString().slice(0, 10), '2026-07-17');
  assert.equal(eps[0].cappedPct, -7);
  assert.equal(eps[0].pct, 18.3);
  assert.equal(eps[0].alertedPrice, 27.1);
});

test('a new entry starts a new card; rows without an entry group by base pivot', () => {
  const eps = foldEpisodes([
    scanRow('2026-05-22', { basePivot: 674.19, baseGrade: 'A', currentPrice: 620 }),
    scanRow('2026-06-25', { basePivot: 674.19, baseGrade: 'A', currentPrice: 622 }),
    scanRow('2026-08-21', { entryPrice: 643.99, stopLoss: 598.91, basePivot: 674.19, baseGrade: 'A', currentPrice: 647 }),
    scanRow('2026-09-01', { entryPrice: 674.19, stopLoss: 627, basePivot: 674.19, baseGrade: 'A', currentPrice: 676 }),
  ]);
  assert.deepEqual(eps.map((e) => e.kind), ['pivot', 'shelf', 'tracking']); // newest first
  assert.equal(eps[2].scans, 2);
});

// Rows as the scanner writes them: ascending, one per changed scan.
const amdRow = (over = {}) => ({
  createdAt: new Date('2026-09-21T14:00:00Z'), breakoutType: 'Type1', currentPrice: 600.9,
  entryPrice: 559.91, stopLoss: 520.72, basePivot: 584.73, baseGrade: null, baseBars: 56,
  baseDepthPct: 27.5, volumeTag: 'quiet', alertSentAt: null, lastAlertAt: null, xPostedAt: null, ...over,
});

test('AMD: the open episode takes the newest price even when the newest row folded into no episode', () => {
  const rows = [
    amdRow({ createdAt: new Date('2026-09-21T14:00:00Z'), currentPrice: 600.9 }),
    amdRow({ createdAt: new Date('2026-09-21T20:30:00Z'), currentPrice: 600.905 }),
    // the base re-segments after the breakout: no entry yet, so this row's
    // episode is dropped — its price must not be dropped with it
    amdRow({ createdAt: new Date('2026-09-21T21:00:00Z'), currentPrice: 615.53, entryPrice: null, basePivot: null, baseGrade: null }),
  ];
  const [open] = foldEpisodes(rows);
  assert.equal(open.lastPrice, 615.53);
  assert.equal(open.pct, 9.9, 'the card and the header agree');
  assert.equal(open.maxPct, 9.9);
  assert.equal(open.status, 'past');
  assert.equal(String(open.asOf), String(new Date('2026-09-21T21:00:00Z')));
});

test('a shelf entry stops saying "inside the base" once the pivot is cleared', () => {
  const inside = foldEpisodes([amdRow({ currentPrice: 570 })])[0];
  assert.equal(inside.kind, 'shelf');
  assert.equal(inside.pivotCleared, false, '570 is under the 584.73 pivot');

  const cleared = foldEpisodes([
    amdRow({ currentPrice: 570 }),
    amdRow({ createdAt: new Date('2026-09-21T20:00:00Z'), currentPrice: 615.53 }),
  ])[0];
  assert.equal(cleared.kind, 'shelf', 'the entry was still a shelf');
  assert.equal(cleared.pivotCleared, true, 'but the base has resolved since');
});

test('an episode that fell through its fail level stays fallen after the newest price', () => {
  const ep = foldEpisodes([
    amdRow({ currentPrice: 559 }),
    amdRow({ createdAt: new Date('2026-09-21T18:00:00Z'), currentPrice: 515 }), // under 520.72
    amdRow({ createdAt: new Date('2026-09-21T21:00:00Z'), currentPrice: 600, entryPrice: null, basePivot: null }),
  ])[0];
  assert.equal(ep.status, 'fell');
  assert.equal(ep.cappedPct, -7, 'credited at the fail level, whatever price did after');
});
