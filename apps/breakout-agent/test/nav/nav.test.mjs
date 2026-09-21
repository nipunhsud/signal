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
  await settle(page, 300);
  const hist = await page.locator('#drawer #history-content').innerText();
  check(hist.includes('emailed Sep 8') && hist.includes('past the pivot') && hist.includes('pivot $120.00'), 'drawer alert history lists the emailed episode with its levels');
  check((await page.locator('#drawer .badge:has-text("emailed")').count()) >= 1, 'drawer signal row carries the emailed chip');
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
  check(['Screener', 'Winners', 'Beat & Raise', 'Unusual Volume', 'Sectors', 'Shortlist', 'Backtest'].every((l) => txt.includes('Open ' + l)), 'palette lists all 7 views');
  await page.keyboard.press('Escape');

  // Grade sort + filter (Signals view)
  await page.evaluate(() => { dashboard.setView('dashboard'); dashboard.setFilter('signalTypeFilter', 'all'); dashboard.setFilter('minConfidence', 85); });
  await page.evaluate(() => dashboard.setSortPreset([{ key: 'grade', dir: 'desc' }, { key: 'confidence', dir: 'desc' }]));
  const order = await page.evaluate(() => dashboard.getFilteredSignals().map((s) => s.asset));
  check(JSON.stringify(order) === JSON.stringify(['MSFT', 'AAPL', 'NVDA', 'AMD', 'SWKS', 'TSLA']), `grade sort: S › A+ › A › ungraded › X (${order.join(',')})`);
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

  // Any-ticker drawer: a name with no signal row shows the profile, not dashes
  await page.evaluate(() => { dashboard.setView('dashboard'); dashboard.openAsset('OPEN'); }); await settle(page, 600);
  const prof = await page.locator('#profile-body').innerText().catch(() => '');
  check(prof.includes('Why it is not on the screen') && prof.includes('200-day'), 'no-signal drawer renders the profile and the unmet rules');
  const tiles = await page.locator('#profile-tiles').innerText().catch(() => '');
  check(/52-wk high/i.test(tiles) && tiles.includes('$3.07') && !tiles.includes('undefined'), 'no-signal header tiles carry price context');
  check(!(await page.locator('#drawer').innerText()).includes('Invalid Date'), 'no Invalid Date in the no-signal drawer');

  // Full chart: drawing tools and Share to X are in the toolbar
  await page.evaluate(() => dashboard.openChartView('NVDA')); await settle(page, 600);
  const bar = await page.locator('#app').innerText();
  const tools = vp.width > 640 ? ['Trendline', 'Ray', 'Level', 'Clear', 'Save', 'Share to X'] : ['Draw', 'Save', 'Share to X']; // phones fold the drawing tools behind Draw
  check(tools.every((l) => bar.includes(l)), `chart toolbar has ${tools.join(', ')}`);
  const cctx = await page.evaluate(() => dashboard.chatContext());
  check(cctx.view === 'chart' && cctx.asset === 'NVDA' && cctx.chart?.timeframe === 'daily' && Array.isArray(cctx.bases), 'the chat is handed the open chart as context');
  const share = await page.evaluate(() => dashboard._chartShareText());
  check(share[0].startsWith('$NVDA, daily.') && share[0].includes('Grade A base') && share[1].includes('dataquant.ai/$nvda'), `share text composes in the product voice (${share[0]})`);
  await page.evaluate(() => dashboard.closeDrawer());

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await page.close();
}

