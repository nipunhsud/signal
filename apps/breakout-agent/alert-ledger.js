// The alert ledger: ONE population for every public number. An "alert" is a
// breakout the screen emailed (graded base, close above the pivot — the
// shouldAlert gate in src/agent.ts). The Saturday receipts post, /pulse?w=,
// /api/alerts, the Backtest tab and the monthly X audit all count this set,
// so the tweet, the page and the inbox always agree.
//
// Pure functions of rows — no I/O — so the grading and the wording are
// testable without a database (test/ledger.test.mjs). server.js does the SQL.
import { classifyShelf } from './shelf.js';

// Judge each emailed row against the asset's latest price. Entry is the
// frozen pivot the close cleared; the fail level is the stored stopLoss, or
// 7% below the pivot when a legacy row has none.
export function gradeAlerts(rows) {
  return rows
    .map((r) => {
      const entry = r.entryPrice != null ? Number(r.entryPrice) : r.basePivot != null ? Number(r.basePivot) : null;
      if (!entry || entry <= 0) return null;
      const fail = r.stopLoss != null ? Number(r.stopLoss) : entry * 0.93;
      const current = Number(r.latestPrice ?? r.currentPrice);
      if (!current || current <= 0) return null;
      const pct = ((current - entry) / entry) * 100;
      const failPct = ((fail - entry) / entry) * 100;
      const status = current <= fail ? 'fell' : current > entry ? 'past' : 'below';
      // What kind of close was emailed: the base pivot, or a shelf inside a
      // base that had not resolved (cheat / low cheat / handle).
      const shelf = classifyShelf({ level: entry, basePivot: r.basePivot, baseDepthPct: r.baseDepthPct, price: r.currentPrice });
      return {
        asset: r.asset,
        kind: shelf ? shelf.kind : 'pivot',
        activity: r.activityScore != null ? Number(r.activityScore) : null, // tape activity 0-10 at alert time
        sectorRank: r.sectorRank != null ? Number(r.sectorRank) : null,
        sectorCount: r.sectorCount != null ? Number(r.sectorCount) : null,
        alertedAt: r.lastAlertAt,
        grade: r.baseGrade || null,
        baseWeeks: r.baseBars ? Math.round(Number(r.baseBars) / 5) : null,
        baseDepthPct: r.baseDepthPct != null ? Number(r.baseDepthPct) : null,
        pivot: round2(entry),
        fail: round2(fail),
        current: round2(current),
        asOf: r.latestAt ?? r.createdAt ?? null,
        pct: round1(pct),
        // What the ledger credits: exits at the fail level cap the loss.
        cappedPct: round1(Math.max(failPct, pct)),
        status,
      };
    })
    .filter(Boolean);
}

export function summarize(alerts) {
  const byPct = [...alerts].sort((a, b) => b.pct - a.pct);
  const avg = alerts.length ? alerts.reduce((s, a) => s + a.cappedPct, 0) / alerts.length : 0;
  return {
    count: alerts.length,
    past: alerts.filter((a) => a.status === 'past').length,
    fell: alerts.filter((a) => a.status === 'fell').length,
    below: alerts.filter((a) => a.status === 'below').length,
    avgCappedPct: round1(avg),
    best: byPct[0] || null,
    worst: byPct.length ? byPct[byPct.length - 1] : null,
  };
}

