import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradePosition, bookStats, runningList, parseTrade, weekWindowOf, daysBetween } from '../book.js';

const t = (o = {}) => ({ asset: 'AAPL', status: 'open', openedAt: '2026-09-01T14:00:00Z', entry: 100, stop: 93, shares: 100, exit: null, closedAt: null, updatedAt: '2026-09-01T14:00:00Z', ...o });
const NOW = new Date('2026-09-22T20:00:00Z');

test('a position is measured in R, the unit the exit study reports in', () => {
  const p = gradePosition(t(), 121, NOW);
  assert.equal(p.pct, 21);
  assert.equal(p.r, 3, '21 up on 7 of risk');
  assert.equal(p.days, 21);
  assert.equal(p.value, 12100);
  assert.equal(p.riskAtEntry, 700);
  assert.equal(p.openRisk, 2800, 'what is still at stake down to the stop');
  assert.equal(p.belowStop, false);
});

test('a closed position ignores the live price and uses its exit', () => {
  const p = gradePosition(t({ status: 'closed', exit: 114, closedAt: '2026-09-15T20:00:00Z' }), 200, NOW);
  assert.equal(p.closed, true);
  assert.equal(p.last, 114);
  assert.equal(p.r, 2);
  assert.equal(p.days, 14);
});

test('a position with no stop says so rather than inventing risk', () => {
  const p = gradePosition(t({ stop: null }), 110, NOW);
  assert.equal(p.noStop, true);
  assert.equal(p.r, null, 'no risk taken means no R to report');
  assert.equal(p.pct, 10);
});

test('below the stop is flagged, and a stop above the entry is refused on write', () => {
  assert.equal(gradePosition(t(), 92, NOW).belowStop, true);
  assert.match(parseTrade({ asset: 'AAPL', entry: 100, stop: 105 }).error, /below the entry/);
});

test('stats read like the studies: win rate, average R, profit factor', () => {
  const rs = [3, 2, -1, -1, 1, -1].map((r, i) =>
    gradePosition(t({ asset: 'T' + i, status: 'closed', exit: 100 + r * 7, closedAt: '2026-09-10T20:00:00Z' }), null, NOW));
  const s = bookStats(rs);
  assert.equal(s.closed, 6);
  assert.equal(s.wins, 3);
  assert.equal(s.winRate, 50);
  assert.equal(s.avgR, 0.5);
  assert.equal(s.profitFactor, 2, '6R of gains against 3R of losses');
  assert.equal(s.best.r, 3);
  assert.equal(s.worst.r, -1);
});

test('an empty book reports nothing rather than zeroes that look like a record', () => {
  const s = bookStats([]);
  assert.equal(s.closed, 0);
  assert.equal(s.winRate, null);
  assert.equal(s.profitFactor, null);
});

test('the running list holds only what can be acted on', () => {
  const win = weekWindowOf(NOW);
  const positions = [
    gradePosition(t({ asset: 'OPEN1', openedAt: '2026-09-18T14:00:00Z' }), 110, NOW),
    gradePosition(t({ asset: 'NOSTOP', stop: null, openedAt: '2026-09-19T14:00:00Z' }), 105, NOW),
    gradePosition(t({ asset: 'UNDER', openedAt: '2026-09-02T14:00:00Z' }), 91, NOW),
    gradePosition(t({ asset: 'RUNNER', openedAt: '2026-08-01T14:00:00Z' }), 130, NOW),
    gradePosition(t({ asset: 'DONE', status: 'closed', exit: 114, closedAt: '2026-09-19T20:00:00Z' }), null, NOW),
  ];
  const r = runningList(positions, win, ['OPEN1', 'TWLO', 'OMER']);
  assert.equal(r.openCount, 4);
  assert.deepEqual(r.openedThisWeek.map((x) => x.asset), ['OPEN1', 'NOSTOP']);
  assert.deepEqual(r.closedThisWeek.map((x) => x.asset), ['DONE']);
  assert.equal(r.realisedR, 2);
  assert.deepEqual(r.attention.map((a) => [a.asset, a.why]), [
    ['UNDER', 'below its stop'],
    ['NOSTOP', 'no stop set'],
    ['RUNNER', 'up 4.29R'],
  ]);
  assert.deepEqual(r.notLogged, ['TWLO', 'OMER'], 'emailed this week and not in the book');
});

test('writes are validated, and a ticker and an entry are the only things required', () => {
  assert.match(parseTrade({ entry: 10 }).error, /ticker is required/);
  assert.match(parseTrade({ asset: 'AAPL' }).error, /entry price is required/);
  const ok = parseTrade({ asset: 'aapl', entry: '100', stop: '93', shares: '50', note: 'x', signalGrade: 'A' }).value;
  assert.equal(ok.asset, 'AAPL');
  assert.equal(ok.entry, 100);
  assert.equal(ok.stop, 93);
  assert.equal(ok.signalGrade, 'A');
  const closing = parseTrade({ exit: '114', closedAt: '2026-09-20' }, { partial: true }).value;
  assert.equal(closing.status, 'closed');
  assert.equal(closing.exit, 114);
  const reopen = parseTrade({ exit: null }, { partial: true }).value;
  assert.equal(reopen.status, 'open');
  assert.equal(reopen.closedAt, null);
});

test('days are counted forward only', () => {
  assert.equal(daysBetween('2026-09-01', '2026-09-22'), 21);
  assert.equal(daysBetween('2026-09-22', '2026-09-01'), 0);
});
