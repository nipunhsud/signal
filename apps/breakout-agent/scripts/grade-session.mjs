// Grade today's breakouts 1-10. Every weight is anchored to a measured profit
// factor from this repo's own studies, not to taste. Score is the sum of each
// factor's PF lift over the cohort baseline (1.71-1.80 depending on the study),
// rescaled to 1-10 across the possible range.
import { PrismaClient } from '@prisma/client';
import { holdOdds } from '/Users/nipunsud/github/signal/apps/breakout-agent/hold-odds.js';
import { activityOdds } from '/Users/nipunsud/github/signal/apps/breakout-agent/activity.js';
const db = new PrismaClient();

const rows = await db.$queryRawUnsafe(`
  WITH r AS (SELECT *, row_number() OVER (PARTITION BY asset ORDER BY "createdAt" DESC) rn
             FROM "BreakoutSignal" WHERE "createdAt"::date = '2026-09-29')
  SELECT r.asset, r."assetType", r."currentPrice", r."basePivot", r."entryPrice", r."stopLoss",
         r."baseGrade", r."baseBars", r."baseDepthPct", r."isBlueSky", r."deepBase",
         r."rsRating", r."activityScore", r."volumeRatio", r."sectorRank", r."sectorCount",
         r.sector, r."shouldAlert", r.ep, r."isReclaim", r."isStaircase",
         io.holders, io."holdersPrior"
  FROM r LEFT JOIN "InstitutionalOwnership" io
    ON io.asset = r.asset AND io.period = (SELECT max(period) FROM "InstitutionalOwnership")
  WHERE r.rn = 1 AND r."basePivot" IS NOT NULL AND r."currentPrice" >= r."basePivot"
`).catch(async () => db.$queryRawUnsafe(`
  WITH r AS (SELECT *, row_number() OVER (PARTITION BY asset ORDER BY "createdAt" DESC) rn
             FROM "BreakoutSignal" WHERE "createdAt"::date = '2026-09-29')
  SELECT r.asset, r."assetType", r."currentPrice", r."basePivot", r."entryPrice", r."stopLoss",
         r."baseGrade", r."baseBars", r."baseDepthPct", r."isBlueSky", r."deepBase",
         r."rsRating", r."activityScore", r."volumeRatio", r."sectorRank", r."sectorCount",
         r.sector, r."shouldAlert", r."isReclaim", r."isStaircase",
         io.holders, io."holdersPrior"
  FROM r LEFT JOIN "InstitutionalOwnership" io
    ON io.asset = r.asset AND io.period = (SELECT max(period) FROM "InstitutionalOwnership")
  WHERE r.rn = 1 AND r."basePivot" IS NOT NULL AND r."currentPrice" >= r."basePivot"
`));

const num = (v) => (v == null ? null : Number(v));