// The seven days ending on `weekEnding` (YYYY-MM-DD, an ET calendar day) —
// the window the Saturday post describes. `todayEt` is the fallback.
export function weekWindow(weekEnding, todayEt) {
  const end = /^\d{4}-\d{2}-\d{2}$/.test(String(weekEnding || '')) ? weekEnding : todayEt;
  const until = new Date(`${end}T23:59:59-04:00`);
  const since = new Date(until.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { weekEnding: end, since, until };
}

// Voice: .claude/skills/dataquant-voice/SKILL.md. Counted three ways, best and
// worst by name, exits at the fail level said once. Returns [main, reply].
export function composeReceipts(ledger, weekEnding) {
  const s = ledger.summary;
  const fmtPct = (v) => `${v >= 0 ? '+' : ''}${Number(v).toFixed(1)}%`;
  const main = [
    `Last week the screen produced ${s.count} breakout${s.count === 1 ? '' : 's'}. ${s.past} ${s.past === 1 ? 'is' : 'are'} still past the pivot and ${s.fell} fell through the fail level.`,
    `Average ${fmtPct(s.avgCappedPct)}, equal weight, exits at the fail level.`,
    s.best && s.best.pct > 0 ? `Best was ${s.best.asset} at ${fmtPct(s.best.pct)}.` : null,
    // Worst is named whenever something is down; skipped only if it is the same
    // single name the Best line just carried.
    s.worst && s.worst.pct < 0 && !(s.best && s.best.pct > 0 && s.worst.asset === s.best.asset)
      ? `Worst was ${s.worst.asset} at ${fmtPct(s.worst.cappedPct)}.` : null,
    `Every one is counted. Screen output for research, not advice.`,
  ].filter((l) => l !== null).join('\n');
  const reply = `Every one of them, with the levels: https://dataquant.ai/pulse?w=${weekEnding}`;
  return [main, reply];
}

// Fold a ticker's scan rows (oldest first) into episodes: one per frozen
// entry, carrying the base as the screen last saw it, whether/when it was
// emailed, whether it fell through its fail level, and the credited result.
// Pure; server.js supplies the rows. Tested in test/ledger.test.mjs.
export function foldEpisodes(rows) {
  const episodes = [];
  // The newest price the screen has for this asset, whatever episode its row
  // landed in. A row written after the last kept episode (a re-segmented base
  // with no entry yet) is filtered out below, and its price went with it — so
  // the open episode showed a stale return (AMD: the card read +7.3% off a
  // 600.91 scan while the header showed 615.53, +9.9%).
  const newest = rows.length ? rows[rows.length - 1] : null;
  // One episode = one frozen entry. The base detector re-segments as price
  // moves (DE: four cards for one $9.11 trade; ZETA: two for one $31.05
  // shelf), so the base pivot is NOT part of the key — the latest base is
  // carried on the episode instead. Rows with no entry group by base pivot.
  const key = (r) => (r.entryPrice != null ? `e:${Number(r.entryPrice).toFixed(2)}` : `p:${r.basePivot ?? 'none'}`);
  for (const r of rows) {
    const last = episodes[episodes.length - 1];
    if (!last || last.key !== key(r)) {
      episodes.push({
        key: key(r),
        firstSeen: r.createdAt, lastSeen: r.createdAt,
        types: new Set([r.breakoutType]),
        grade: r.baseGrade || null, basePivot: r.basePivot, baseBars: r.baseBars, baseDepthPct: r.baseDepthPct,
        entry: r.entryPrice, fail: r.stopLoss, volumeTag: r.volumeTag || null,
        firstPrice: r.currentPrice, lastPrice: r.currentPrice, high: r.currentPrice, low: r.currentPrice,
        alertedAt: null, alertedPrice: null, xPostedAt: null, scans: 0, fellAt: null,
      });
    }
    const ep = episodes[episodes.length - 1];
    ep.lastSeen = r.createdAt;
    ep.types.add(r.breakoutType);
    ep.lastPrice = r.currentPrice;
    ep.high = Math.max(ep.high, r.currentPrice);
    ep.low = Math.min(ep.low, r.currentPrice);
    ep.scans++;
    // The base as the screen last saw it during this episode.
    if (r.basePivot != null) { ep.basePivot = r.basePivot; ep.baseBars = r.baseBars; ep.baseDepthPct = r.baseDepthPct; }
    if (r.baseGrade) ep.grade = r.baseGrade;
    if (r.stopLoss != null && ep.fail == null) ep.fail = r.stopLoss;
    const failNow = ep.fail != null ? Number(ep.fail) : ep.entry != null ? Number(ep.entry) * 0.93 : null;
    if (ep.fellAt == null && failNow != null && r.currentPrice <= failNow) ep.fellAt = r.createdAt;
    // Per-row stamp (current) or legacy asset-wide stamp: credit the alert
    // to the episode that was live when it went out.
    const stamp = r.lastAlertAt || r.alertSentAt;
    if (stamp && stamp >= ep.firstSeen && stamp <= new Date(new Date(ep.lastSeen).getTime() + 24 * 60 * 60 * 1000)) {
      if (!ep.alertedAt || stamp < ep.alertedAt) { ep.alertedAt = stamp; ep.alertedPrice = r.currentPrice; }
    }
    if (r.xPostedAt && r.xPostedAt >= ep.firstSeen) ep.xPostedAt = ep.xPostedAt || r.xPostedAt;
  }
  const out = episodes
    .filter((ep) => ep.entry != null || ep.grade || ep.alertedAt)
    .map((ep) => {
      const entry = ep.entry != null ? Number(ep.entry) : null;
      const fail = ep.fail != null ? Number(ep.fail) : entry != null ? entry * 0.93 : null;
      const pct = entry ? ((ep.lastPrice - entry) / entry) * 100 : null;
      const fellThrough = entry != null && fail != null && ep.low <= fail;
      const status = entry == null ? 'tracking' : fellThrough ? 'fell' : ep.lastPrice > entry ? 'past' : 'below';
      // What the ledger credits: an episode that fell through its fail level
      // ended there, whatever price did afterwards.
      const failPct = entry && fail != null ? ((fail - entry) / entry) * 100 : null;
      const cappedPct = pct == null ? null : fellThrough && failPct != null ? Math.min(pct, failPct) : pct;
      const basePivotNum = ep.basePivot != null ? Number(ep.basePivot) : null;
      const kind = entry == null ? 'tracking'
        : basePivotNum != null && entry < basePivotNum * 0.999 ? 'shelf'
        : 'pivot';
      // A shelf entry says "inside the base" only while that is still true.
      // AMD entered at 559.91 under a 584.73 pivot and cleared it four days
      // later; the label has to move with the price, not freeze at first sight.
      const pivotCleared = basePivotNum != null && Math.max(ep.high, ep.lastPrice) >= basePivotNum;
      return {
        kind,
        pivotCleared,
        fellAt: ep.fellAt,
        cappedPct: cappedPct != null ? Math.round(cappedPct * 10) / 10 : null,
        alertedPrice: ep.alertedPrice,
        firstSeen: ep.firstSeen, lastSeen: ep.lastSeen, scans: ep.scans,
        types: [...ep.types],
        grade: ep.grade, basePivot: ep.basePivot, baseWeeks: ep.baseBars ? Math.round(ep.baseBars / 5) : null, baseDepthPct: ep.baseDepthPct,
        volumeTag: ep.volumeTag,
        entry, fail: fail != null ? Math.round(fail * 100) / 100 : null,
        lastPrice: ep.lastPrice, high: ep.high, low: ep.low,
        pct: pct != null ? Math.round(pct * 10) / 10 : null,
        maxPct: entry ? Math.round(((ep.high - entry) / entry) * 1000) / 10 : null,
        status,
        alertedAt: ep.alertedAt, xPostedAt: ep.xPostedAt,
        // Judged at the start of the episode: was the entry a shelf inside a forming base?
        shelf: classifyShelf({ level: entry, basePivot: ep.basePivot, baseDepthPct: ep.baseDepthPct, price: ep.firstPrice }),
      };
    })
    .reverse();
  // Bring the open episode up to the newest price the asset has.
  const open = out[0];
  if (open && newest && newest.currentPrice != null && new Date(newest.createdAt) > new Date(open.lastSeen)) {
    const px = Number(newest.currentPrice);
    open.lastPrice = px;
    open.asOf = newest.createdAt;
    open.high = Math.max(open.high, px);
    if (open.entry) {
      const fell = open.fail != null && Math.min(open.low, px) <= open.fail;
      const pct = ((px - open.entry) / open.entry) * 100;
      const failPct = open.fail != null ? ((open.fail - open.entry) / open.entry) * 100 : null;
      open.pct = Math.round(pct * 10) / 10;
      open.cappedPct = Math.round((fell && failPct != null ? Math.min(pct, failPct) : pct) * 10) / 10;
      open.maxPct = Math.round(((open.high - open.entry) / open.entry) * 1000) / 10;
      open.status = fell ? 'fell' : px > open.entry ? 'past' : 'below';
    }
    if (open.basePivot != null) open.pivotCleared = Math.max(open.high, px) >= Number(open.basePivot);
  }
  return out;
}

const round2 = (v) => Math.round(v * 100) / 100;
const round1 = (v) => Math.round(v * 10) / 10;
