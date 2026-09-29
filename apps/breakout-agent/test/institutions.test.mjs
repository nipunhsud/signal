// Form 13F: reading an institutional register without overclaiming.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isIndexManager, isMarketMaker, isPassiveHolder, notableHolders,
  cleanName, ownershipDrift, ownershipTag, ownershipWords, money, shareCount,
} from '../institutions.js';

const h = (manager, value, shares, priorShares = null) => ({ manager, value, shares, priorShares });

test('index complexes and market makers are told apart from managers who chose the position', () => {
  for (const n of ['BlackRock, Inc.', 'VANGUARD PORTFOLIO MANAGEMENT LLC', 'STATE STREET CORP', 'GEODE CAPITAL MANAGEMENT, LLC']) {
    assert.equal(isIndexManager(n), true, n);
    assert.equal(isPassiveHolder(n), true, n);
  }
  for (const n of ['JANE STREET GROUP, LLC', 'CITADEL ADVISORS LLC', 'SUSQUEHANNA INTERNATIONAL GROUP, LLP']) {
    assert.equal(isMarketMaker(n), true, n);
    assert.equal(isIndexManager(n), false, n);
  }
  for (const n of ['RENAISSANCE TECHNOLOGIES LLC', 'Alyeska Investment Group, L.P.', 'Capital World Investors', 'FMR LLC']) {
    assert.equal(isPassiveHolder(n), false, n);
  }
});

test('the notable holders are the ones who are there by choice', () => {
  const holders = [
    h('BlackRock, Inc.', 1.75e9, 13.7e6),
    h('VANGUARD PORTFOLIO MANAGEMENT LLC', 886e6, 6.9e6),
    h('JANE STREET GROUP, LLC', 262e6, 2.0e6),
    h('RENAISSANCE TECHNOLOGIES LLC', 120e6, 0.9e6),
    h('Alyeska Investment Group, L.P.', 29e6, 2.6e6),
  ];
  assert.deepEqual(notableHolders(holders).map((x) => x.manager), ['RENAISSANCE TECHNOLOGIES LLC', 'Alyeska Investment Group, L.P.']);
});

test('filer names become the name a reader recognises', () => {
  assert.equal(cleanName('FMR LLC'), 'Fidelity (FMR)');
  assert.equal(cleanName('PRICE T ROWE ASSOCIATES INC /MD/'), 'T. Rowe Price');
  assert.equal(cleanName('RENAISSANCE TECHNOLOGIES LLC'), 'Renaissance Technologies');
  assert.equal(cleanName('D. E. Shaw & Co., Inc.'), 'D. E. Shaw');
  assert.equal(cleanName('SOUTHERN CAPITAL SERVICES INC /ADV'), 'Southern Capital Services');
  assert.equal(cleanName('BANK OF NEW YORK MELLON CORP'), 'Bank of New York Mellon');
  assert.equal(cleanName('STATE STREET CORP'), 'State Street');
});

test('an initialism keeps its capitals; an ordinary word does not', () => {
  assert.equal(cleanName('MFS INVESTMENT MANAGEMENT'), 'MFS Investment Management');
  assert.equal(cleanName('UBS GROUP AG'), 'UBS Group');
  assert.equal(cleanName('GQG PARTNERS LLC'), 'GQG Partners');
  assert.equal(cleanName('NORGES BANK'), 'Norges Bank');
});

test('drift reports the direction only when the register actually moved', () => {
  assert.equal(ownershipDrift({ holders: 430, holdersPrior: 226, shares: 73.7e6, sharesPrior: 41e6 }).direction, 'more');
  assert.equal(ownershipDrift({ holders: 240, holdersPrior: 239, shares: 1, sharesPrior: 1 }).direction, 'flat');
  assert.equal(ownershipDrift({ holders: 200, holdersPrior: 240, shares: 1, sharesPrior: 1 }).direction, 'fewer');
  assert.equal(ownershipDrift({ holders: 100, holdersPrior: null }), null, 'nothing to compare with is not flat');
});

test('the chip says the count, and the change when there is one', () => {
  assert.equal(ownershipTag({ holders: 430, holdersPrior: 226, shares: 1, sharesPrior: 1 }), '430 funds · +204');
  assert.equal(ownershipTag({ holders: 240, holdersPrior: 239, shares: 1, sharesPrior: 1 }), '240 funds');
  assert.equal(ownershipTag({ holders: 0 }), null);
});

test('the sentence gives the count, the money, the move and who is there by choice', () => {
  const o = { asset: 'QMCO', period: '2026-06-30', holders: 59, holdersPrior: 33, shares: 14.4e6, sharesPrior: 8e6, value: 158e6, valuePrior: 80e6, opened: 35, closed: 9 };
  const holders = [
    h('BlackRock, Inc.', 20e6, 1.8e6, 1.7e6),
    h('Alyeska Investment Group, L.P.', 29e6, 2.65e6, null),
    h('Two Seas Capital LP', 27e6, 2.49e6, null),
  ];
  const w = ownershipWords(o, holders);
  assert.match(w, /^59 institutions reported 14\.4M shares worth \$158M as of 2026-06-30/);
  assert.match(w, /up from 33 the quarter before, with 35 opening a position and 9 exiting\./);
  assert.match(w, /Largest outside the index funds are Alyeska \$29M, Two Seas Capital \$27M\./);
  assert.match(w, /New this quarter: Alyeska \$29M and Two Seas Capital \$27M\./);
});

