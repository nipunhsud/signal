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
  assert.match(agent, /const shouldAlert = \(isGradedBreakout \|\| isCheatBreakout \|\| isDeepBreakout\) && qualityOk;/);
  // The deep-base kind reaches the gate, the tease, the pool and the screener
  // in one change — the standing rule for any new breakout rule.
  assert.match(agent, /const isDeepBreakout =/);
  assert.match(between(agent, 'const isMeaningfulBreakout =', ';'), /isDeepBreakout/);
  assert.match(agent, /deepBase: breakoutAnalysis\.deepBase/, 'persisted');
  assert.match(agent, /This one is a deep base/, 'the email names the kind and its rates');
  // Quality floor: RS 89+ AND confidence 80%+ (Sep 2026). Both, not either —
  // Type 1 confidence is floored at 80% upstream, so an OR let everything through.
  assert.match(agent, /const qualityOk = rsRating != null && rsRating >= 89 && confidence >= 0\.8;/);
  const gate = between(agent, 'const isGradedBreakout =', ';');
  assert.match(gate, /baseGrade !== null/);
  assert.match(gate, /gradedBreakoutToday/);
  assert.doesNotMatch(gate, /breakoutType/);
  // The cheat kind goes through the same gate (shelf.js cheatGate), persists, and is worded as a shelf.
  assert.match(agent, /const isCheatBreakout = shelf != null;/);
  assert.match(between(agent, 'const isMeaningfulBreakout =', ';'), /isCheatBreakout/);
  assert.match(agent, /closed above a shelf inside its base/);
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
  assert.doesNotMatch(tease, /\["Type1", "Type1b"\]\.includes/, 'the tease is not gated on signal type');
  assert.match(tease, /closed above a shelf today/, 'a cheat alert teases as a shelf, not a pivot');
  assert.match(tease, /r\.deepBase === true/, 'a deep-base alert is not hidden from the tease by the grade gate');
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

test('the screener shows which rows were emailed', async () => {
  assert.match(server, /AS "episodeAlertedAt"/);
  assert.match(server, /alertedAt: s\.episodeAlertedAt/);
  assert.match(dash, /alertChipHtml\(signal\)/);
  assert.match(dash, /deepBaseChipHtml\(signal\)/, 'the screener labels the deep-base kind');
  assert.match(server, /deepBase: s\.deepBase === true/, 'the API returns it');
  const ledger = (await import('node:fs')).readFileSync(new URL('../alert-ledger.js', import.meta.url), 'utf8');
  assert.match(ledger, /'deep-pivot'/, 'the pool and the receipts carry the kind');
  assert.match(dash, /\/api\/history\//, 'per-ticker alert history is wired');
  assert.match(server, /app\.get\('\/api\/history\/:symbol'/);
});

// AMD 2026-09-22: the signal cell showed a bare "A" while the Grade ≥ A filter
// dropped the row. Its base is 27.5% deep, so it carries no grade at all — the
// A was the evidence cohort, a different scale wearing the same letter. The
// grade filter was right; the cell was ambiguous. The cohort letter now
// travels with its noun, from one helper, so the two cannot be confused.
test('dashboard: the evidence cohort never renders as a bare grade letter', () => {
  const helper = between(dash, 'cohortChipHtml(signal) {', '\n      },');
  assert.match(helper, /cohort \$\{c\}/, 'the chip names the scale it belongs to');
  assert.doesNotMatch(helper, />\$\{c\}</, 'never a bare letter in its own element');
  assert.match(helper, /Separate from the base grade/, 'the tooltip says so too');
  // Both render sites go through the helper: no inline copy can drift.
  const copies = dash.match(/Evidence cohort \(50-year study\)/g) || [];
  assert.equal(copies.length, 1, 'one definition of the cohort chip, not three');
  assert.equal((dash.match(/this\.cohortChipHtml\(signal\)/g) || []).length, 2, 'card view and table cell');
});

test('dashboard: the grade filter reads the base grade, not the cohort', () => {
  const f = between(dash, "if (this.gradeFilter && this.gradeFilter !== 'all') {", '}');
  assert.match(f, /s\.baseGrade && s\.baseGrade !== 'X'/, 'ungraded and unqualified rows are dropped');
  assert.doesNotMatch(f, /cohort/, 'the cohort is not a grade');
});
