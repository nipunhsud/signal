// Where a signal row stands: did the entry level ever get cleared, is it
// below the pivot with no trade to track, did it fall through the fail level.
// Pure, tested. Used by /api/signals for every row.
//
// The legacy check compared the streak's highest SCAN price with the frozen
// entry. A graded row can be emailed on a settled close above the pivot while
// every scan price the row ever stored sits under it (post-close pass reading
// a pre-auction quote; a pullback the next morning), and the row then wore
// "Below pivot" although the screen had just emailed it as a pivot close
// (NET 2026-09-14). An emailed graded row has cleared its pivot by definition.
export function rowState({ entryPrice, entryResistance, streakHigh, currentPrice, stopLoss, baseGrade, basePivot, alertedAt }) {
  const graded = baseGrade != null && baseGrade !== 'X' && basePivot != null && basePivot > 0;
  const gradedCleared = graded && (!!alertedAt || (streakHigh != null && streakHigh >= basePivot * 0.99));
  const entryCleared =
    entryPrice == null || streakHigh == null || entryResistance == null ||
    streakHigh >= entryResistance * 0.99 || gradedCleared;
  const level = graded ? basePivot : entryResistance;
  const noEntry = !entryCleared && level != null && currentPrice < level;
  const stoppedOut = entryCleared && stopLoss != null && currentPrice <= stopLoss;
  return { entryCleared, noEntry, stoppedOut };
}