test('a new index position is never called out — Vanguard split its filing entities', () => {
  const o = { asset: 'NVDA', period: '2026-06-30', holders: 5890, holdersPrior: 5795, shares: 1, sharesPrior: 1, value: 1, valuePrior: 1, opened: 328, closed: 233 };
  const w = ownershipWords(o, [h('VANGUARD CAPITAL MANAGEMENT LLC', 308e9, 1540e6, null)]);
  assert.doesNotMatch(w, /New this quarter/);
  assert.doesNotMatch(w, /Vanguard/);
});

test('no holder reported is said plainly rather than shown as zero', () => {
  assert.equal(ownershipWords(null), 'No 13F holder reported this position.');
  assert.equal(ownershipWords({ holders: 0 }), 'No 13F holder reported this position.');
});

test('the oldest period loaded claims no change, because there is nothing behind it', () => {
  const w = ownershipWords({ asset: 'X', period: '2025-09-30', holders: 100, holdersPrior: null, shares: 1e6, value: 5e6 }, []);
  assert.match(w, /^100 institutions reported 1\.0M shares worth \$5M as of 2025-09-30\.$/);
});

test('the sentence carries no recommendation vocabulary', () => {
  const o = { asset: 'X', period: '2026-06-30', holders: 59, holdersPrior: 33, shares: 1e6, sharesPrior: 1e6, value: 1e6, valuePrior: 1e6, opened: 35, closed: 9 };
  const w = ownershipWords(o, [h('Alyeska Investment Group, L.P.', 29e6, 2.6e6, null)]);
  assert.doesNotMatch(w, /\b(entry|stop|position size|actionable|setup|bullish|strong|accumulating|smart money)\b/i);
  assert.doesNotMatch(w, /[🚀🔥🚨📈]/u);
});

test('money and share counts read at every scale', () => {
  assert.equal(money(3.32e12), '$3.3T');
  assert.equal(money(9.38e9), '$9.4B');
  assert.equal(money(158e6), '$158M');
  assert.equal(shareCount(16.6e9), '16.60B');
  assert.equal(shareCount(73.7e6), '73.7M');
  assert.equal(shareCount(900), '900');
});

// ── Register churn ──────────────────────────────────────────────────────────
// The one thing in the register that measured out over 49,382 breakouts: how
// far it moved, not which way. See scripts/institutional-ownership-study.mjs.
import { registerChurn, churnWords } from '../institutions.js';

test('churn needs a register big enough for a percentage to mean anything', () => {
  // The bucket fills with five-holder names otherwise: four to six reads +50%.
  assert.equal(registerChurn({ holders: 59, holdersPrior: 33 }), null);
  assert.equal(registerChurn({ holders: 8, holdersPrior: 4 }), null);
  assert.equal(registerChurn({ holders: 100, holdersPrior: null }), null);
  assert.equal(registerChurn({ holders: 75, holdersPrior: 50 }).heavy, true);
});

test('a big move counts the same whichever way it went', () => {
  const grew = registerChurn({ holders: 130, holdersPrior: 100 });
  const shrank = registerChurn({ holders: 70, holdersPrior: 100 });
  assert.equal(grew.pct, 30);
  assert.equal(shrank.pct, 30);
  assert.equal(grew.heavy, true);
  assert.equal(shrank.heavy, true);
  assert.equal(grew.direction, 'in');
  assert.equal(shrank.direction, 'out');
});

test('a quiet register is not called heavy', () => {
  const c = registerChurn({ holders: 246, holdersPrior: 240 });
  assert.equal(c.heavy, false);
  assert.equal(churnWords(c), '', 'nothing to say about a register that sat still');
});

test('the churn sentence gives the measured odds and refuses to read direction into it', () => {
  const w = churnWords(registerChurn({ holders: 430, holdersPrior: 226 }));
  assert.match(w, /turned over 90% on the quarter/);
  assert.match(w, /2\.27 profit factor against 1\.65/);
  assert.match(w, /reached \+20% within 60 sessions 30% of the time against 15%/);
  assert.match(w, /touched the fail level half the time against a third/);
  assert.match(w, /a register that shrank that much scored the same as one that grew/);
  assert.doesNotMatch(w, /\b(buy|entry|stop loss|accumulating|smart money|bullish)\b/i);
});

test('drift carries the churn so every reader gets the same number', () => {
  const d = ownershipDrift({ holders: 430, holdersPrior: 226, shares: 2, sharesPrior: 1 });
  assert.equal(d.churn.heavy, true);
  assert.equal(d.churn.pct, 90.3);
  assert.equal(ownershipDrift({ holders: 40, holdersPrior: 30, shares: 1, sharesPrior: 1 }).churn, null);
});
