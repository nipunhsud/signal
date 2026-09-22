// The trade book: the reader's own positions, kept beside the screen that
// found them. Pure arithmetic — no I/O — so every number the page shows is
// tested, and the stats are computed the way the studies compute theirs
// (R multiples, win rate, profit factor on closed trades) so a reader can put
// their own record next to the screen's published ones.
//
// One position = one row. Entry and stop are the reader's, not the screen's:
// what they actually paid and where they actually decided to be wrong.

const round = (v, d = 2) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const DAY = 24 * 60 * 60 * 1000;

/** Days between two dates, floored, never negative. */
export function daysBetween(a, b) {
  if (!a || !b) return null;
  return Math.max(0, Math.floor((new Date(b).getTime() - new Date(a).getTime()) / DAY));
}

/**
 * One position with everything the table shows.
 *   last — the newest price we have; ignored once the trade is closed.
 * R is the move divided by the risk the reader took (entry to stop). It is the
 * unit the exit study reports in, so a book and a study can be compared.
 */
export function gradePosition(t, last = null, now = new Date()) {
  const entry = Number(t.entry);
  const stop = t.stop != null ? Number(t.stop) : null;
  const closed = t.status === 'closed' && t.exit != null;
  const price = closed ? Number(t.exit) : last != null ? Number(last) : null;
  const risk = stop != null && stop < entry ? entry - stop : null;
  const pct = price != null && entry > 0 ? ((price - entry) / entry) * 100 : null;
  const r = price != null && risk ? (price - entry) / risk : null;
  const shares = t.shares != null ? Number(t.shares) : null;
  return {
    ...t,
    entry: round(entry),
    stop: round(stop),
    exit: t.exit != null ? round(Number(t.exit)) : null,
    last: price != null ? round(price) : null,
    closed,
    pct: round(pct, 1),
    r: round(r, 2),
    days: daysBetween(t.openedAt, closed ? t.closedAt : now),
    // What is still at stake, and what it would cost to be wrong from here.
    value: price != null && shares ? round(price * shares) : null,
    openRisk: !closed && price != null && stop != null && shares ? round((price - stop) * shares) : null,
    riskAtEntry: risk && shares ? round(risk * shares) : null,
    belowStop: !closed && stop != null && price != null && price <= stop,
    noStop: stop == null,
  };
}

/** Closed-trade stats, in the same shapes the studies report. */
export function bookStats(positions) {
  const closed = positions.filter((p) => p.closed && p.r != null);
  const n = closed.length;
  if (!n) return { closed: 0, wins: 0, winRate: null, avgR: null, profitFactor: null, best: null, worst: null, avgDays: null, expectancyR: null };
  const wins = closed.filter((p) => p.r > 0);
  const gains = wins.reduce((s, p) => s + p.r, 0);
  const losses = closed.filter((p) => p.r <= 0).reduce((s, p) => s - p.r, 0);
  const byR = [...closed].sort((a, b) => b.r - a.r);
  return {
    closed: n,
    wins: wins.length,
    winRate: round((wins.length / n) * 100, 1),
    avgR: round(closed.reduce((s, p) => s + p.r, 0) / n, 2),
    expectancyR: round(closed.reduce((s, p) => s + p.r, 0) / n, 2),
    profitFactor: losses > 0 ? round(gains / losses, 2) : gains > 0 ? 99 : null,
    best: byR[0] ? { asset: byR[0].asset, r: byR[0].r, pct: byR[0].pct } : null,
    worst: byR[n - 1] ? { asset: byR[n - 1].asset, r: byR[n - 1].r, pct: byR[n - 1].pct } : null,
    avgDays: round(closed.reduce((s, p) => s + (p.days || 0), 0) / n, 0),
  };
}

/** The seven days ending on `end` (a Date), as the running list uses them. */
export function weekWindowOf(end = new Date()) {
  const until = new Date(end);
  const since = new Date(until.getTime() - 7 * DAY);
  return { since, until };
}

/**
 * The running list: what changed in the window, and what is asking for
 * attention. This is the part meant to be looked at daily, so it holds only
 * things a reader can act on, and says plainly when there is nothing.
 */
