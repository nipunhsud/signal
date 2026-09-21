// Does the market health gauge predict how graded breakouts go? Replays the
// gauge (server.js computeMarketHealth) over history from the cache — trend
// on SPY+QQQ (or ^GSPC+^IXIC before the ETFs exist), O'Neil distribution days
// over 25 sessions, breadth as the share of the scanned universe up on the
// month and the week — then joins it to every graded breakout in
// accumulation-rows.json by date. Prints outcomes by regime and by component,
// and the gauge by month for the last two years.
import fs from 'fs';
const CACHE = './study-cache';
const load = (sym) => JSON.parse(fs.readFileSync(`${CACHE}/${sym}.json`, 'utf8')).filter((r) => Array.isArray(r) && r.length >= 6 && r[4] > 0);
const dayOf = (ts) => Math.floor(ts / 86400);
const dateOf = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);

// ── benchmark gauges ──────────────────────────────────────────────────────────
function gaugeSeries(sym) {
  const a = load(sym); const out = new Map();
  let s50 = 0, s200 = 0;
  const c = (k) => a[k][4];
  for (let i = 0; i < a.length; i++) {
    s50 += c(i); if (i >= 50) s50 -= c(i - 50);
    s200 += c(i); if (i >= 200) s200 -= c(i - 200);
    if (i < 210) continue;
    const ma50 = s50 / 50, ma200 = s200 / 200;
    let prev = 0; for (let k = i - 59; k <= i - 10; k++) prev += c(k); prev /= 50; // avg(closes.slice(-60,-10))
    const ma50Rising = ma50 > prev;
    let trend = 0; if (c(i) > ma50) trend += 25; if (c(i) > ma200) trend += 15; if (ma50Rising) trend += 10;
    const win = a.slice(i - 25, i + 1);
    const hasVolume = win.filter((b) => (b[5] || 0) > 0).length > 20;
    let dd = 0;
    for (let k = 1; k < win.length; k++) {
      const downEnough = win[k][4] <= win[k - 1][4] * 0.998;
      if (hasVolume) { if (downEnough && (win[k][5] || 0) > (win[k - 1][5] || 0)) dd++; }
      else if (win[k][4] <= win[k - 1][4] * 0.99) dd++;
    }
    out.set(dayOf(a[i][0]), { trend, dd, hasVolume });
  }
  return out;
}
const have = (s) => fs.existsSync(`${CACHE}/${s}.json`);
const spy = have('SPY') ? gaugeSeries('SPY') : new Map(), qqq = have('QQQ') ? gaugeSeries('QQQ') : new Map();
const gspc = have('^GSPC') ? gaugeSeries('^GSPC') : new Map(), ixic = have('^IXIC') ? gaugeSeries('^IXIC') : new Map();

// ── breadth per day: % of universe up on the month / week ─────────────────────
const files = fs.readdirSync(CACHE).filter((f) => f.endsWith('.json') && !f.startsWith('^') && !['SPY', 'QQQ'].includes(f.slice(0, -5)) && !/^(grade|minervini|accumulation)-/.test(f));
const br = new Map(); // day -> { n, m, w }
let done = 0;
for (const f of files) {
  let a; try { a = load(f.slice(0, -5)); } catch { continue; }
  if (a.length < 300) continue;
  for (let i = 21; i < a.length; i++) {
    if (a[i][0] < Date.UTC(1985, 0, 1) / 1000) continue;
    const d = dayOf(a[i][0]);
    let b = br.get(d); if (!b) { b = { n: 0, m: 0, w: 0 }; br.set(d, b); }
    b.n++; if (a[i][4] > a[i - 21][4]) b.m++; if (a[i][4] > a[i - 5][4]) b.w++;
  }
  if (++done % 1000 === 0) console.log(`breadth ${done}/${files.length}`);
}

// ── the gauge on a day ───────────────────────────────────────────────────────
function gaugeOn(day) {
  const g1 = spy.get(day) || gspc.get(day), g2 = qqq.get(day) || ixic.get(day);
  const gs = [g1, g2].filter(Boolean);
  if (!gs.length) return null;
  const trend = Math.round(gs.reduce((s, g) => s + g.trend, 0) / gs.length);
  const dd = Math.max(...gs.map((g) => g.dd));
  const distScore = Math.max(0, 25 - dd * 5);
  const b = br.get(day);
  const mPct = b && b.n >= 50 ? Math.round((b.m / b.n) * 100) : null;
  const wPct = b && b.n >= 50 ? Math.round((b.w / b.n) * 100) : null;
  const breadth = mPct != null ? Math.round((mPct / 100) * 15) + Math.round(((wPct ?? mPct) / 100) * 10) : 12;
  const score = trend + distScore + breadth;
  return { score, trend, dd, distScore, breadth, mPct, wPct, regime: score >= 70 ? 'risk-on' : score >= 45 ? 'caution' : 'risk-off' };
}

