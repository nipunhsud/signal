// X post lead lines, kept out of server.js so they can be tested.
// Voice: .claude/skills/dataquant-voice/SKILL.md.
import { classifyShelf } from './shelf.js';

// The first line of a post says what kind of row this is, in the house voice:
// a shelf is not a pivot, an extension is not a fresh close, a catalyst day
// and a gap retest each say what actually happened.
export function breakoutLead(asset, sig, { money, pivot, pct, isExt }) {
  const t = `$${asset.replace(/\.(NS|BO)$/i, '')}`;
  if (sig.breakoutType === 'Setup') {
    const dist = sig.distanceToPivotPct != null ? Number(sig.distanceToPivotPct) : null;
    return `${t} is building a handle${dist != null && dist > 0 ? ` ${dist.toFixed(1)}% under its pivot` : ' near its pivot'}${pivot ? `, ${pivot}` : ''}.`;
  }
  if (sig.breakoutType === 'EP') {
    return `${t} repriced today${sig.volumeRatio ? ` on ${Number(sig.volumeRatio).toFixed(1)}x average volume` : ''}, closing at ${money(sig.currentPrice)}.`;
  }
  if (sig.breakoutType === 'GR') {
    return `${t} held its gap and closed above the prior day's high${pivot ? `, ${pivot}` : ''}.`;
  }
  if (isExt) {
    if (pct != null && pct <= 3) return `${t} came back to its pivot${pivot ? `, ${pivot}` : ''}, and the base still holds.`;
    return `${t} is holding past its pivot${pivot ? `, ${pivot}` : ''}${pct != null ? `, now ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% past it` : ''}.`;
  }
  const shelf = classifyShelf({ level: sig.entryPrice, basePivot: sig.basePivot, baseDepthPct: sig.baseDepthPct, price: sig.currentPrice });
  if (shelf) return `${t} closed above a shelf${pivot ? `, ${pivot}` : ''}, ${shelf.posPct}% of the way up a base that has not resolved.`;
  if (pct != null && pct < 0) return `${t} cleared its pivot${pivot ? `, ${pivot}` : ''}, and is back ${Math.abs(pct).toFixed(1)}% under it.`;
  return `${t} closed above its pivot${pivot ? `, ${pivot}` : ''}.`;
}

