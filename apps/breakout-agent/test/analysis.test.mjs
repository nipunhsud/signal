import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDossier, snapshotOf, gradeOf } from '../analysis.js';

// A rising series that leaves price above every average, with a 52-week high
// a little overhead.
function bars(n = 400, last = 100) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const px = 40 + (last - 40) * (k / (n - 1));
    out.push({ time: `2026-01-${String((k % 28) + 1).padStart(2, '0')}`, open: px, high: px * 1.01, low: px * 0.99, close: px, volume: 1_000_000 });
  }
  return out;
}
const base = (over = {}) => ({ start: '2026-04-01', end: '2026-08-01', weeks: 18, depthPct: 12, pivot: 105, low: 92.4, bars: 90, status: 'forming', isBlueSky: true, failedPokes: 1, coilRatio: 0.8, volumeDryUp: 0.8, upDownVolumeRatio: 1.6, breakout: null, ...over });
const lean = (arr, name) => arr.find((x) => x.name === name)?.lean;
const ev = (arr, name) => arr.find((x) => x.name === name)?.evidence || '';

test('a thin history is refused rather than guessed at', () => {
  assert.match(buildDossier({ symbol: 'X', bars: bars(20) }).error, /not enough price history/);
  assert.equal(snapshotOf(bars(10)), null);
});

test('the snapshot reads the trend off the bars', () => {
  const s = snapshotOf(bars());
  assert.equal(s.above200, true);
  assert.equal(s.ma200Rising, true);
  assert.ok(s.ma20 > s.ma50 && s.ma50 > s.ma200, 'a rising series stacks the averages');
  assert.ok(s.pctFromHigh >= 0 && s.pctFromHigh < 3);
});

test('the grade follows the scanner rules: blue sky, 25% or shallower, above the 200-day', () => {
  const s = snapshotOf(bars());
  assert.equal(gradeOf(base({ bars: 90, depthPct: 12 }), s), 'S');
  assert.equal(gradeOf(base({ bars: 30, depthPct: 12 }), s), 'A+');
  assert.equal(gradeOf(base({ bars: 90, depthPct: 22 }), s), 'A');
  assert.equal(gradeOf(base({ isBlueSky: false }), s), null);
  assert.equal(gradeOf(base({ depthPct: 30 }), s), null);
  assert.equal(gradeOf(base(), { ...s, above200: false }), null);
});

test('hit-rate factors lean on the measured base rates', () => {
  const d = buildDossier({ symbol: 'GOOD', bars: bars(), bases: [base()] });
  assert.equal(d.grade, 'S');
  assert.equal(lean(d.hitRate, 'Base grade'), 'supportive');
  assert.match(ev(d.hitRate, 'Base grade'), /62\.6%/);
  assert.equal(lean(d.hitRate, 'Blue sky'), 'supportive');
  assert.match(ev(d.hitRate, 'Blue sky'), /57\.7%.*34\.5%/);
  assert.equal(lean(d.hitRate, 'Base age'), 'supportive');
  assert.equal(lean(d.hitRate, 'Failed pokes'), 'supportive', 'one or two pokes is the defended case');

  const bad = buildDossier({ symbol: 'BAD', bars: bars(), bases: [base({ isBlueSky: false, weeks: 3, bars: 15, depthPct: 14, failedPokes: 4 })] });
  assert.equal(bad.grade, null);
  assert.equal(lean(bad.hitRate, 'Base grade'), 'against');
  assert.match(ev(bad.hitRate, 'Base grade'), /32%/);
  assert.equal(lean(bad.hitRate, 'Depth'), 'against', '10-20% is the weakest pocket');
  assert.equal(lean(bad.hitRate, 'Failed pokes'), 'against');
});

