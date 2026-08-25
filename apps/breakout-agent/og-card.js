// Renders a 1200×630 "summary_large_image" scorecard PNG for X/OG link previews.
// Hand-rolled SVG → PNG via resvg (no headless browser). Uses only fields we
// actually store on BreakoutSignal — no fabricated fundamentals grades.
// ponytail: real-fields card; fundamentals-grid upgrade deferred (see memory).
import { Resvg } from '@resvg/resvg-js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fontBuffers = [
  fs.readFileSync(path.join(__dirname, 'assets', 'Inter-Regular.ttf')),
  fs.readFileSync(path.join(__dirname, 'assets', 'Inter-Bold.ttf')),
];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => (v == null ? null : Number(v));
const isIndia = (a) => /\.(NS|BO)$/i.test(a || '');
const cur = (a) => (isIndia(a) ? '₹' : '$');
const money = (a, v) => (v == null || !Number.isFinite(v) ? '—' : cur(a) + v.toFixed(2));
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

// Human-facing summary strings, shared by the image and the meta tags.
export function cardFields(s) {
  const price = num(s.currentPrice);
  const entry = num(s.entryPrice);
  const stop = num(s.stopLoss);
  const conf = s.confidence != null ? Math.round(Number(s.confidence)) : null;
  const type = s.breakoutType === 'Type3' ? 'Extension' : 'Actionable breakout';
  const epsG = num(s.epsGrowthPct);
  const epsS = num(s.epsSurprisePct);
  const guidance = s.earningsGuidance && s.earningsGuidance !== 'none' ? cap(s.earningsGuidance) : null;
  const tone = s.earningsTone ? cap(s.earningsTone) : null;
  const earnings = tone ? tone + (guidance ? ` · ${guidance}` : '') : null;
  return {
    asset: s.asset, price, entry, stop, conf, type,
    epsG, epsS, earnings,
    sector: s.sector || null,
    priceStr: money(s.asset, price),
    entryStr: money(s.asset, entry),
    stopStr: money(s.asset, stop),
    epsGStr: epsG == null ? '—' : `${epsG >= 0 ? '+' : ''}${epsG.toFixed(0)}%`,
    epsSStr: epsS == null ? '—' : `${epsS >= 0 ? '+' : ''}${epsS.toFixed(0)}%`,
  };
}

export function metaFor(s, imageUrl, pageUrl) {
  const f = cardFields(s);
  const title = `$${f.asset} — ${f.conf != null ? `${f.conf}/100 · ` : ''}${f.type}`;
  const bits = [`Entry ${f.entryStr}`, `Stop ${f.stopStr} (-8%)`];
  if (f.epsG != null) bits.push(`EPS ${f.epsGStr}`);
  if (f.earnings) bits.push(f.earnings);
  const description = bits.join(' · ') + ' · dataquant.ai · Not advice';
  return { title, description, imageUrl, pageUrl };
}

// Minimal HTML shell for crawlers: OG + Twitter card tags, nothing else needed.
export function metaHtml(meta) {
  return `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(meta.title)}</title>
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(meta.title)}">
<meta name="twitter:description" content="${esc(meta.description)}">
<meta name="twitter:image" content="${esc(meta.imageUrl)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(meta.title)}">
<meta property="og:description" content="${esc(meta.description)}">
<meta property="og:image" content="${esc(meta.imageUrl)}">
<meta property="og:url" content="${esc(meta.pageUrl)}">
</head><body></body></html>`;
}

// Colors — dark-native, high contrast so they survive Twitter's JPEG pass.
const C = { bg: '#0F1419', card: '#15202B', text: '#E7E9EA', dim: '#71767B',
  green: '#22C55E', red: '#EF4444', accent: '#EAB308', line: '#2F3336' };

const confColor = (c) => (c == null ? C.dim : c >= 90 ? C.green : c >= 80 ? C.accent : C.dim);

function svg(s) {
  const f = cardFields(s);
  const T = (x, y, str, { size = 32, weight = 400, fill = C.text, anchor = 'start' } = {}) =>
    `<text x="${x}" y="${y}" font-family="Inter" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(str)}</text>`;

  // Left column rows (label, value, valueColor)
  const rows = [
    ['Entry', f.entryStr, C.text],
    ['Stop (-8%)', f.stopStr, C.red],
    ['Setup', f.type, C.text],
  ];
  const rows2 = [
    ['EPS growth', f.epsGStr, f.epsG >= 0 ? C.green : C.red],
    ['EPS surprise', f.epsSStr, f.epsS >= 0 ? C.green : C.red],
    ['Earnings', f.earnings || '—', C.text],
  ];
  const rowSvg = (list, x) => list.map(([label, val, color], i) => {
    const y = 300 + i * 84;
    return T(x, y, label, { size: 26, fill: C.dim }) + T(x, y + 40, val, { size: 40, weight: 700, fill: color });
  }).join('');

  return `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="${C.bg}"/>
  <rect x="40" y="40" width="1120" height="550" rx="24" fill="${C.card}"/>
  <!-- header -->
  ${T(80, 150, '$' + f.asset, { size: 84, weight: 700 })}
  ${T(80, 200, f.sector || '', { size: 30, fill: C.dim })}
  ${T(1120, 140, f.priceStr, { size: 64, weight: 700, anchor: 'end' })}
  ${T(1120, 195, f.conf != null ? `Confidence ${f.conf}/100` : '', { size: 32, weight: 700, fill: confColor(f.conf), anchor: 'end' })}
  <line x1="80" y1="240" x2="1120" y2="240" stroke="${C.line}" stroke-width="2"/>
  <!-- two columns -->
  ${rowSvg(rows, 80)}
  ${rowSvg(rows2, 640)}
  <!-- footer -->
  <line x1="80" y1="548" x2="1120" y2="548" stroke="${C.line}" stroke-width="2"/>
  ${T(80, 578, 'dataquant.ai', { size: 26, weight: 700, fill: C.accent })}
  ${T(1120, 578, 'data: FMP · Not advice', { size: 24, fill: C.dim, anchor: 'end' })}
</svg>`;
}

