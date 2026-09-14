// Every channel counts the same population: the breakouts the screen emailed.
// These read the source so a future edit that points one channel back at a
// signal type (the Sep 2026 receipts drift) fails here, not on X.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const agent = src('../src/agent.ts');
const server = src('../server.js');
const pulse = src('../public/pulse.html');
const dash = src('../public/index.html');
const between = (s, start, end) => { const i = s.indexOf(start); assert.ok(i >= 0, `found ${start}`); const j = s.indexOf(end, i + start.length); return s.slice(i, j < 0 ? undefined : j); };

test('email: the alert gate is the graded pivot close and nothing else', () => {
  assert.match(agent, /const shouldAlert = isGradedBreakout;/);
  const gate = between(agent, 'const isGradedBreakout =', ';');
  assert.match(gate, /baseGrade !== null/);
  assert.match(gate, /gradedBreakoutToday/);
  assert.doesNotMatch(gate, /breakoutType/);
});

test('email: the emailed row alone carries the alert stamp', () => {
  const stamp = between(agent, '// Stamp the row that was emailed', 'console.log(`✓ Alert sent');
  assert.match(stamp, /breakoutSignal\.update\(\{\s*where: \{ id: latestRecord\.id \}/);
  assert.match(stamp, /lastAlertAt: now/);
  assert.match(stamp, /alertSentAt: now/);
  assert.doesNotMatch(stamp, /updateMany/);
});

test('daily X tease reads only rows emailed today', () => {
  const tease = between(agent, 'async postXSignalTeasers', 'async postXPerformanceAudit');
  assert.match(tease, /lastAlertAt: \{ gte: startOfToday \}/);
});

test('weekly receipts, /api/alerts and the pulse page share the ledger', () => {
  const receipts = between(server, 'async function postWeeklyReceipts', '\n}\n');
  assert.match(receipts, /alertLedger\(/);
  assert.doesNotMatch(receipts, /breakoutType/);
  assert.match(receipts, /composeReceipts\(/);
  const api = between(server, "app.get('/api/alerts'", '\n});');
  assert.match(api, /alertLedger\(/);
  assert.match(api, /composeReceipts\(/, 'the page gets the same sentences the post carries');
  const ledger = between(server, 'async function alertLedger', '\n}\n');
  assert.match(ledger, /"lastAlertAt" >= \$\{since\}/);
  assert.doesNotMatch(ledger, /breakoutType"\s*(=|IN)/i, 'the ledger never selects on signal type');
  assert.match(pulse, /fetch\('\/api\/alerts'/);
  assert.match(pulse, /\?w=/, 'the tweet link lands on the week it names');
});

test('backtest and the monthly X audit score the emailed breakouts', () => {
  const bt = between(server, "app.get('/api/backtest'", "ORDER BY asset, \"createdAt\" ASC");
  const alertBranch = between(bt, "type === 'Type1'", ': await db.$queryRaw');
  assert.match(alertBranch, /"lastAlertAt" IS NOT NULL/);
  assert.match(alertBranch, /"lastAlertAt" AS "signalDate"/);
  assert.doesNotMatch(alertBranch, /"breakoutType" =/);
  assert.match(agent, /\/api\/backtest\?type=Type1/);
});

test('the screener shows which rows were emailed', () => {
  assert.match(server, /AS "episodeAlertedAt"/);
  assert.match(server, /alertedAt: s\.episodeAlertedAt/);
  assert.match(dash, /alertChipHtml\(signal\)/);
  assert.match(dash, /\/api\/history\//, 'per-ticker alert history is wired');
  assert.match(server, /app\.get\('\/api\/history\/:symbol'/);
});
