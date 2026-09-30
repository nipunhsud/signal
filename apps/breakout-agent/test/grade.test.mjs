// The 1-10 grade: each weight is a measured lift, so the tests pin the
// ordering the measurements imply rather than the exact numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeSignal, gradeWords } from '../grade.js';

const base = {
  rsRating: 95, baseGrade: 'A', activityScore: 5,
  basePivot: 100, currentPrice: 102, volumeRatio: 1.5,
  isBlueSky: true, baseBars: 20,
};
const score = (o) => gradeSignal({ ...base, ...o }).score;

test('a row with nothing to grade on still returns a score, at the bottom', () => {
  const g = gradeSignal({ rsRating: null, baseGrade: null });
  assert.ok(g.score >= 1 && g.score <= 10);
  assert.ok(g.score <= 4, `expected a low score, got ${g.score}`);
  assert.equal(gradeSignal(null), null);
});

test('RS moves the score the way the study measured it', () => {
  assert.ok(score({ rsRating: 99 }) > score({ rsRating: 85 }));
  assert.ok(score({ rsRating: 85 }) > score({ rsRating: 40 }));
  assert.match(gradeSignal({ ...base, rsRating: 70 }).reasons.map((r) => r.text).join(' '), /under the 89 alert line/);
});

test('base grade orders S over A+ over A over ungraded', () => {
  const s = score({ baseGrade: 'S' }), ap = score({ baseGrade: 'A+' }), a = score({ baseGrade: 'A' }), none = score({ baseGrade: null });
  assert.ok(s >= ap && ap >= a && a > none, `${s} ${ap} ${a} ${none}`);
});

test('past 5% of the pivot the row is marked extended and penalised', () => {
  const near = gradeSignal({ ...base, currentPrice: 103 });
  const far = gradeSignal({ ...base, currentPrice: 130 });
  assert.equal(near.atLevel, true);
  assert.equal(far.atLevel, false);
  assert.ok(far.score < near.score);
  assert.match(far.reasons.map((r) => r.text).join(' '), /extended 30% past the pivot/);
});

test('a stale row is graded without the volume term, and says so', () => {
  const fresh = gradeSignal(base);
  const stale = gradeSignal(base, { stale: true });
  assert.equal(stale.stale, true);
  assert.match(stale.reasons.map((r) => r.text).join(' '), /volume not scored — the row is from earlier in the session/);
  assert.ok(!stale.reasons.some((r) => /x volume/.test(r.text)), 'no volume claim on a partial session');
  assert.ok(fresh.reasons.some((r) => /x volume/.test(r.text)));
});

test('a register too small to read is not counted as turnover', () => {
  const small = score({ institutions: { holders: 12, holdersPrior: 8 } });   // +50% on 8 holders
  const real = score({ institutions: { holders: 131, holdersPrior: 100 } }); // +31% on 100
  assert.equal(small, score({}), 'an 8-holder register changes nothing');
  assert.ok(real > small);
});

test('an episodic pivot and a deep base each lift, and are named', () => {
  assert.ok(score({ ep: true }) >= score({}));
  const g = gradeSignal({ ...base, deepBase: true, baseDepthPct: 30 });
  assert.match(g.reasons.map((r) => r.text).join(' '), /deep base, 30% deep/);
});

test('the score stays inside 1 to 10 at both extremes', () => {
  const best = gradeSignal({ rsRating: 99, baseGrade: 'S', activityScore: 10, basePivot: 100, currentPrice: 101, volumeRatio: 3, isBlueSky: true, baseBars: 60, ep: true, deepBase: true, institutions: { holders: 200, holdersPrior: 100 } });
  const worst = gradeSignal({ rsRating: 5, baseGrade: 'X', activityScore: 0, basePivot: 100, currentPrice: 180, volumeRatio: 0.3, isBlueSky: false, baseBars: 4 });
  assert.ok(best.score <= 10 && best.score >= 8, `best ${best.score}`);
  assert.ok(worst.score >= 1 && worst.score <= 3, `worst ${worst.score}`);
});

test('the sentence names the factors and refuses to sound like a probability', () => {
  const w = gradeWords(gradeSignal(base));
  assert.match(w, /^\d+\/10 on the measured factors: /);
  assert.match(w, /A ranking, not a probability/);
  assert.doesNotMatch(w, /\b(buy|sell|should|entry|position)\b/i);
  assert.equal(gradeWords(null), '');
});
