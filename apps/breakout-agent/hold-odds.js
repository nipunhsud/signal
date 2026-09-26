// What a breakout does next, from how decisively it cleared and on what volume.
//
// Measured over 98,427 graded breakouts, 1985-2026. In the 20 sessions after a
// base resolves, every breakout is exactly one of three things:
//
//   holds    never closes back under the pivot        (25% of all)
//   retests  closes back under, then clears it again  (55%)
//   fails    closes back under and never recovers     (19%)
//
// Those shares move a long way with the clearance and the breakout bar's
// volume, and the two are not independent, so this is the joint table rather
// than a product of the margins. HPE on 2026-09-25 closed 0.1% above its pivot
// on ordinary volume — the top-left cell, 61% retest — and retested the next
// session.
//
// The odds are a description of the path, not of the payoff. Buying the
// breakout is profitable in every cell; the profit factor simply rises with
// the clearance, 1.60 in the weakest cell to 2.47 in the strongest. Waiting for
// the retest gains nothing: entering at the re-clear scores the same 1.80 as
// entering at the breakout, on 55% as many trades. See docs/retest-study.md.
//
// Pure, tested in test/hold-odds.test.mjs.

// [clearance band][volume band] -> { holds, retests, fails, pf, n }
const CLEARANCE_BANDS = [1, 3, 6, Infinity]; // % above the pivot, upper bounds
const VOLUME_BANDS = [1.5, 3, Infinity];     // x the 20-day average, upper bounds

const TABLE = [
  // cleared by under 1%
  [{ holds: 19, retests: 61, fails: 19, pf: 1.60, n: 44332 },
   { holds: 21, retests: 57, fails: 21, pf: 1.77, n: 10055 },
   { holds: 21, retests: 57, fails: 22, pf: 1.73, n: 1734 }],
  // 1 to 3%
  [{ holds: 29, retests: 53, fails: 17, pf: 1.82, n: 15736 },
   { holds: 33, retests: 49, fails: 18, pf: 1.87, n: 9090 },
   { holds: 36, retests: 47, fails: 17, pf: 2.27, n: 2468 }],
  // 3 to 6%
  [{ holds: 38, retests: 44, fails: 18, pf: 2.04, n: 1765 },
   { holds: 45, retests: 38, fails: 17, pf: 2.08, n: 2944 },
   { holds: 51, retests: 35, fails: 13, pf: 2.14, n: 1996 }],
  // 6% and up. The quiet-volume cell held only 173 cases, too few to quote, so
  // it borrows the row's own marginal (67/22/11) rather than a noisy estimate.
  [{ holds: 67, retests: 22, fails: 11, pf: 2.22, n: 173, borrowed: true },
   { holds: 57, retests: 30, fails: 13, pf: 2.22, n: 679 },
   { holds: 73, retests: 17, fails: 10, pf: 2.47, n: 1810 }],
];

const bandOf = (v, bounds) => {
  for (let i = 0; i < bounds.length; i++) if (v < bounds[i]) return i;
  return bounds.length - 1;
};

// clearancePct: today's close against the base pivot, in percent.
// volumeRatio: the breakout bar's volume over its 20-day average.
export function holdOdds(clearancePct, volumeRatio) {
  if (!Number.isFinite(clearancePct) || clearancePct <= 0) return null;
  if (!Number.isFinite(volumeRatio) || volumeRatio <= 0) return null;
  const cell = TABLE[bandOf(clearancePct, CLEARANCE_BANDS)][bandOf(volumeRatio, VOLUME_BANDS)];
  const likeliest = cell.holds >= cell.retests && cell.holds >= cell.fails
    ? 'holds'
    : cell.retests >= cell.fails ? 'retests' : 'fails';
  return { ...cell, likeliest, pct: cell[likeliest] };
}

// One sentence for the email and the drawer.
export function holdOddsWords(o) {
  if (!o) return null;
  const path = o.likeliest === 'holds'
    ? `holds the pivot ${o.holds}% of the time`
    : o.likeliest === 'retests'
      ? `comes back to the pivot ${o.retests}% of the time`
      : `fails ${o.fails}% of the time`;
  return `A clear like this ${path}: ${o.holds}% held, ${o.retests}% retested, ${o.fails}% failed on ${o.n.toLocaleString()} measured.`;
}
