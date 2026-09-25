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
  assert.match(deploy, /exit 1/, 'and the script exits non-zero');
  // The first version compared image ids from `compose config --images <svc>`,
  // which ignores the service argument and lists every image — so `head -1`
  // gave four services the same expected id and failed a deploy that had
  // replaced everything. Creation time needs no image plumbing.
  assert.match(deploy, /DEPLOY_STARTED="\$\(date -u/, 'the run stamps its start time before building');
  assert.match(deploy, /\[\[ "\$created" < "\$DEPLOY_STARTED" \]\]/, 'and every container must be newer than it');
  assert.doesNotMatch(deploy, /config --images/, 'no per-service image lookup that does not work');
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
  // Three tables render signals. The first pass removed the cell from one of
  // them and left the header, which silently shifted every column in the
  // Tracking table one to the left.
  assert.doesNotMatch(dash, />Confidence</, 'no table anywhere still has the column header');
  assert.doesNotMatch(dash, /\$\{item\.confidence\}/, 'nor the Shortlist tab');
  assert.doesNotMatch(dash, /By confidence tier/, 'the backtest splits on RS now');
  // A preset saved before the change can still name the old key, and the
  // comparator skips keys it does not know rather than complaining.
  assert.match(dash, /k\.key !== 'confidence'/, 'stored confidence sort keys are dropped on load');
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

// A 30%-deep base showed no grade and no explanation, reading as though the
// screen ignored it. The grade does stop at 25%, but the 25-35% band has its
// own alert kind, and over forty years it ran a higher profit factor than the
// graded one. The base card now says which side of the line a base is on.
test('dashboard: a base outside the grade says which band it is in', () => {
  const badges = between(dash, 'const badges = [', '].filter(Boolean)');
  assert.match(badges, /b\.depthPct > 25 && b\.depthPct <= 35 && b\.isBlueSky/, 'the alertable deep band is labelled');
  assert.match(badges, /Deep band/);
  assert.match(badges, /b\.depthPct > 35/, 'and so is the part the screen never alerts on');
  assert.match(badges, /Too deep/);
});

test('the grade itself still stops at 25%, and the deep kind covers 25-35%', () => {
  const logic = src('../src/tools/breakout-logic.ts');
  assert.match(logic, /gb\.depthPct <= 25\) \{/, 'the grade cap is unchanged');
  assert.match(logic, /gb\.depthPct > 25 &&\s*\n\s*gb\.depthPct <= 35/, 'the deep kind takes the band above it');
});

// A base built on a repricing bar reaches the screen and the email together,
// the standing rule for anything that changes how a breakout is judged.
test('the repricing bar travels from the detector to the card and the email', () => {
  const detect = src('../base-detect.js');
  assert.match(detect, /episodicPivot/, 'the detector produces it');
  assert.match(src('../src/tools/market-data.ts'), /ep: lastBase\.episodicPivot/, 'the scanner carries it onto gradedBase');
  assert.match(agent, /Built on an \$\{data\.gradedBase\.ep\.gainPct\}% repricing day/, 'the reasoning line names it, so the email does too');
  assert.match(dash, /b\.episodicPivot \?/, 'and the base card shows it');
  assert.match(dash, /Repriced \+\$\{b\.episodicPivot\.gainPct\}%/);
});

// TWLO cleared a 24.9%-deep blue-sky base at 241.28 on 2026-08-07, on 4.22x
// volume above a rising 200-day, and the screen holds no row for that date.
// The drawer reported that as a property of the stock: "it has not closed
// above a graded pivot yet". It had. The X-ray's verdict now outranks the
// rule list, and the panel names the miss instead.
test('profile: the X-ray is reconciled against the rows the scanner wrote', () => {
  assert.match(server, /const qualified = \[\]/, 'every resolved base is judged by the alert rules');
  assert.match(server, /xray: \{ qualified:.*missed:/, 'and returned with the ones no row covers');
  // A row counts if it names the same pivot or lands in the five sessions after.
  assert.match(server, /Math\.abs\(r\.basePivot - q\.pivot\) \/ q\.pivot < 0\.01/);
  assert.match(server, /5 \* 864e5/);
  // Only a row written on or after the breakout can have recorded it. TWLO's
  // 238.48 base had tracking rows naming that pivot for weeks before 7 August
  // and none after, so matching on the pivot alone called the miss covered.
  assert.match(server, /if \(r\.createdAt\.getTime\(\) < t\) return false;/);
});

test('profile: a missed breakout outranks "nothing rules it out"', () => {
  assert.match(dash, /const missed = \(p\.xray && p\.xray\.missed\) \|\| \[\]/);
  assert.match(dash, /if \(!why\.length && !missed\.length\) why\.push\('Nothing rules it out/,
    'the old sentence only survives when the X-ray agrees');
  assert.match(dash, /the screen has no row for/, 'and the miss is named');
  assert.match(dash, /not back-filled/, 'with why it is not silently invented');
});

// The droplet deploy failed on 2026-09-25 with TS6133 and TS2304 on one line:
// a tradingViewUrl declaration reading a helper that no longer exists. #38
// removed both when the email moved to our own ticker page; a conflict
// resolution in #43 brought the declaration back without the helper. tsc runs
// inside the image build, so every deploy failed and production stopped
// updating. Nothing may reference TradingView from the agent again.
test('agent: nothing references TradingView, so the build cannot break on it again', () => {
  assert.doesNotMatch(agent, /tradingViewUrl/, 'the dead declaration stays gone');
  assert.doesNotMatch(agent, /tradingViewSymbol/, 'and the helper it needed');
  assert.doesNotMatch(agent, /tradingview\.com/i, 'the alert email links to our own page');
  assert.match(agent, /\$\{dqUrl\(result\.asset\)\}/);
});

// The trade book showed MXL at $109.88 on 2026-09-25 against a $93.84 close.
// No bar has closed within $0.50 of that in two years: it was currentPrice off
// the newest BreakoutSignal row, which is whatever the quote said the last
// time the scanner looked at that name — months ago for anything that has
// stopped producing rows. Bars are the source of truth now.
test('book: a position is priced from bars, not from a scan row', () => {
  const fn = between(server, 'async function bookPrices(assets) {', '\n}');
  const barsAt = fn.indexOf('getDailyCandles');
  const rowAt = fn.indexOf('breakoutSignal.findMany');
  assert.ok(barsAt > -1 && rowAt > -1, 'both sources are present');
  assert.ok(barsAt < rowAt, 'bars are tried first');
  assert.match(fn, /stillMissing/, 'the scan row is only for names bars could not price');
  assert.match(fn, /createdAt: \{ gte: cutoff \}/, 'and only when it is recent');
  assert.match(fn, /asOf/, 'every price carries the session it came from');
});

test('book: a price that is not from the latest session says so', () => {
  assert.match(server, /latestSession: latestSession \|\| null/, 'the payload names the newest session');
  assert.match(dash, /p\.lastAsOf !== \(this\.book && this\.book\.latestSession\)/, 'and the row compares against it');
  assert.match(dash, /as of \$\{p\.lastAsOf\}/, 'showing the date rather than a bare number');
});

// The little letter pills on a row say which other tabs a ticker also appears
// in: W winners, B beat & raise, V unusual volume, L sector top name. They
// were read-only; these filter on the same membership.
test('screener: the cross-list pills can be filtered on', () => {
  const applied = between(dash, '// Quality filters — each active chip is a hard AND requirement', '// Minimum base grade');
  assert.match(applied, /const inList = \(asset, key\) => this\.listsFor\(asset\)\.some/,
    'the filter reuses listsFor, so a pill and its filter cannot drift');
  for (const [k, key] of [['winners', 'winners'], ['beatRaise', 'beat-raise'], ['unusualVol', 'unusual-volume'], ['sectorTop', 'sectors']]) {
    assert.match(applied, new RegExp(`q\\.${k}\\) filtered = filtered\\.filter\\(s => inList\\(s\\.asset, '${key}'\\)\\)`), `${k} filters on the ${key} list`);
  }
  // every key the filter reads must exist in the defaults, or a stored pref
  // silently resurrects a filter nobody can clear
  const defaults = between(dash, 'this.qualityFilters = prefs.qualityFilters ??', ';');
  for (const k of ['winners', 'beatRaise', 'unusualVol', 'sectorTop']) assert.match(defaults, new RegExp(`${k}: false`));
  assert.match(dash, /Also in Winners/, 'and an active filter shows a clearable chip');
});