// Public discovery surfaces: the newest Learn article is linked from the index,
// the sitemap and llms.txt, and carries structured data for crawlers.
{
  console.log('--- receipts');
  {
    const p2 = await browser.newPage({ viewport: { width: 1400, height: 800 } });
    await p2.goto(`${base}/dashboard`); await settle(p2, 400);
    check((await p2.locator('#app tr:has-text("NVDA") .badge:has-text("activity 5")').count()) === 1 && (await p2.locator('#app tr:has-text("NVDA") .badge:has-text("Health Care #2")').count()) === 1, 'row shows the activity score and the sector rank');
    check((await p2.locator('#app tr:has-text("AAPL") .badge:has-text("emailed")').count()) === 1 && (await p2.locator('#app tr:has-text("NVDA") .badge:has-text("emailed")').count()) === 0, 'screener marks the emailed row and only that row');
    check((await p2.locator('#app tr:has-text("SWKS") .badge:has-text("Cheat · 52% up the base")').count()) === 1, 'a shelf breakout inside a forming base is labelled as a cheat entry');
    await p2.evaluate(() => dashboard.toggleQualityFilter('cheat')); await settle(p2, 300);
    const rows = await p2.locator('#app tbody tr').allInnerTexts();
    check(rows.some((r) => r.includes('SWKS')) && !rows.some((r) => r.includes('NVDA')), 'Cheat filter keeps only shelf entries');
    await p2.evaluate(() => dashboard.toggleQualityFilter('cheat')); await settle(p2, 200);
    // Universal ticker search in the top bar: any symbol opens its chart.
    await p2.goto(`${base}/dashboard`); await settle(p2, 300);
    await p2.fill('#nav-ticker-search', 'swks'); await settle(p2, 150);
    check((await p2.locator('#nav-search-dd button').count()) >= 1, 'nav search suggests as you type');
    await p2.press('#nav-ticker-search', 'Enter'); await settle(p2, 300);
    check((await p2.evaluate(() => dashboard.view)) === 'chart' && (await p2.evaluate(() => dashboard.chartAsset)) === 'SWKS' && (await p2.inputValue('#nav-ticker-search')) === '', 'Enter in the nav search opens the chart and clears the box');
    await p2.fill('#nav-ticker-search', 'zzzq'); await settle(p2, 150);
    await p2.press('#nav-ticker-search', 'Enter'); await settle(p2, 300);
    check((await p2.evaluate(() => dashboard.chartAsset)) === 'ZZZQ', 'an unknown symbol still opens (any-ticker chart)');
    // Depth on the base box: label and bracket carry the % the screen grades on.
    const ov = await p2.evaluate(() => { const out = []; dashboard._applyBaseOverlays({ createOverlay: (o) => out.push(o) }, [{ start: '2026-05-27', end: '2026-09-04', pivot: 84.79, low: 55.43, weeks: 14.2, depthPct: 34.6, status: 'forming' }]); return out; });
    check(ov.length === 1 && ov[0].extendData.label === '14.2 wks · 34.6% deep' && ov[0].extendData.depthTag === '34.6%' && ov[0].extendData.lowTag.includes('55.43'), 'base box is labelled with its depth and low');
    await p2.goto(`${base}/pulse?w=2026-09-12`); await settle(p2, 400);
    const rtxt = await p2.locator('#receipts-section').innerText();
    check(rtxt.includes('week ending 2026-09-12') && rtxt.includes('$AAPL') && rtxt.includes('past the pivot') && rtxt.includes('produced 1 breakout'), 'pulse?w= shows the week the post names, with the same sentence');
    await p2.close();
  }
  console.log('--- chat');
  {
    const p4 = await browser.newPage({ viewport: { width: 1400, height: 800 } });
    await p4.goto(`${base}/chat`); await settle(p4, 500);
    check((await p4.locator('#pool-list label').count()) === 2, 'chat sidebar lists the pool');
    await p4.click('#pool-filters [data-f="kind:shelf"]'); await settle(p4, 100);
    check((await p4.locator('#pool-list label').count()) === 1 && (await p4.locator('#pool-list').innerText()).includes('SWKS'), 'cheat filter keeps the shelf entry');
    await p4.click('#pool-filters [data-f="kind:shelf"]'); await settle(p4, 100);
    await p4.locator('#pool-list label:has-text("AAPL") input').check(); await settle(p4, 100);
    check((await p4.locator('#sel-count').innerText()) === '1 selected', 'selecting a name counts it');
    await p4.fill('#input', 'compare these'); await p4.press('#input', 'Enter'); await settle(p4, 800);
    const thread = await p4.locator('#thread').innerText();
    check(thread.includes('(AAPL)') && thread.includes('read the alert pool') && thread.includes('grade A+ base'), 'the question carries the selection, the lookup shows, the answer streams in');
    check((await p4.locator('#thread table').count()) === 1, 'a markdown table renders as a table');
    check(await p4.evaluate(() => ui.history.length === 2 && ui.history[0].content.startsWith('Selected: AAPL.')), 'the transcript carries the selection for the server');
    // Follow-ups after an expired session: refresh, retry, never bounce to the landing.
    await p4.evaluate(() => { window.__refreshed = 0; ui.opts = ui.opts || {}; });
    await p4.evaluate(() => { const m = DQChat.mount; window.__origMount = m; });
    await p4.goto(`${base}/chat`); await settle(p4, 400);
    await p4.evaluate(() => { window.ui = DQChat.mount(document.getElementById('chat-root'), { region: 'us', compact: false, refreshAuth: async () => { window.__refreshed = (window.__refreshed || 0) + 1; } }); });
    await settle(p4, 300);
    check((await p4.locator('#thread .msg').count()) >= 2, 'the transcript is restored from the session after a reload');
    await p4.fill('#input', 'expire-me follow up'); await p4.press('#input', 'Enter'); await settle(p4, 800);
    check((await p4.evaluate(() => window.__refreshed)) === 1 && p4.url().endsWith('/chat') && (await p4.locator('#thread').innerText()).includes('grade A+ base'), 'a 401 refreshes the session and retries instead of bouncing to the landing');
    check((await p4.locator('#thread a[data-ticker="AAPL"]').count()) >= 1, 'tickers in answers are links');
    check((await p4.locator('#thread .follow-ups button').count()) === 3, 'follow-up questions are offered after an answer');
    await p4.click('#new-conv'); await settle(p4, 200);
    check((await p4.locator('#welcome').count()) === 1 && (await p4.evaluate(() => ui.history.length)) === 0, 'new conversation clears the thread');
    // The same chat as a side panel in the dashboard.
    await p4.goto(`${base}/dashboard`); await settle(p4, 400);
    check(((await p4.locator('#chat-panel').boundingBox())?.width ?? 0) <= 2, 'panel starts closed');
    await p4.click('#chat-toggle'); await settle(p4, 500);
    check(((await p4.locator('#chat-panel').boundingBox())?.width || 0) > 300 && (await p4.locator('#chat-panel #pool-list label').count()) === 2, 'Ask opens the panel with the pool loaded');
    await p4.keyboard.press('Escape'); await settle(p4, 300);
    check(((await p4.locator('#chat-panel').boundingBox())?.width ?? 0) <= 2, 'esc closes the panel');
    await p4.locator('#app tr:has-text("AAPL") button:has-text("ask")').first().click(); await settle(p4, 400);
    check(((await p4.locator('#chat-panel').boundingBox())?.width || 0) > 300 && (await p4.locator('#chat-panel #sel-count').innerText()) === '1 selected', 'ask on a row opens the panel with that name selected');
    await p4.evaluate(() => dashboard.askChat('ZZZQ')); await settle(p4, 200);
    check((await p4.locator('#chat-panel #pool-list').innerText()).includes('ZZZQ') && (await p4.locator('#chat-panel #sel-count').innerText()) === '2 selected', 'a name outside the pool can be asked about');
    await p4.reload(); await settle(p4, 500);
    check(((await p4.locator('#chat-panel').boundingBox())?.width || 0) > 300, 'the panel stays open across reloads');
    await p4.evaluate(() => dashboard.closeChat());
    // Admin: FMP data usage by day.
    await p4.evaluate(() => { dashboard.isAdmin = true; dashboard.render(); }); await settle(p4, 300);
    await p4.click('#app button:has-text("Data usage")'); await settle(p4, 400);
    const ut = await p4.locator('#usage-overlay').innerText();
    check(ut.includes('812 MB') && ut.includes('2026-09-19') && ut.includes('410 MB') && ut.includes('eod-seed 404 MB'), 'usage overlay shows the 30-day total and each day by kind');
    await p4.close();
  }
  console.log('--- landscape phone');
  {
    const p3 = await browser.newPage({ viewport: { width: 740, height: 360 } });
    await p3.goto(`${base}/dashboard/chart/NVDA`); await settle(p3, 600);
    const box = await p3.locator('#chart-page-container').boundingBox();
    check(box && box.height >= 180 && box.y + box.height <= 360, `chart fits the landscape viewport (top ${Math.round(box?.y ?? -1)}, height ${Math.round(box?.height ?? -1)})`);
    check(await p3.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal scroll in landscape');
    await p3.setViewportSize({ width: 390, height: 760 }); await settle(p3, 300);
    check((await p3.locator('#chart-draw-tools').isHidden()) && (await p3.locator('button:has-text("Draw")').isVisible()), 'portrait phone folds drawing tools behind Draw');
    await p3.click('button:has-text("Draw")'); await settle(p3, 100);
    check(await p3.locator('#chart-draw-tools').isVisible(), 'Draw reveals the tools');
    await p3.close();
  }
  console.log('--- discovery');
  const get = async (p) => { const r = await fetch(base + p); return { status: r.status, text: await r.text() }; };
  const art = await get('/learn/exit-rules-study.html');
  check(art.status === 200 && art.text.includes('application/ld+json') && art.text.includes('rel="canonical"'), 'exit-rules-study page serves with JSON-LD and canonical');
  check((await get('/learn/index.html')).text.includes('/learn/exit-rules-study'), 'learn index links the study');
  check((await get('/sitemap.xml')).text.includes('/learn/exit-rules-study'), 'sitemap lists the study');
  const llms = (await get('/llms.txt')).text;
  check(llms.includes('/learn/exit-rules-study') && llms.includes('/llms-full.txt'), 'llms.txt links the study and llms-full.txt');
}

await browser.close();
srv.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