// Market-health card for the /pulse share link: today's regime front and
// center, the three components underneath. Same hand-rolled SVG approach.
function healthSvg(mh) {
  const C = { bg: '#0F172A', card: '#111827', line: '#334155', dim: '#94A3B8', fg: '#F8FAFC', accent: '#F59E0B' };
  const regimeColor = mh.regime === 'risk-on' ? '#34D399' : mh.regime === 'caution' ? '#FBBF24' : '#F87171';
  const label = mh.regime === 'risk-on' ? 'RISK-ON' : mh.regime === 'caution' ? 'CAUTION' : 'RISK-OFF';
  const c = mh.components || {};
  const dd = c.distribution?.days ?? 0;
  const ddPer = c.distribution?.perBenchmark
    ? Object.entries(c.distribution.perBenchmark).map(([b, d]) => `${esc(b)} ${d}`).join(' · ')
    : '';
  const br1m = c.breadth?.pctPositive1m;
  const br1w = c.breadth?.pctPositive1w;
  const T = (x, y, text, { size = 32, weight = 400, fill = C.fg, anchor = 'start' } = {}) =>
    text ? `<text x="${x}" y="${y}" font-family="Inter" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(text)}</text>` : '';
  const compCol = (x, title, value, sub, valueFill = C.fg) =>
    T(x, 300, title, { size: 24, fill: C.dim }) +
    T(x, 356, value, { size: 42, weight: 700, fill: valueFill }) +
    T(x, 398, sub, { size: 22, fill: C.dim });
  return `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="${C.bg}"/>
  <rect x="40" y="40" width="1120" height="550" rx="24" fill="${C.card}"/>
  ${T(80, 130, 'Market Health', { size: 44, weight: 700 })}
  ${T(80, 172, `${mh.region === 'IN' ? 'India · ' + mh.benchmark : 'US · ' + mh.benchmark} · ${mh.asOf}`, { size: 26, fill: C.dim })}
  ${T(1120, 150, `${mh.score}`, { size: 96, weight: 700, fill: regimeColor, anchor: 'end' })}
  ${T(1120, 190, label, { size: 34, weight: 700, fill: regimeColor, anchor: 'end' })}
  <line x1="80" y1="225" x2="1120" y2="225" stroke="${C.line}" stroke-width="2"/>
  ${compCol(80, 'TREND', `${c.trend?.score ?? '—'} / 50`, c.trend?.aboveMA50 ? 'above the 50-day' : 'below the 50-day', (c.trend?.score ?? 0) >= 35 ? '#34D399' : '#FBBF24')}
  ${compCol(440, 'DISTRIBUTION DAYS', `${dd} / 25 sessions`, ddPer || 'selling on rising volume', dd >= 4 ? '#F87171' : '#34D399')}
  ${compCol(800, 'BREADTH', br1m != null ? `${br1m}% 1m${br1w != null ? ` · ${br1w}% 1w` : ''}` : 'populating', `${c.breadth?.universe ?? 0} stocks positive share`, (br1m ?? 50) >= 55 ? '#34D399' : '#FBBF24')}
  ${T(80, 490, mh.advice, { size: 27, fill: C.fg })}
  <line x1="80" y1="548" x2="1120" y2="548" stroke="${C.line}" stroke-width="2"/>
  ${T(80, 578, 'dataquant.ai/pulse', { size: 26, weight: 700, fill: C.accent })}
  ${T(1120, 578, 'Updated every 15 min · Not advice', { size: 24, fill: C.dim, anchor: 'end' })}
</svg>`;
}

export function renderMarketHealthPng(mh) {
  const r = new Resvg(healthSvg(mh), {
    fitTo: { mode: 'width', value: 1200 },
    font: { fontBuffers, defaultFontFamily: 'Inter', loadSystemFonts: false },
  });
  return r.render().asPng();
}

export function renderScorecardPng(s) {
  const r = new Resvg(svg(s), {
    fitTo: { mode: 'width', value: 1200 },
    font: { fontBuffers, defaultFontFamily: 'Inter', loadSystemFonts: false },
  });
  return r.render().asPng();
}
