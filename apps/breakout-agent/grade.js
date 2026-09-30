// One number for a breakout, 1 to 10.
//
// Every weight here is a measured profit-factor lift from this repo's own
// studies, not a preference. The score is the sum of those lifts, rescaled.
// That means it ranks; it is not a probability, and two names a point apart are
// not meaningfully different.
//
//   RS bucket          minervini-rules-study: 1.75 at the bottom, 2.42 at the top
//   base grade         S 62.6% positive / 11.6% fail touch, A+ 57.7%/22.6%, A 54.8%/32.1%
//   activity score     institutional-activity-study: 1.77 -> 2.41, mostly reach
//   clearance x volume hold-odds table, what a clear this size on this volume did
//   episodic pivot     episodic-pivot-study: 1.84 -> 2.25
//   register turnover  institutional-ownership-study: 1.65 -> 2.27
//   extension          late-entry-study: past 5% the published numbers describe
//                      a different trade from the one on offer
//
// Staleness matters more than it looks. The scanner writes a row every 15
// minutes and the tiers finish at different times, so a row can be hours old
// with an hour of volume in it. Grading a partial session on the volume term
// invents a number, so when a row is stale the volume term is dropped and the
// reason says so.
import { holdOdds } from './hold-odds.js';
import { activityOdds } from './activity.js';

const RS_LIFT = [[95, 0.62], [89, 0.45], [80, 0.25], [60, 0.05]];
const GRADE_LIFT = { S: 0.55, 'A+': 0.30, A: 0.12, X: -0.40 };
// The lift range the factors can actually produce, used to map to 1-10.
const FLOOR = -1.2;
const RANGE = 3.4;
// Past this much clearance the pivot the numbers were measured at is gone.
const EXTENDED_PCT = 5;
// A register needs this many holders before a percentage move means anything.
const CHURN_MIN_REGISTER = 50;
const CHURN_HEAVY_PCT = 20;

const n = (v) => (v == null || v === '' ? null : Number(v));

export function gradeSignal(s, { stale = false } = {}) {
  if (!s) return null;
  const reasons = [];
  let pf = 0;
  const add = (lift, text) => { pf += lift; reasons.push({ lift: Math.round(lift * 100) / 100, text }); };

  const rs = n(s.rsRating);
  if (rs == null) add(-0.25, 'no RS rank');
  else {
    const lift = RS_LIFT.find(([floor]) => rs >= floor)?.[1] ?? -0.25;
    add(lift, `RS ${rs}${rs >= 89 ? '' : ' — under the 89 alert line'}`);
  }

  const g = s.baseGrade;
  add(g in GRADE_LIFT ? GRADE_LIFT[g] : -0.30, g ? `grade ${g}` : 'ungraded base');

  const act = n(s.activityScore);
  if (act != null) {
    // Discounted: the tape score moves reach far more than it moves win rate.
    add((activityOdds(act).pf - 1.77) * 0.55, `activity ${act}/10`);
  }

  const pivot = n(s.basePivot);
  const px = n(s.currentPrice);
  const clearance = pivot > 0 && px > 0 ? ((px - pivot) / pivot) * 100 : null;
  const vol = n(s.volumeRatio);
  if (stale) {
    reasons.push({ lift: 0, text: 'volume not scored — the row is from earlier in the session' });
  } else {
    const h = holdOdds(clearance, vol);
    if (h) add((h.pf - 1.80) * 0.5, `${clearance.toFixed(1)}% past the pivot on ${vol.toFixed(1)}x volume, ${h.likeliest} ${h.pct}%`);
  }

  if (g && s.isBlueSky === false) add(-0.12, 'not blue sky');
  if (s.ep) add(0.41, 'base built on an episodic pivot');
  if (s.deepBase) add(0.20, `deep base${n(s.baseDepthPct) != null ? `, ${n(s.baseDepthPct).toFixed(0)}% deep` : ''}`);

  const prior = n(s.institutions?.holdersPrior);
  const now = n(s.institutions?.holders);
  if (prior != null && prior >= CHURN_MIN_REGISTER && now != null) {
    const churn = Math.abs((now - prior) / prior) * 100;
    if (churn >= CHURN_HEAVY_PCT) add(0.31, `register turned over ${churn.toFixed(0)}%`);
  }

  if (clearance != null && clearance > EXTENDED_PCT) {
    add(-0.35, `extended ${clearance.toFixed(0)}% past the pivot — the measured numbers describe the pivot, not this price`);
  }

  const weeks = n(s.baseBars) != null ? n(s.baseBars) / 5 : null;
  if (weeks != null && weeks < 2) add(-0.20, `${weeks.toFixed(1)}-week base, shorter than anything measured`);

  const score = Math.max(1, Math.min(10, Math.round(((pf - FLOOR) / RANGE) * 9 + 1)));
  return {
    score,
    lift: Math.round(pf * 100) / 100,
    stale,
    // Still near the level everything was measured at.
    atLevel: clearance != null && clearance <= EXTENDED_PCT,
    clearancePct: clearance == null ? null : Math.round(clearance * 10) / 10,
    reasons,
  };
}

// The sentence for a tooltip or an email: the factors that moved it, biggest
// first, and nothing else.
export function gradeWords(gr) {
  if (!gr) return '';
  const top = [...gr.reasons].filter((r) => r.lift !== 0).sort((a, b) => Math.abs(b.lift) - Math.abs(a.lift)).slice(0, 4);
  const flat = gr.reasons.filter((r) => r.lift === 0).map((r) => r.text);
  return `${gr.score}/10 on the measured factors: ${top.map((r) => r.text).join('; ')}.${flat.length ? ` ${flat.join('. ')}.` : ''} A ranking, not a probability — the inputs are each measured, the weighting between them is not.`;
}
