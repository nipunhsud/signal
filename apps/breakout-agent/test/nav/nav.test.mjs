// Dashboard navigation checks: URL routing, back/forward, drawer + chart
// history, top bar on desktop and phone widths, grade sort/filter.
//
//   pnpm -F breakout-agent test:nav
//
// Drives the system Chrome through playwright-core (no browser download).
// Set CHROME_PATH to point at a different Chromium build.
import { chromium } from 'playwright-core';
import { startStub } from './stub-server.mjs';

const { srv, base } = await startStub();
const launch = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' };
const browser = await chromium.launch({ ...launch, headless: true });

let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) failures++; };
const settle = (page, ms = 120) => page.waitForTimeout(ms);
// A click that can't land (element covered or missing) is a failure, not a crash.
const click = async (page, sel) => { try { await page.click(sel, { timeout: 5000 }); return true; } catch (e) { check(false, `click ${sel}: ${e.message.split('\n')[0]}`); return false; } };

for (const vp of [{ width: 1400, height: 800 }, { width: 390, height: 760 }]) {
  console.log(`--- ${vp.width}px`);
  const page = await browser.newPage({ viewport: vp });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const url = () => page.evaluate(() => location.pathname + location.search);
  const view = () => page.evaluate(() => dashboard.view);
  const drawer = () => page.evaluate(() => dashboard.selectedAsset?.asset || null);
  const h1 = () => page.locator('#app h1').first().innerText();

  await page.goto(`${base}/dashboard`, { waitUntil: 'networkidle' });
  await settle(page, 500);

  // Tabs ↔ URL ↔ history
  await click(page, '#top-nav-tabs [data-view="winners"]');
  check((await url()) === '/dashboard/winners' && (await h1()) === 'Winners', 'Winners tab → /dashboard/winners');
  await click(page, '#top-nav-tabs [data-view="sectors"]');
  check((await url()) === '/dashboard/sectors', 'Sectors tab → /dashboard/sectors');
  await page.goBack(); await settle(page);
  check((await view()) === 'winners', 'back → Winners');
  await page.goBack(); await settle(page);
  check((await view()) === 'dashboard' && (await url()) === '/dashboard', 'back → Signals');
  await page.goForward(); await settle(page);
  check((await view()) === 'winners', 'forward → Winners');

  // Drawer in the URL; closing it pops the entry it pushed
  await page.evaluate(() => dashboard.openAsset('NVDA'));
  check((await url()) === '/dashboard/winners?s=NVDA', 'drawer open → ?s=NVDA');
  await page.evaluate(() => dashboard.openAsset('AAPL'));
  check((await url()) === '/dashboard/winners?s=AAPL', 'switching ticker replaces ?s');
  const dtxt = await page.locator('#drawer').innerText();
  check(['SIGNAL', 'RS', 'TREND', 'EARNINGS', 'LEVELS', 'DETAIL', 'UPDATED'].every((l) => dtxt.includes(l)) && (await page.locator('#drawer [data-grade="A+"]').count()) >= 1, 'drawer mirrors every table column and shows the grade chip');
  await page.goBack(); await settle(page, 200);
  check((await drawer()) === null && (await url()) === '/dashboard/winners', 'browser back closes the drawer');
  await page.evaluate(() => dashboard.openAsset('NVDA'));
  await page.keyboard.press('Escape'); await settle(page, 200);
  check((await drawer()) === null && (await url()) === '/dashboard/winners', 'Esc closes drawer and pops its history entry');
  await page.goBack(); await settle(page, 200);
  check((await view()) === 'dashboard', 'history has no leftover drawer entry (back → Signals)');
  await page.goForward(); await settle(page, 200);
  // Drawer's own arrows step the list (the only way on a phone)
  await page.evaluate(() => dashboard.openAsset('NVDA'));
  await click(page, '#drawer [aria-label="Next ticker"]'); await settle(page);
  check((await drawer()) === 'AAPL' && (await url()) === '/dashboard/winners?s=AAPL', 'drawer → arrow steps to AAPL, URL replaced');
  await click(page, '#drawer [aria-label="Previous ticker"]'); await settle(page);
  check((await drawer()) === 'NVDA', 'drawer ← arrow steps back to NVDA');
  await page.evaluate(() => dashboard.closeDrawer()); await settle(page, 200);

  // Chart: crumb, stepper, drawer follows, back pops
  await page.evaluate(() => dashboard.openChartView('NVDA'));
  check((await url()) === '/dashboard/chart/NVDA', 'chart → /dashboard/chart/NVDA');
  check((await page.locator('#top-nav-tabs [aria-current="page"]').innerText()).includes('NVDA'), 'crumb shows NVDA');
  check((await page.locator('#app button:has-text("←")').first().innerText()).includes('Winners'), 'back button says ← Winners');
  check(await page.locator('#app [aria-label="Next ticker"]').count() === 1, 'chart has a next-ticker control');
  await click(page, '#app [aria-label="Next ticker"]'); await settle(page);
  check((await page.evaluate(() => dashboard.chartAsset)) === 'AAPL' && (await url()) === '/dashboard/chart/AAPL', 'next → AAPL, URL replaced');
  await click(page, '#chart-details-btn'); await settle(page);
  check((await drawer()) === 'AAPL' && (await url()) === '/dashboard/chart/AAPL?s=AAPL', 'Details opens the drawer on the chart page');
  await click(page, '#drawer [aria-label="Next ticker"]'); await settle(page);
  check((await drawer()) === 'MSFT' && (await page.evaluate(() => dashboard.chartAsset)) === 'MSFT', 'drawer arrow steps the chart; drawer follows');
  await page.keyboard.press('Escape'); await settle(page, 200);
  check((await drawer()) === null && (await view()) === 'chart' && (await page.evaluate(() => dashboard.chartAsset)) === 'MSFT', 'Esc on chart closes the drawer, chart stays on MSFT');
  await page.keyboard.press('Escape'); await settle(page, 200);
  check((await view()) === 'winners' && (await url()) === '/dashboard/winners', 'Esc again leaves the chart → Winners (history popped)');
  await page.goForward(); await settle(page, 200);
  check((await view()) === 'chart' && (await page.evaluate(() => dashboard.chartAsset)) === 'MSFT', 'forward returns to the chart as last seen (MSFT)');
  await page.goBack(); await settle(page, 200);

  // Direct loads
  await page.goto(`${base}/dashboard/backtest`, { waitUntil: 'networkidle' }); await settle(page, 300);
  check((await view()) === 'backtest' && (await h1()) === 'Backtest', 'reload /dashboard/backtest → Backtest');
  await page.goto(`${base}/dashboard/chart/AAPL?s=AAPL`, { waitUntil: 'networkidle' }); await settle(page, 600);
  check((await view()) === 'chart' && (await drawer()) === 'AAPL', 'reload chart URL with ?s restores the drawer');
  await page.goto(`${base}/$NVDA`, { waitUntil: 'networkidle' }); await settle(page, 600);
  check((await drawer()) === 'NVDA', '/$NVDA opens the NVDA drawer');
  await page.evaluate(() => dashboard.closeDrawer());
  check((await url()) === '/$NVDA' || (await url()) === '/dashboard', 'closing a direct-load drawer does not leave the site');

  // Keyboard + menu
  await page.goto(`${base}/dashboard`, { waitUntil: 'networkidle' }); await settle(page, 400);
  await page.keyboard.press(']'); check((await view()) === 'winners', '] → next tab');
  await page.keyboard.press('['); await page.keyboard.press('['); check((await view()) === 'backtest', '[ wraps to last tab');
  await click(page, '#top-nav-more');
  check(await page.evaluate(() => !document.getElementById('top-nav-menu').hidden), 'menu opens');
  check((await page.locator('#top-nav-menu button:has-text("Sign out")').count()) === 1, 'menu has Sign out');
  check((await page.locator('#top-nav-menu a[href="/pulse"]').count()) === 1, 'menu links to Market Pulse');
  await page.keyboard.press('Escape');
  check(await page.evaluate(() => document.getElementById('top-nav-menu').hidden), 'Esc closes menu');

  // Palette knows every view
  await page.evaluate(() => dashboard.openPalette());
  await page.fill('#sf-palette-input', 'open ');
  const txt = await page.locator('#sf-palette-results').innerText();
  check(['Signals', 'Winners', 'Beat & Raise', 'Unusual Volume', 'Sectors', 'Shortlist', 'Backtest'].every((l) => txt.includes('Open ' + l)), 'palette lists all 7 views');
  await page.keyboard.press('Escape');

  // Grade sort + filter (Signals view)
  await page.evaluate(() => { dashboard.setView('dashboard'); dashboard.setFilter('signalTypeFilter', 'all'); dashboard.setFilter('minConfidence', 85); });
  await page.evaluate(() => dashboard.setSortPreset([{ key: 'grade', dir: 'desc' }, { key: 'confidence', dir: 'desc' }]));
  const order = await page.evaluate(() => dashboard.getFilteredSignals().map((s) => s.asset));
  check(JSON.stringify(order) === JSON.stringify(['MSFT', 'AAPL', 'NVDA', 'AMD', 'TSLA']), `grade sort: S › A+ › A › ungraded › X (${order.join(',')})`);
  await page.evaluate(() => dashboard.setFilter('gradeFilter', 'A+'));
  const aplus = await page.evaluate(() => dashboard.getFilteredSignals().map((s) => s.asset));
  check(JSON.stringify(aplus) === JSON.stringify(['MSFT', 'AAPL']), `grade ≥ A+ keeps S and A+ only (${aplus.join(',')})`);
  check((await page.locator('#app button:has-text("Grade ≥ A+")').count()) === 1, 'active filter chip shows Grade ≥ A+');
  await page.evaluate(() => dashboard.setFilter('gradeFilter', 'all'));
  await page.evaluate(() => dashboard.toggleSort('price'));
  check((await page.evaluate(() => dashboard.sortKeys[0].key)) === 'price', 'Price header is sortable');

  // Status / base-length filters and the clickable chips
  await page.evaluate(() => dashboard.setSortPreset([{ key: 'grade', dir: 'desc' }]));
  await page.evaluate(() => dashboard.setFilter('statusFilter', 'live'));
  const live = await page.evaluate(() => dashboard.getFilteredSignals().map((s) => s.asset));
  check(JSON.stringify(live) === JSON.stringify(['AAPL', 'NVDA']), `status=live keeps power+confirmed (${live.join(',')})`);
  await page.evaluate(() => dashboard.setFilter('statusFilter', 'forming'));
  check(JSON.stringify(await page.evaluate(() => dashboard.getFilteredSignals().map((s) => s.asset))) === '["MSFT"]', 'status=forming keeps the under-pivot base');
  await page.evaluate(() => { dashboard.setFilter('statusFilter', 'all'); dashboard.setFilter('minBaseWeeks', 8); });
  check(JSON.stringify(await page.evaluate(() => dashboard.getFilteredSignals().map((s) => s.asset))) === '["MSFT"]', 'base ≥ 8wk keeps only the 16wk base');
  check((await page.locator('#app button:has-text("Base ≥ 8wk")').count()) === 1, 'active chip shows Base ≥ 8wk');
  await page.evaluate(() => { dashboard.setFilter('minBaseWeeks', 0); dashboard.setSortPreset([{ key: 'weeks', dir: 'desc' }]); });
  const byWk = await page.evaluate(() => dashboard.getFilteredSignals().map((s) => s.asset).slice(0, 3));
  check(JSON.stringify(byWk) === JSON.stringify(['MSFT', 'AAPL', 'NVDA']), `sort by base length: 16wk › 5wk › 4wk (${byWk.join(',')})`);
  check((await page.locator('#app [data-status="forming"]').count()) === 1 && (await page.locator('#app [data-grade="S"]').count()) === 1, 'row shows grade and status chips');
  await click(page, '#app [data-grade="A+"]'); await settle(page);
  check((await page.evaluate(() => dashboard.gradeFilter)) === 'A+' && (await drawer()) === null, 'clicking a grade chip filters without opening the drawer');
  await page.evaluate(() => dashboard.setFilter('gradeFilter', 'all'));
  await click(page, '#app [data-status="forming"]'); await settle(page);
  check((await page.evaluate(() => dashboard.statusFilter)) === 'forming', 'clicking a status chip filters by status');
  await page.evaluate(() => dashboard.resetFilters());

  // Mobile: active tab visible, nothing off-screen
  await page.evaluate(() => dashboard.setView('shortlist')); await settle(page, 1400);
  const fit = await page.evaluate(() => {
    const t = document.getElementById('top-nav-tabs').getBoundingClientRect();
    const a = document.querySelector('[aria-selected="true"]').getBoundingClientRect();
    const more = document.getElementById('top-nav-more').getBoundingClientRect();
    return a.left >= t.left && a.right <= t.right && more.right <= innerWidth && document.documentElement.scrollWidth === innerWidth;
  });
  check(fit, 'active tab visible, ⋯ on screen, no horizontal page scroll');

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await page.close();
}

await browser.close();
srv.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