export function runningList(positions, { since, until } = weekWindowOf(), alertsThisWeek = []) {
  const inWin = (d) => d && new Date(d) >= since && new Date(d) <= until;
  const opened = positions.filter((p) => inWin(p.openedAt));
  const closedInWin = positions.filter((p) => p.closed && inWin(p.closedAt));
  const open = positions.filter((p) => !p.closed);
  const realisedR = closedInWin.reduce((s, p) => s + (p.r || 0), 0);
  const held = positions.map((p) => p.asset.toUpperCase());
  const notLogged = [...new Set(alertsThisWeek.map((a) => String(a).toUpperCase()))].filter((a) => !held.includes(a));
  const attention = [
    ...open.filter((p) => p.belowStop).map((p) => ({ asset: p.asset, why: 'below its stop', detail: `${p.last} against a ${p.stop} stop` })),
    ...open.filter((p) => p.noStop).map((p) => ({ asset: p.asset, why: 'no stop set', detail: 'nothing says where this one is wrong' })),
    ...open.filter((p) => !p.belowStop && !p.noStop && p.r != null && p.r >= 3).map((p) => ({ asset: p.asset, why: `up ${p.r}R`, detail: 'the exit study trails 20% from the peak on a run like this' })),
  ];
  return {
    since, until,
    openCount: open.length,
    openedThisWeek: opened.map((p) => ({ asset: p.asset, openedAt: p.openedAt, entry: p.entry })),
    closedThisWeek: closedInWin.map((p) => ({ asset: p.asset, closedAt: p.closedAt, r: p.r, pct: p.pct })),
    realisedR: round(realisedR, 2),
    attention,
    // Names the screen emailed this week that are not in the book, so the
    // running list is a prompt rather than a record of what was already done.
    notLogged: notLogged.slice(0, 12),
    lastUpdated: positions.reduce((m, p) => {
      const t = new Date(p.updatedAt || p.openedAt).getTime();
      return Number.isFinite(t) && t > m ? t : m;
    }, 0) || null,
  };
}

/** Validate and normalise a write. Returns { value } or { error }. */
export function parseTrade(body, { partial = false } = {}) {
  const out = {};
  const num = (v) => (v === '' || v == null ? null : Number(v));
  if (!partial) {
    const asset = String(body?.asset || '').toUpperCase().trim();
    if (!/^[A-Z][A-Z0-9.\-]{0,11}$/.test(asset)) return { error: 'a ticker is required' };
    out.asset = asset;
    const entry = num(body?.entry);
    if (!Number.isFinite(entry) || entry <= 0) return { error: 'an entry price is required' };
    out.entry = entry;
    out.openedAt = body?.openedAt ? new Date(body.openedAt) : new Date();
    if (Number.isNaN(out.openedAt.getTime())) return { error: 'the opened date is not a date' };
  }
  for (const [k, v] of Object.entries({ stop: num(body?.stop), shares: num(body?.shares), target: num(body?.target) })) {
    if (v === undefined) continue;
    if (v !== null && (!Number.isFinite(v) || v < 0)) return { error: `${k} must be a positive number` };
    if (k in body) out[k] = v;
  }
  if ('note' in body) out.note = body.note == null ? null : String(body.note).slice(0, 2000);
  if ('exit' in body || 'closedAt' in body) {
    const exit = num(body?.exit);
    if (exit != null) {
      if (!Number.isFinite(exit) || exit <= 0) return { error: 'the exit price is not a price' };
      out.exit = exit;
      out.closedAt = body?.closedAt ? new Date(body.closedAt) : new Date();
      if (Number.isNaN(out.closedAt.getTime())) return { error: 'the closed date is not a date' };
      out.status = 'closed';
    } else {
      out.exit = null; out.closedAt = null; out.status = 'open'; // reopen
    }
  }
  for (const k of ['signalGrade', 'signalKind', 'signalPivot']) {
    if (k in body) out[k] = k === 'signalPivot' ? num(body[k]) : body[k] == null ? null : String(body[k]).slice(0, 24);
  }
  if (!partial && out.stop != null && out.stop >= out.entry) return { error: 'the stop has to sit below the entry' };
  return { value: out };
}
