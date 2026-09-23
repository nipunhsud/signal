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
  // Quality floor: RS 89+ AND 1.5x volume on the bar that cleared the level.
  // Confidence was measured over 97,563 graded breakouts and removed from the
  // gate: no graded breakout can score under 0.84, what it really gated was
  // the Type1 shape (78% of the pool cut for 0.15 of profit factor), and where
  // the number varies it runs backwards. See docs/confidence-study.md.
  assert.match(agent, /const volumeOkForAlert = data\.avgVolume > 0 && data\.volume >= data\.avgVolume \* 1\.5;/);
  assert.match(agent, /const qualityOk = rsRating != null && rsRating >= 89 && volumeOkForAlert;/);
  assert.doesNotMatch(between(agent, 'const qualityOk =', ';'), /confidence/, 'confidence no longer decides an email');
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

// A BUG alert arrived on 2026-09-23 in the email format deleted on 2026-09-09:
// rocket emoji in the subject, "Weak-Vol Breakout" for a Type1b, a TRADE SETUP
// block with a Buy Point, and "Source: Signal Forge". None of that is in the
// tree, so a container on the droplet had been scanning and emailing on
// two-week-old code, under none of the gates added since. The deploy now
// removes orphans and fails loudly when a running container is not on the
// image it just built.
test('deploy: a container cannot survive on old code without the deploy failing', () => {
  const deploy = src('../../../scripts/deploy.sh');
  assert.match(deploy, /up -d --remove-orphans/, 'a service the compose file no longer names is removed');
  assert.match(deploy, /DEPLOY INCOMPLETE/, 'a stale container fails the deploy');
  assert.match(deploy, /docker inspect -f '\{\{\.Image\}\}'/, 'each running container is compared to the built image');
  assert.match(deploy, /exit 1/, 'and the script exits non-zero');
});

test('email: the voice the alerts were rewritten to still holds', () => {
  const body = between(agent, 'const subject =', 'await sendEmail(');
  for (const banned of ['TRADE SETUP', 'Buy Point', 'Stop Loss', 'Risk/Reward', 'Signal Forge', '🚀']) {
    assert.ok(!body.includes(banned), `no "${banned}" in an alert email`);
  }
  assert.doesNotMatch(agent, /Weak-Vol Breakout/, 'Type1b does not label an email; it does not email at all');
});

// The alert email sent the reader to TradingView for the chart, which is a bare
// chart on a site we cannot annotate. Our own ticker page carries the same
// chart with the base boxes and depth drawn, the grade and its evidence, and
// the alert history for the name — everything the mail summarises.
test('email: the chart link goes to our own page, with a scheme', () => {
  const body = between(agent, 'const body = `', 'await sendEmail(');
  assert.doesNotMatch(body, /tradingview/i, 'no TradingView link in an alert');
  assert.match(body, /\$\{dqUrl\(result\.asset\)\}/, 'the ticker page instead');
  assert.match(agent, /const dqUrl = \(asset: string\) => `https:\/\/\$\{dqLink\(asset\)\}`;/,
    'as an absolute URL — mail clients autolink a bare host inconsistently');
  assert.doesNotMatch(agent, /tradingViewSymbol/, 'and the exchange-prefix helper it needed is gone');
});

// Confidence was the other half of the email gate until it was measured.
// Replicated over 97,563 graded breakouts, 1985-2026: no graded breakout can
// score below 0.84, so it never filtered on the number; what it filtered on
// was the Type1 five-bar shape, which scores 0.10 when absent, cutting 78% of
// the pool to buy 0.15 of profit factor; and where the number does vary it
// runs backwards, because its largest term penalises a loose five-bar range
// and a loose range measured better. docs/confidence-study.md.
test('email: confidence does not gate an email, and volume does', () => {
  const q = between(agent, 'const qualityOk =', ';');
  assert.doesNotMatch(q, /confidence/);
  assert.match(q, /rsRating >= 89/, 'RS holds up: under 89 runs 1.73, 89-95 runs 2.04, 95+ runs 2.45');
  assert.match(q, /volumeOkForAlert/);
  // The floor is the breakout bar's own volume, not the five bars before it —
  // which is what confidence read, and why it missed this entirely.
  assert.match(agent, /data\.volume >= data\.avgVolume \* 1\.5/);
});

test('the gate still refuses a name with no RS rank', () => {
  assert.match(between(agent, 'const qualityOk =', ';'), /rsRating != null/);
});

// Confidence drove the dashboard's quality signals too, and every one of them
// marked the worse half. Measured over 97,563 graded breakouts, by profit
// factor: the elite tint (0.99+) ran 1.72 against 2.14 for the yellow band,
// and the star (0.90+) ran 1.81 against 2.09 for the rows without one. The
// minimum-confidence slider defaulted to 85, which hid every row scoring 0.10
// — the 78% of graded breakouts that are not Type1, and the better-performing
// majority. All of it is gone; RS took the slider and the sort.
test('dashboard: confidence no longer colours, stars, tints, filters or sorts', () => {
  assert.doesNotMatch(dash, /minConfidence/, 'the confidence floor filter is gone');
  assert.doesNotMatch(dash, /tier-elite|tier-strong/, 'rows are not tinted by confidence');
  assert.doesNotMatch(dash, /★ High/, 'no high-confidence star');
  assert.doesNotMatch(dash, /confTextColor|confColor/, 'no confidence colour ramp');
  assert.doesNotMatch(dash, /\$\{signal\.confidence\}/, 'confidence is not rendered on a row or card');
  assert.doesNotMatch(dash, /toggleSort\('confidence'/, 'no confidence column to sort');
  assert.doesNotMatch(between(dash, 'const sortVal = {', '};'), /confidence/, 'not a sort key either');
});

test('dashboard: RS took its place, on the key the sort map actually uses', () => {
  assert.match(dash, /minRs/, 'the slider filters on relative strength');
  assert.match(dash, /this\.minRs = prefs\.minRs \?\? 0;/, 'and starts at 0, hiding nothing');
  const sortVal = between(dash, 'const sortVal = {', '};');
  assert.match(sortVal, /rs: \(s\) => s\.rsRating/, "RS is keyed 'rs'");
  // The default sort must name a key sortVal knows, or it silently does nothing.
  const dflt = between(dash, 'const keys = this.sortKeys?.length ? this.sortKeys :', ';');
  for (const k of dflt.match(/key: '([^']+)'/g).map((m) => m.slice(6, -1))) {
    assert.match(sortVal, new RegExp(`\\b${k}: \\(s\\)`), `the default sort key '${k}' exists in the map`);
  }
});