test('payoff factors are kept apart from hit rate, with their own numbers', () => {
  const d = buildDossier({
    symbol: 'P', bars: bars(), bases: [base()],
    activity: { score: 6, acc: 5, dist: 0, bigUp: 2, udv: 1.6, obv: 0.1 },
    signal: { rsRating: 94 },
  });
  assert.equal(lean(d.payoff, 'Relative strength'), 'supportive');
  assert.match(ev(d.payoff, 'Relative strength'), /2\.20/);
  assert.equal(lean(d.payoff, 'Institutional activity'), 'supportive');
  assert.match(ev(d.payoff, 'Institutional activity'), /2\.10.*23\.8%/);
  assert.match(d.payoff.find((x) => x.name === 'Institutional activity').reading, /5 heavy up days and 0 heavy down/);
  assert.equal(d.weight.payoff.supportive >= 2, true);
  assert.equal(lean(d.payoff, 'Volume on the latest bar'), 'neutral', 'a flat-volume bar is not a payoff lever');

  const weak = buildDossier({ symbol: 'W', bars: bars(), bases: [base()], activity: { score: 1, acc: 1, dist: 1, bigUp: 0, udv: 0.9, obv: 0 }, signal: { rsRating: 45 } });
  assert.equal(lean(weak.payoff, 'Relative strength'), 'against');
  assert.equal(lean(weak.payoff, 'Institutional activity'), 'against');
});

test('the market trend state is the only tape factor credited, and only in its bad state', () => {
  const bad = buildDossier({ symbol: 'M', bars: bars(), bases: [base()], marketTrend: { underBothAverages: true, ma50Rising: false, label: 'SPY below both' } });
  assert.equal(lean(bad.hitRate, 'Market trend state'), 'against');
  assert.match(ev(bad.hitRate, 'Market trend state'), /1\.27/);
  const ok = buildDossier({ symbol: 'M', bars: bars(), bases: [base()], marketTrend: { underBothAverages: false, ma50Rising: true, label: 'SPY above both' } });
  assert.equal(lean(ok.hitRate, 'Market trend state'), 'neutral');
  assert.match(ev(ok.hitRate, 'Market trend state'), /risk-on 1\.80, caution 1\.80, risk-off 2\.00/);
});

test('the exit pair and the not-credited list travel with every dossier', () => {
  const d = buildDossier({ symbol: 'E', bars: bars(), bases: [base({ pivot: 100 })] });
  assert.equal(d.exits.failLevel, 93, '7% under the pivot');
  assert.match(d.exits.rule, /20% trailing stop/);
  assert.match(d.exits.evidence, /14% a year with a 26% maximum drawdown/);
  const names = d.notCredited.map((x) => x.factor);
  assert.ok(names.includes('Distribution days') && names.includes('Market health score') && names.includes('Breadth') && names.includes('Tightness into the pivot'));
  assert.match(d.disclaimer, /research, not advice/);
  assert.match(d.howToRead, /Nothing here is a recommendation/);
  for (const group of [d.hitRate, d.payoff, d.context]) {
    for (const x of group) assert.match(x.learn, /^https:\/\/dataquant\.ai\/learn\//, `${x.name} cites a Learn page`);
  }
});

test('context names where price sits, the screen record and the name\'s own history', () => {
  const d = buildDossier({
    symbol: 'C', bars: bars(400, 100), bases: [base({ pivot: 105 })],
    signal: { rsRating: 90, sectorRank: 2, sectorCount: 11, sector: 'Health Care', lastAlertAt: null, alertSentAt: null },
    sector: { name: 'Health Care', rank: 2, count: 11 },
    episodes: [{ status: 'past' }, { status: 'fell' }, { status: 'past' }],
  });
  assert.equal(d.pctToPivot, 5);
  assert.match(d.context.find((x) => x.name === 'Where price sits').value, /5% under the 105 pivot/);
  assert.match(d.context.find((x) => x.name === 'Sector').reading, /leading sector/);
  assert.match(d.context.find((x) => x.name === 'Screen record').reading, /never emailed/);
  assert.match(d.context.find((x) => x.name === 'Earlier breakouts on this name').reading, /2 held past the pivot, 1 fell/);
});