// The scanner writes a row every 15 minutes and the tiers finish at different
// times, so the newest row for a name can be from 11am — an hour of volume in
// it and a midday price. Grading off that scores half the board on a partial
// session. Today's settled bar comes from the same daily source the charts use.
async function todaysBar(symbol) {
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=3mo`;
  const res = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) return null;
  const j = await res.json();
  const r = j?.chart?.result?.[0];
  if (!r?.timestamp) return null;
  const q = r.indicators.quote[0];
  const bars = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    if (q.close[i] == null || q.volume[i] == null) continue;
    bars.push({ d: new Date(r.timestamp[i] * 1000).toISOString().slice(0, 10), c: q.close[i], v: q.volume[i] });
  }
  if (bars.length < 21) return null;
  const last = bars[bars.length - 1];
  const prior = bars.slice(-21, -1);
  const av = prior.reduce((t, b) => t + b.v, 0) / prior.length;
  return { date: last.d, close: last.c, volume: last.v, volumeRatio: av > 0 ? last.v / av : null };
}
const fresh = new Map();
for (let i = 0; i < rows.length; i += 6) {
  const chunk = rows.slice(i, i + 6);
  const got = await Promise.all(chunk.map((r) => todaysBar(r.asset).catch(() => null)));
  chunk.forEach((r, k) => { if (got[k]) fresh.set(r.asset, got[k]); });
}
const asOf = [...fresh.values()][0]?.date;
console.log(`refreshed ${fresh.size}/${rows.length} names from the ${asOf} close\n`);

const scored = rows.map((r0) => {
  const f = fresh.get(r0.asset);
  if (!f) return null;
  const r = { ...r0, currentPrice: f.close, volumeRatio: f.volumeRatio };
  const why = [];
  let pf = 0; // total measured lift

  // RS — the strongest single lever (minervini-rules-study: 1.75 -> 2.42)
  const rs = num(r.rsRating);
  if (rs != null) {
    const lift = rs >= 95 ? 0.62 : rs >= 89 ? 0.45 : rs >= 80 ? 0.25 : rs >= 60 ? 0.05 : -0.25;
    pf += lift;
    why.push(`RS ${rs}${rs >= 89 ? '' : ' (under the 89 alert line)'}`);
  } else { pf -= 0.25; why.push('no RS'); }

  // Base grade — hit-rate lever (S 62.6% positive / 11.6% fail touch, A 54.8% / 32.1%)
  const g = r.baseGrade;
  const gl = g === 'S' ? 0.55 : g === 'A+' ? 0.30 : g === 'A' ? 0.12 : g === 'X' ? -0.40 : -0.30;
  pf += gl;
  why.push(g ? `grade ${g}` : 'ungraded base');

  // Activity from the tape — size-of-winner (institutional-activity-study 1.77 -> 2.41)
  const act = num(r.activityScore);
  if (act != null) {
    const o = activityOdds(act);
    pf += (o.pf - 1.77) * 0.55; // discounted: it moves reach far more than win rate
    why.push(`activity ${act}/10`);
  }

  // Clearance x volume — what a clear of this size on this volume did (hold-odds)
  const clr = r.basePivot > 0 ? ((num(r.currentPrice) - num(r.basePivot)) / num(r.basePivot)) * 100 : null;
  const h = holdOdds(clr, num(r.volumeRatio));
  if (h) { pf += (h.pf - 1.80) * 0.5; why.push(`${clr.toFixed(1)}% past the pivot on ${num(r.volumeRatio)?.toFixed(1)}x volume — ${h.likeliest} ${h.pct}%`); }

  // Blue sky is already inside the grade; only the absence is informative here.
  if (r.isBlueSky === false && g) { pf -= 0.12; why.push('not blue sky'); }

  // Episodic pivot — a base built on a repricing day (2.25 vs 1.84)
  if (r.ep) { pf += 0.41; why.push('built on an episodic pivot'); }

  // Deep base — different bet: bigger winners, more failures
  if (r.deepBase) { pf += 0.20; why.push(`deep base ${num(r.baseDepthPct)?.toFixed(0)}%`); }

  // Register turnover — size-of-winner (institutional-ownership-study 2.27 vs 1.65)
  const hp = num(r.holdersPrior), hn = num(r.holders);
  if (hp != null && hp >= 50 && hn != null) {
    const churn = Math.abs((hn - hp) / hp) * 100;
    if (churn >= 20) { pf += 0.31; why.push(`register turned over ${churn.toFixed(0)}%`); }
  }

  // Extension — past 5% the published numbers no longer describe the entry
  if (clr != null && clr > 5) { pf -= 0.35; why.push(`extended ${clr.toFixed(0)}% past the pivot`); }

  // Base length: nothing measured below ~2 weeks, and short bases score worse
  const wk = num(r.baseBars) != null ? num(r.baseBars) / 5 : null;
  if (wk != null && wk < 2) { pf -= 0.20; why.push(`${wk.toFixed(1)}wk base, short`); }
  else if (wk != null) why.push(`${wk.toFixed(0)}wk base`);

  // Map total lift to 1-10. Range seen in practice is about -1.2 .. +2.2.
  const score = Math.max(1, Math.min(10, Math.round(((pf + 1.2) / 3.4) * 9 + 1)));
  return { ...r, rs, act, clr, score, pf, why, wk };
}).filter(Boolean).sort((a, b) => b.pf - a.pf);

console.log(`${scored.length} breakouts cleared a pivot in today's session (2026-09-29)\n`);
console.log('  #  ticker  score  RS  act  grade  clear%  vol   base   sector');
for (const s of scored) {
  console.log(`  ${String(scored.indexOf(s) + 1).padStart(2)}  ${s.asset.padEnd(6)}  ${String(s.score).padStart(4)}  ${String(s.rs ?? '—').padStart(3)}  ${String(s.act ?? '—').padStart(3)}  ${String(s.baseGrade ?? '—').padEnd(5)}  ${s.clr != null ? s.clr.toFixed(1).padStart(6) : '     —'}  ${num(s.volumeRatio)?.toFixed(1).padStart(4) ?? '   —'}  ${s.wk != null ? (s.wk.toFixed(0) + 'wk').padStart(5) : '    —'}  ${(s.sector || '—').slice(0, 22)}`);
}
console.log('\n── the top of the list, and what each score rests on');
for (const s of scored.slice(0, 8)) console.log(`  ${s.asset} ${s.score}/10 — ${s.why.join('; ')}`);
console.log('\n── the bottom');
for (const s of scored.slice(-5)) console.log(`  ${s.asset} ${s.score}/10 — ${s.why.join('; ')}`);
await db.$disconnect();