// ── join to graded breakouts ─────────────────────────────────────────────────
const rows = JSON.parse(fs.readFileSync(`${CACHE}/accumulation-rows.json`, 'utf8'));
let joined = 0;
for (const r of rows) r.score = (() => { let p = 0; const net = r.net; p += net >= 5 ? 3 : net >= 3 ? 2 : net >= 1 ? 1 : 0; p += r.bigUp >= 3 ? 3 : r.bigUp >= 2 ? 2 : r.bigUp >= 1 ? 1 : 0; p += r.udv >= 2 ? 2 : r.udv >= 1.5 ? 1 : 0; p += r.obv >= 0.2 ? 2 : r.obv >= 0.05 ? 1 : 0; return p; })();
for (const r of rows) {
  const g = gaugeOn(dayOf(Date.parse(r.date + 'T00:00:00Z') / 1000));
  if (g) { r.mh = g; joined++; }
}
console.log(`\nrows=${rows.length} joined=${joined}`);
const agg = (rs) => {
  const n = rs.length; if (!n) return 'n=0';
  const w = rs.filter((r) => r.ret20 > 0).length, s = rs.filter((r) => r.stopped).length;
  const m = (k) => rs.reduce((a, r) => a + r[k], 0) / n;
  const hit20 = rs.filter((r) => r.run60 >= 20).length;
  const pf = (() => { let g = 0, l = 0; for (const r of rs) { const v = Math.max(r.ret20, -7); if (v > 0) g += v; else l -= v; } return l ? g / l : 99; })();
  return `n=${String(n).padStart(6)} win=${(w / n * 100).toFixed(1)}% stop=${(s / n * 100).toFixed(1)}% mean20=${m('ret20').toFixed(2)}% mean60=${m('ret60').toFixed(2)}% hit+20%=${(hit20 / n * 100).toFixed(1)}% PF=${pf.toFixed(2)}`;
};
const line = (label, rs) => console.log(label.padEnd(34), agg(rs));
const J = rows.filter((r) => r.mh);
line('ALL joined', J);
console.log('\n=== Regime on the breakout day ===');
for (const reg of ['risk-on', 'caution', 'risk-off']) line(reg, J.filter((r) => r.mh.regime === reg));
console.log('\n=== Score bands ===');
for (const [lo, hi] of [[0, 34], [35, 44], [45, 54], [55, 64], [65, 74], [75, 84], [85, 100]]) line(`score ${lo}-${hi}`, J.filter((r) => r.mh.score >= lo && r.mh.score <= hi));
console.log('\n=== Trend component (0-50) ===');
for (const t of [0, 10, 15, 25, 35, 40, 50]) line(`trend ${t}`, J.filter((r) => r.mh.trend === t));
console.log('\n=== Distribution days (max of the two benchmarks) ===');
for (const [lo, hi] of [[0, 1], [2, 3], [4, 5], [6, 8], [9, 25]]) line(`dist days ${lo}-${hi}`, J.filter((r) => r.mh.dd >= lo && r.mh.dd <= hi));
console.log('\n=== Breadth: % of universe up on the month ===');
for (const [lo, hi] of [[0, 39], [40, 49], [50, 59], [60, 69], [70, 100]]) line(`breadth 1m ${lo}-${hi}%`, J.filter((r) => r.mh.mPct != null && r.mh.mPct >= lo && r.mh.mPct <= hi));
console.log('\n=== Per decade: risk-on vs risk-off ===');
for (let d = 1980; d <= 2020; d += 10) {
  const inD = J.filter((r) => r.year >= d && r.year < d + 10);
  line(`${d}s risk-on`, inD.filter((r) => r.mh.regime === 'risk-on')); line(`${d}s caution`, inD.filter((r) => r.mh.regime === 'caution')); line(`${d}s risk-off`, inD.filter((r) => r.mh.regime === 'risk-off'));
}
console.log('\n=== Regime × activity score 5+ ===');
for (const reg of ['risk-on', 'caution', 'risk-off']) { line(`${reg} · score 5+`, J.filter((r) => r.mh.regime === reg && r.score >= 5)); line(`${reg} · score 0-2`, J.filter((r) => r.mh.regime === reg && r.score <= 2)); }

// ── the gauge by month, last 2 years, plus breakouts per month and their outcome
console.log('\n=== Gauge by month (mean of daily scores; last 2 years) ===');
const byMonth = new Map();
const base = spy.size ? spy : gspc;
for (const day of base.keys()) {
  const g = gaugeOn(day); if (!g) continue;
  const date = new Date(day * 86400 * 1000).toISOString().slice(0, 7);
  if (date < '2024-09') continue;
  let m = byMonth.get(date); if (!m) { m = { n: 0, s: 0, t: 0, dd: 0, b: 0 }; byMonth.set(date, m); }
  m.n++; m.s += g.score; m.t += g.trend; m.dd += g.dd; m.b += g.breadth;
}
for (const [mo, m] of [...byMonth.entries()].sort()) {
  const bo = rows.filter((r) => r.date.startsWith(mo));
  const w = bo.length ? (bo.filter((r) => r.ret20 > 0).length / bo.length * 100).toFixed(0) + '%' : '—';
  console.log(`${mo}  score ${(m.s / m.n).toFixed(0).padStart(3)}  trend ${(m.t / m.n).toFixed(0).padStart(2)}  distDays ${(m.dd / m.n).toFixed(1).padStart(4)}  breadth ${(m.b / m.n).toFixed(0).padStart(2)}  | graded breakouts ${String(bo.length).padStart(4)}  win20 ${w}`);
}
