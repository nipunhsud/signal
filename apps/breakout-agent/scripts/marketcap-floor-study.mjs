// Is the $300M market-cap floor earning its place?
//
// Market cap cannot be reconstructed from a price cache — it needs shares
// outstanding, which we do not store historically. So this is a limited test,
// and its limits matter:
//
//   * Caps come from Nasdaq's current screener and are applied backwards, so
//     only recent breakouts are usable. Everything here is 2025 onward.
//   * A company that has since delisted carries no cap and drops out, which
//     biases the small-cap buckets toward survivors — the exact direction that
//     would make a low floor look better than it is.
//
// Read it as "does the floor look wrong enough to revisit", not as proof.
import fs from 'fs';

const CACHE = './study-cache';
const rows = JSON.parse(fs.readFileSync(`${CACHE}/liquidity-rows.json`, 'utf8'));
const nq = JSON.parse(fs.readFileSync('/tmp/nq.json', 'utf8'));
const listings = nq?.data?.rows || nq?.data?.table?.rows || [];
const num = (s) => Number(String(s || '').replace(/[$,%]/g, '')) || 0;
const capOf = new Map();
for (const r of listings) if (r.symbol) capOf.set(String(r.symbol).trim().toUpperCase(), num(r.marketCap));

const recent = rows.filter((r) => r.year >= 2025);
const withCap = recent.map((r) => ({ ...r, cap: capOf.get(r.sym.toUpperCase()) || 0 })).filter((r) => r.cap > 0);
console.log(`breakouts from 2025 on: ${recent.length}; with a current market cap: ${withCap.length}`);
console.log(`dropped for having no cap (delisted or absent): ${recent.length - withCap.length}\n`);

const agg = (rs) => { const n = rs.length; if (!n) return 'n=0';
  const w = rs.filter((r) => r.ret20 > 0).length, st = rs.filter((r) => r.stopped).length;
  const hit = rs.filter((r) => r.run60 >= 20).length;
  let g = 0, l = 0; for (const r of rs) { const v = Math.max(r.ret20, -7); v > 0 ? g += v : l -= v; }
  return `n=${String(n).padStart(5)} win=${(w / n * 100).toFixed(1)}% stop=${(st / n * 100).toFixed(1)}% reach=${(hit / n * 100).toFixed(1)}% PF=${(l ? g / l : 99).toFixed(2)}`; };
const line = (l, rs) => console.log(l.padEnd(30), agg(rs));
const m = (v) => (v >= 1e9 ? '$' + (v / 1e9).toFixed(0) + 'B' : '$' + Math.round(v / 1e6) + 'M');

line('ALL (2025+, cap known)', withCap);
console.log('\n=== the rule as it stands ===');
line('BELOW $300M', withCap.filter((r) => r.cap < 300e6));
line('AT OR ABOVE $300M', withCap.filter((r) => r.cap >= 300e6));
console.log('\n=== by market cap ===');
for (const [lo, hi] of [[0, 150e6], [150e6, 300e6], [300e6, 1e9], [1e9, 10e9], [10e9, 100e9], [100e9, 1e15]]) line(`  ${m(lo)}-${m(hi)}`, withCap.filter((r) => r.cap >= lo && r.cap < hi));
console.log('\n=== small cap, but does it trade? ===');
line('<$300M cap & >$2M/day', withCap.filter((r) => r.cap < 300e6 && r.dollarVol >= 2e6));
line('<$300M cap & <$2M/day', withCap.filter((r) => r.cap < 300e6 && r.dollarVol < 2e6));
console.log('\n=== how much do the two floors overlap? ===');
const below = withCap.filter((r) => r.cap < 300e6);
console.log(`  of ${below.length} under $300M, ${below.filter((r) => r.avgVol < 100e3).length} are also under 100k shares`);
console.log(`  so the cap floor uniquely removes ${below.filter((r) => r.avgVol >= 100e3).length}`);
line('  under $300M but over 100k shares', below.filter((r) => r.avgVol >= 100e3));
