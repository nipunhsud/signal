// The alert ledger: ONE population for every public number. An "alert" is a
// breakout the screen emailed (graded base, close above the pivot — the
// shouldAlert gate in src/agent.ts). The Saturday receipts post, /pulse?w=,
// /api/alerts, the Backtest tab and the monthly X audit all count this set,
// so the tweet, the page and the inbox always agree.
//
// Pure functions of rows — no I/O — so the grading and the wording are
// testable without a database (test/ledger.test.mjs). server.js does the SQL.

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
      return {
        asset: r.asset,
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

const round2 = (v) => Math.round(v * 100) / 100;
const round1 = (v) => Math.round(v * 10) / 10;
