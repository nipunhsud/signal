// Simple API endpoint to fetch signals
// Run with: node server.js
import 'dotenv/config';
import express from 'express';
import { clerkMiddleware, requireAuth, getAuth, clerkClient } from '@clerk/express';
import Stripe from 'stripe';
import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { postXThread } from './dist/x-post.js';
import { renderScorecardPng, metaFor, metaHtml } from './og-card.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const db = new PrismaClient();

// Politician (Senate) purchases cache. Refreshes every 12h — the source
// disclosures trickle in, no need to hammer it. In-memory only: on process
// restart we refetch, no DB persistence required.
// symbol → { name, office, transactionDate, disclosureDate, amount, link }
const politicianBuysBySymbol = new Map();
async function refreshPoliticianBuys() {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return;
  try {
    const res = await fetch(`https://financialmodelingprep.com/stable/senate-latest?apikey=${apiKey}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const next = new Map();
    for (const r of Array.isArray(rows) ? rows : []) {
      if ((r.type || '').toLowerCase() !== 'purchase') continue;
      if (!r.symbol) continue;
      const txDate = r.transactionDate ? new Date(r.transactionDate) : null;
      if (txDate && txDate < cutoff) continue;
      const sym = r.symbol.toUpperCase();
      const existing = next.get(sym);
      // Keep the freshest transactionDate per symbol; if same date, keep first.
      if (!existing || (txDate && new Date(existing.transactionDate) < txDate)) {
        next.set(sym, {
          name: `${r.firstName || ''} ${r.lastName || ''}`.trim() || r.office || 'Senator',
          office: r.office || null,
          district: r.district || null,
          transactionDate: r.transactionDate || null,
          disclosureDate: r.disclosureDate || null,
          amount: r.amount || null,
          link: r.link || null,
        });
      }
    }
    politicianBuysBySymbol.clear();
    for (const [k, v] of next) politicianBuysBySymbol.set(k, v);
    console.log(`[senate] refreshed ${politicianBuysBySymbol.size} unique symbols with recent purchases`);
  } catch (err) {
    console.warn('[senate] refresh failed:', err?.message || err);
  }
}
refreshPoliticianBuys();
setInterval(refreshPoliticianBuys, 12 * 60 * 60 * 1000);

// Stripe is optional at boot. If keys aren't set, billing endpoints return 501
// and the paywall degrades to "any signed-in user allowed" so the auth flow can
// still be tested. Enable Stripe by adding STRIPE_SECRET_KEY, STRIPE_PRICE_ID,
// and STRIPE_WEBHOOK_SECRET to .env.
const STRIPE_ENABLED = !!process.env.STRIPE_SECRET_KEY;
const stripe = STRIPE_ENABLED
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })
  : null;
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
if (!STRIPE_ENABLED) {
  console.warn('[stripe] STRIPE_SECRET_KEY missing — billing endpoints disabled, paywall bypassed for signed-in users');
}

// Clerk session middleware — reads the session cookie/Authorization header and
// populates req.auth() with sign-in state. Does NOT enforce auth; that's the
// job of requireAuth() or the paywall middleware on protected routes.
app.use(clerkMiddleware());

// Stripe webhook MUST come before express.json() because Stripe signature
// verification requires the raw request body.
app.post('/api/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!STRIPE_ENABLED) return res.status(501).json({ error: 'Stripe not configured' });
  if (!STRIPE_WEBHOOK_SECRET) return res.status(500).json({ error: 'STRIPE_WEBHOOK_SECRET missing' });

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    console.error('[stripe webhook] signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await db.user.updateMany({
          where: { stripeCustomerId: sub.customer },
          data: {
            stripeSubscriptionId: sub.id,
            subscriptionStatus: sub.status,
            trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
            currentPeriodEndsAt: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
            cancelAtPeriodEnd: !!sub.cancel_at_period_end,
          },
        });
        console.log(`[stripe webhook] ${event.type} synced customer=${sub.customer} status=${sub.status}`);
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        await db.user.updateMany({
          where: { stripeCustomerId: invoice.customer },
          data: { subscriptionStatus: 'past_due' },
        });
        console.log(`[stripe webhook] payment_failed customer=${invoice.customer}`);
        break;
      }
    }
    res.json({ received: true });
  } catch (err) {
    console.error('[stripe webhook] handler error:', err);
    res.status(500).json({ error: err.message });
  }
});

// JSON body parser for everything else. Placed AFTER the raw-body webhook.
app.use(express.json());

// Find or create the local User row for the current Clerk session. Called by
// billing endpoints and the paywall middleware to keep our DB in sync with the
// identity provider.
async function ensureUser(clerkUserId) {
  let user = await db.user.findUnique({ where: { clerkUserId } });
  if (user) return user;
  let email = null;
  try {
    const clerkUser = await clerkClient.users.getUser(clerkUserId);
    email = clerkUser.primaryEmailAddress?.emailAddress ?? clerkUser.emailAddresses?.[0]?.emailAddress ?? null;
  } catch (e) {
    console.warn('[ensureUser] could not fetch Clerk user profile:', e.message);
  }
  user = await db.user.create({ data: { clerkUserId, email } });
  return user;
}

// Paywall: requires (1) Clerk auth AND (2) an active or trialing subscription.
// When Stripe is disabled (dev mode), the second check is skipped.
async function paywall(req, res, next) {
  const { userId } = getAuth(req);
  if (!userId) return res.redirect('/?ref=dashboard');

  if (!STRIPE_ENABLED) return next();

  const user = await ensureUser(userId);
  const activeStatuses = ['trialing', 'active'];
  if (activeStatuses.includes(user.subscriptionStatus)) return next();

  return res.redirect('/upgrade');
}

// Public routes served explicitly BEFORE the static middleware so that "/"
// serves the marketing landing page, not the dashboard.
// Serve the landing page with the Clerk publishable key injected from env, so
// localhost (test instance) and prod (live instance) each use their own Clerk —
// no hardcoded key, no dev/prod session mismatch. The frontend derives the Clerk
// frontend-API host from the key itself.
function serveLanding(req, res) {
  const pk = process.env.CLERK_PUBLISHABLE_KEY || '';
  const html = fs
    .readFileSync(path.join(__dirname, 'public', 'landing.html'), 'utf8')
    .replaceAll('__CLERK_PUBLISHABLE_KEY__', pk);
  res.type('html').send(html);
}
app.get('/', serveLanding);
app.get('/landing.html', serveLanding);

// Upgrade page — where expired trials / churned users land.
app.get('/upgrade', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'upgrade.html'));
});

// Market Pulse — PUBLIC engagement/acquisition surface (no paywall, crawlable):
// social-sentiment trending + market news, cross-referenced against our live
// signals, teasing the setup to drive signups.
app.get('/pulse', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pulse.html'));
});

// Dashboard is behind the paywall.
app.get('/dashboard', paywall, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// India dashboard — same SPA, same paywall. The page detects region from the
// /in path prefix and scopes its API calls + currency (₹) accordingly.
app.get('/in/dashboard', paywall, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/in', (req, res) => res.redirect('/in/dashboard'));

// Public OG scorecard image (1200×630 PNG) for X/social link previews. No
// paywall — crawlers must be able to fetch it. Falls back to a ticker-only card
// when no signal exists yet, so the link still previews.
const latestSignalFor = (ticker) =>
  db.breakoutSignal.findFirst({ where: { asset: ticker.toUpperCase() }, orderBy: { createdAt: 'desc' } });

app.get(/^\/og\/([A-Za-z.\-]+)\.png$/, async (req, res) => {
  try {
    const ticker = req.params[0].toUpperCase();
    const s = (await latestSignalFor(ticker)) || { asset: ticker };
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=900'); // 15 min; signals move slowly
    res.send(renderScorecardPng(s));
  } catch (error) {
    console.error('[/og] failed:', error);
    res.status(500).end();
  }
});

const isCrawler = (ua) =>
  /bot|crawler|spider|twitter|facebookexternalhit|slack|discord|linkedin|whatsapp|telegram|embedly|preview/i.test(ua || '');

// Per-ticker deep link (e.g. /$hpe). Crawlers get a bare OG/Twitter-card shell
// (no paywall) so the scorecard renders in the tweet; humans fall through to the
// paywalled SPA, which reads the $SYMBOL from the path and opens the drawer.
app.get(/^\/\$[A-Za-z.\-]+$/, async (req, res, next) => {
  if (!isCrawler(req.get('user-agent'))) return next();
  try {
    const ticker = decodeURIComponent(req.path).replace(/^\/\$/, '').toUpperCase();
    const s = (await latestSignalFor(ticker)) || { asset: ticker };
    const proto = req.get('x-forwarded-proto') || req.protocol; // Caddy terminates TLS
    const origin = `${proto}://${req.get('host')}`;
    res.type('html').send(metaHtml(metaFor(s, `${origin}/og/${ticker}.png`, `${origin}${req.path}`)));
  } catch (error) {
    console.error('[deep-link og] failed:', error);
    next();
  }
});
app.get(/^\/\$[A-Za-z.\-]+$/, paywall, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Fallback for the CTA hrefs. The landing JS normally intercepts these to open
// the Clerk modal, but a click that lands before the Clerk SDK finishes loading
// falls through to the raw href — so serve the landing page instead of a 404.
app.get(['/signup', '/login'], (req, res) => res.redirect('/'));

// Create a Stripe Checkout session for the signed-in user. Frontend calls this
// after Clerk sign-up, then redirects to the returned URL.
app.post('/api/create-checkout-session', requireAuth(), async (req, res) => {
  if (!STRIPE_ENABLED) return res.status(501).json({ error: 'Stripe not configured' });
  if (!STRIPE_PRICE_ID) return res.status(500).json({ error: 'STRIPE_PRICE_ID missing' });

  const { userId } = getAuth(req);
  const user = await ensureUser(userId);

  // Create Stripe customer on demand — most Clerk users won't have one yet.
  let stripeCustomerId = user.stripeCustomerId;
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { clerkUserId: userId },
    });
    stripeCustomerId = customer.id;
    await db.user.update({ where: { id: user.id }, data: { stripeCustomerId } });
  }

  const origin = req.headers.origin || `${req.protocol}://${req.get('host')}`;
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: stripeCustomerId,
    line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
    subscription_data: {
      trial_period_days: 30,
      metadata: { clerkUserId: userId },
    },
    // Card required upfront — dramatically higher trial→paid conversion vs. no-card trials.
    payment_method_collection: 'always',
    success_url: `${origin}/dashboard?checkout=success`,
    cancel_url: `${origin}/?checkout=canceled`,
    allow_promotion_codes: true,
  });

  res.json({ url: session.url });
});

// Stripe Customer Portal — where users manage their subscription (cancel,
// update card, view invoices). Linked from the dashboard nav.
app.get('/api/billing-portal', requireAuth(), async (req, res) => {
  if (!STRIPE_ENABLED) return res.status(501).json({ error: 'Stripe not configured' });

  const { userId } = getAuth(req);
  const user = await ensureUser(userId);
  if (!user.stripeCustomerId) return res.status(400).json({ error: 'No Stripe customer for this user' });

  const origin = req.headers.origin || `${req.protocol}://${req.get('host')}`;
  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${origin}/dashboard`,
  });

  res.redirect(session.url);
});

// ── Admin: tweet a symbol's earnings breakdown to X ────────────────────────
// Gated by Clerk private metadata { admin: "true" }. Composes a review-ready
// thread from the symbol's cached earnings analysis and posts via the shared
// X client. Two-step: no body.confirm returns a preview; confirm:true posts.
const SECTOR_TAILWINDS = {
  Technology: 'AI adoption & cloud expansion',
  Semiconductors: 'AI chip demand cycle',
  Healthcare: 'GLP-1 drug cycle & aging demographics',
  Energy: 'Energy transition & LNG demand',
  Financials: 'Rate normalization cycle',
  'Consumer Cyclical': 'Post-rate-cut spending recovery',
  Industrials: 'Reshoring & infrastructure spend',
};
const sectorTailwind = (sector = '') =>
  Object.entries(SECTOR_TAILWINDS).find(([k]) => sector.includes(k))?.[1] || '';
const capWord = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// One cohesive long-form tweet (Premium accounts allow up to 25k chars), built
// as blank-line-separated sections. Returned as a single-element array so the
// caller posts it as one tweet — no thread, no truncation.
function composeEarningsTweets(asset, ta, sig) {
  const emoji = ta.tone === 'bullish' ? '📈' : ta.tone === 'bearish' ? '📉' : '➖';
  const highlights = Array.isArray(ta.highlights) ? ta.highlights : [];
  const risks = Array.isArray(ta.riskFlags) ? ta.riskFlags : [];
  const tailwind = sectorTailwind(sig?.sector || '');
  const hasGuidance = ta.guidanceDirection && ta.guidanceDirection !== 'none';

  const sections = [];
  sections.push(
    `${emoji} $${asset} Q${ta.quarter} ${ta.year} — ${capWord(ta.tone)} tone` +
      (hasGuidance ? `, guidance ${ta.guidanceDirection}` : '') + '.',
  );
  if (ta.summary) sections.push(ta.summary);

  const meta = [];
  if (hasGuidance) meta.push(`🔹 Guidance: ${capWord(ta.guidanceDirection)}`);
  if (tailwind) meta.push(`🔹 Tailwinds: ${tailwind}`);
  if (meta.length) sections.push(meta.join('\n'));

  if (highlights.length) sections.push(['✅ Highlights', ...highlights.map((h) => `• ${h}`)].join('\n'));
  if (risks.length) sections.push(['⚠️ Risks', ...risks.map((r) => `• ${r}`)].join('\n'));

  // Exactly ONE cashtag per post (X API limit) — it's already in the header, so
  // the closing line must not repeat $ASSET.
  sections.push(`Full breakdown & key levels → dataquant.ai 👇\nNot advice`);

  return [sections.join('\n\n')];
}

async function isAdmin(req) {
  const { userId } = getAuth(req);
  if (!userId) return false;
  try {
    const flag = (await clerkClient.users.getUser(userId)).privateMetadata?.admin;
    return flag === true || flag === 'true';
  } catch (e) {
    console.warn('[isAdmin] lookup failed:', e.message);
    return false;
  }
}

app.get('/api/admin/status', async (req, res) => {
  res.json({ isAdmin: await isAdmin(req) });
});

// No requireAuth() here — that middleware redirects unauthenticated requests to
// an HTML page, which breaks fetch()'s res.json(). isAdmin() (reads getAuth via
// the global clerkMiddleware) gates it and always returns JSON.
app.post('/api/admin/tweet-earnings', async (req, res) => {
  if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only — sign in as an admin user' });
  const asset = String(req.body?.asset || '').toUpperCase().trim();
  if (!asset) return res.status(400).json({ error: 'asset required' });

  const ta = await db.transcriptAnalysis.findFirst({
    where: { asset },
    orderBy: [{ year: 'desc' }, { quarter: 'desc' }],
  });
  if (!ta) return res.status(404).json({ error: `No earnings analysis cached for ${asset} — run "Analyze" first.` });

  const sig = await db.breakoutSignal.findFirst({ where: { asset }, orderBy: { createdAt: 'desc' } });
  const tweets = composeEarningsTweets(asset, ta, sig);

  if (!req.body?.confirm) return res.json({ preview: true, tweets });

  const ok = await postXThread(tweets);
  if (!ok) return res.status(502).json({ error: 'X post failed — check X_POST_ENABLED + tokens (app must be Read/Write)' });
  await db.transcriptAnalysis.update({ where: { id: ta.id }, data: { xPostedAt: new Date() } });
  console.log(`✓ Admin tweeted $${asset} earnings (${tweets.length} tweets)`);
  res.json({ ok: true, tweets });
});

// Static assets (landing.html, CSS, JS, images) remain public. Note: because
// this comes AFTER the explicit "/" handler above, root requests go to the
// landing page, not to index.html.
app.use(express.static('public'));

// Extension distance penalty: a heavily-extended Type3 is a valid breakout but a
// bad re-entry, so its DISPLAY confidence is discounted from the raw db value.
// Shared by /api/signals and /api/unusual-volume so both agree on what counts as
// actionable (>= 80). pctGainFromEntry is % above the frozen entry price.
function displayConfidenceFor(rawConfidence, isExtension, pctGainFromEntry) {
  let display = Math.round(rawConfidence * 100);
  if (isExtension && pctGainFromEntry != null) {
    let penalty = 0;
    if (pctGainFromEntry > 2) {
      penalty = pctGainFromEntry <= 5
        ? (pctGainFromEntry - 2)          // -1% per 1% gain in 2-5% zone
        : (3 + (pctGainFromEntry - 5) * 1.5); // steeper beyond 5%
    }
    display = Math.max(50, display - Math.round(penalty)); // floor at 50%
  }
  return display;
}

// Region scoping. Indian (NSE/BSE) signals carry a .NS/.BO suffix in `asset`;
// US signals don't. This is the region discriminator — no schema column needed.
// `region` query param: 'in' → Indian names only; anything else → US (default).
function regionOf(req) {
  return req.query.region === 'in' ? 'in' : 'us';
}
// Prisma where-fragment for findMany calls.
function regionWhere(region) {
  const indian = { OR: [{ asset: { endsWith: '.NS' } }, { asset: { endsWith: '.BO' } }] };
  return region === 'in' ? indian : { NOT: indian };
}
// Raw-SQL predicate for $queryRaw (col defaults to bs.asset). Returns a leading AND.
function regionSql(region, col = Prisma.raw('bs.asset')) {
  return region === 'in'
    ? Prisma.sql`AND (${col} LIKE '%.NS' OR ${col} LIKE '%.BO')`
    : Prisma.sql`AND ${col} NOT LIKE '%.NS' AND ${col} NOT LIKE '%.BO'`;
}

app.get('/api/signals', async (req, res) => {
  console.log('[/api/signals] Handler called with query:', req.query);
  const region = regionOf(req);
  const assetTypeFilter = req.query.type || 'all'; // 'stocks', 'etfs', or 'all'
  // Lookback window (days). Default 3 (=72h, survives the Fri→Mon gap); the
  // breakout view's slider widens it to surface older alerts. Clamp 1–90.
  const daysBack = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 3));

  try {
    // Get removed assets
    const removedAssets = await db.removedAsset.findMany({
      select: { asset: true }
    });
    const removedAssetSet = new Set(removedAssets.map(r => r.asset));

    // Type 1: Breakout signals (+ Type 3 Extensions)
    const breakoutSignals = await db.$queryRaw`
      WITH first_green AS (
        SELECT DISTINCT ON (asset)
          asset,
          "createdAt" AS "firstGreenAt",
          resistance AS "entryResistance"
        FROM "BreakoutSignal"
        WHERE "pineScriptGreen" = true
        ORDER BY asset, "createdAt" ASC
      ),
      ranked AS (
        SELECT
          bs.asset,
          bs.confidence,
          bs."currentPrice",
          bs.resistance,
          bs.support,
          bs."entryPrice",
          bs."stopLoss",
          bs."shouldAlert",
          bs."alertSentAt",
          bs."agentDecision",
          bs."createdAt",
          bs."pineScriptGreen",
          bs."bullishCandle",
          bs."barsInRange",
          bs."assetType",
          bs."expenseRatio",
          bs."etfCategory",
          bs.sector,
          bs.industry,
          bs."breakoutType",
          bs."extensionPriorBreakoutBarsAgo",
          bs."signalDate",
          bs."earningsTone",
          bs."earningsToneScore",
          bs."earningsGuidance",
          bs."earningsQuarter",
          bs."earningsYear",
          fg."firstGreenAt",
          COALESCE(fg."entryResistance", bs.resistance) AS "entryResistance",
          ROW_NUMBER() OVER (PARTITION BY bs.asset ORDER BY bs."createdAt" DESC) as rn
        FROM "BreakoutSignal" bs
        LEFT JOIN first_green fg ON fg.asset = bs.asset
        WHERE bs.confidence >= 0.80
          -- Lookback window (default 3d survives the Fri→Mon gap; slider widens it)
          AND bs."createdAt" > NOW() - make_interval(days => ${daysBack}::int)
          ${regionSql(region)}
      )
      SELECT
        asset,
        confidence,
        "currentPrice",
        resistance,
        support,
        "entryPrice",
        "stopLoss",
        "shouldAlert",
        "alertSentAt",
        "agentDecision",
        "createdAt",
        "pineScriptGreen",
        "bullishCandle",
        "barsInRange",
        "assetType",
        "expenseRatio",
        "etfCategory",
        sector,
        industry,
        "breakoutType",
        "extensionPriorBreakoutBarsAgo",
        "signalDate",
        "earningsTone",
        "earningsToneScore",
        "earningsGuidance",
        "earningsQuarter",
        "earningsYear",
        "firstGreenAt",
        "entryResistance"
      FROM ranked
      WHERE rn = 1
        AND confidence >= 0.80
      ORDER BY confidence DESC, "createdAt" DESC
    `;

    // Setup signals — same 72h window so they survive the weekend gap.
    // Dedupe to the most recent row per (asset, signalType): every 15-min scan
    // writes a new row when price/MA20 moves, so history is fine, but the
    // dashboard only needs the latest snapshot.
    const setupSignalsRaw = await db.signal.findMany({
      where: {
        agentName: 'BreakoutAgent',
        signalType: { startsWith: 'setup-' },
        confidence: { gte: 0.80 },
        createdAt: { gt: new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000) },
        ...regionWhere(region),
      },
      orderBy: { createdAt: 'desc' }, // most recent first for dedup
    });
    const setupMap = new Map();
    for (const s of setupSignalsRaw) {
      const key = `${s.asset}::${s.signalType}`;
      if (!setupMap.has(key)) setupMap.set(key, s);
    }
    const setupSignals = Array.from(setupMap.values())
      .sort((a, b) => b.confidence - a.confidence);

    // Format Type 1 & Type 3 response
    const formatBreakout = (s) => {
      const firstGreenAt = s.firstGreenAt ? new Date(s.firstGreenAt) : null;
      // Prefer the frozen entryPrice/stopLoss snapshotted at flip. Fall back to
      // the legacy first_green resistance for rows written before the migration.
      const entryResistance = s.entryPrice != null
        ? parseFloat(s.entryPrice)
        : (s.entryResistance ? parseFloat(s.entryResistance) : null);
      const persistedStopLoss = s.stopLoss != null ? parseFloat(s.stopLoss) : null;

      // Days since the actual market breakout, not since we first recorded it.
      // Type 3 extensions know exactly how many bars ago the real breakout fired
      // (1-5). Type 1 fresh breakouts are by definition 0. Fall back to
      // firstGreenAt only when neither is available.
      let daysSinceBreakout = null;
      if (s.breakoutType === 'Type3' && s.extensionPriorBreakoutBarsAgo > 0) {
        daysSinceBreakout = s.extensionPriorBreakoutBarsAgo;
      } else if (s.breakoutType === 'Type1') {
        daysSinceBreakout = 0;
      } else if (firstGreenAt) {
        daysSinceBreakout = (Date.now() - firstGreenAt.getTime()) / (1000 * 60 * 60 * 24);
      }

      // Use actual breakoutType from database:
      //   Type1  = fresh breakout (strong volume), signalType 'breakout'
      //   Type1b = clean breakout on weak volume, signalType 'breakout' + weakVolume flag
      //   Type3  = continuation, signalType 'extension'
      const isType1 = s.breakoutType === 'Type1';
      const isType1b = s.breakoutType === 'Type1b';
      const isType3 = s.breakoutType === 'Type3';
      const isExtension = isType3;
      const weakVolume = isType1b;

      // Stopped out: price has closed at/below the frozen stop. The trade is
      // dead — keep it visible but flag it and drop it out of alerts/high-conf.
      const stoppedOut = persistedStopLoss != null && s.currentPrice <= persistedStopLoss;

      const signalType = isExtension ? 'extension' : 'breakout';
      const pctGainFromEntry = (isExtension && entryResistance > 0)
        ? Math.round(((s.currentPrice - entryResistance) / entryResistance) * 1000) / 10
        : null;

      // Extensions show true confidence with distance penalty (shared helper).
      const displayConfidence = displayConfidenceFor(s.confidence, isExtension, pctGainFromEntry);

      const assetTypeLabel = s.assetType === 'etf' ? '📊 ETF' : '📈 STOCK';
      const etfNote = s.assetType === 'etf' && s.expenseRatio ? ` (${s.expenseRatio}% expense)` : '';

      return {
        asset: s.asset,
        assetType: s.assetType || 'stock',
        assetTypeLabel,
        expenseRatio: s.expenseRatio,
        etfCategory: s.etfCategory,
        sector: s.sector || 'Unknown',
        industry: s.industry || 'Unknown',
        confidence: displayConfidence,
        currentPrice: s.currentPrice,
        resistance: s.resistance,
        support: s.support,
        shouldAlert: s.shouldAlert,
        stoppedOut,
        alertSentAt: s.alertSentAt || null,
        agentDecision: s.agentDecision || '',
        createdAt: s.createdAt,
        pineScriptGreen: s.pineScriptGreen || false,
        bullishCandle: s.bullishCandle || false,
        barsInRange: s.barsInRange || 0,
        signalType,
        weakVolume,
        displayType: signalType === 'extension' ? 'extension' : s.pineScriptGreen ? 'green' : s.confidence >= 90 ? 'orange' : 'yellow',
        firstGreenAt: firstGreenAt ? firstGreenAt.toISOString() : null,
        entryResistance,
        entryPrice: entryResistance,
        // Frozen 7%-below-entry stop; fall back to legacy 2%-below-support for old rows.
        stopLoss: persistedStopLoss != null
          ? Math.round(persistedStopLoss * 100) / 100
          : (s.support > 0 ? Math.round(s.support * 0.98 * 100) / 100 : null),
        riskReward: entryResistance > 0 && persistedStopLoss != null && persistedStopLoss > 0
          ? Math.round(((s.currentPrice - persistedStopLoss) / (entryResistance - persistedStopLoss)) * 100) / 100
          : (entryResistance > 0 && s.support > 0
              ? Math.round(((s.currentPrice - s.support) / (entryResistance - s.support)) * 100) / 100
              : null),
        daysSinceBreakout: daysSinceBreakout !== null ? Math.round(daysSinceBreakout * 10) / 10 : null,
        pctGainFromEntry,
        displayAsset: `${s.asset} ${assetTypeLabel}${etfNote}`,
        earningsTone: s.earningsTone || null,
        earningsToneScore: s.earningsToneScore != null ? Number(s.earningsToneScore) : null,
        earningsGuidance: s.earningsGuidance || null,
        earningsQuarter: s.earningsQuarter != null ? Number(s.earningsQuarter) : null,
        earningsYear: s.earningsYear != null ? Number(s.earningsYear) : null,
        // Sort key: tone [-1..1] + guidance bonus (+0.5 raised, -0.5 lowered).
        // null earnings sort last (-Infinity) so signals with earnings float up.
        earningsSortScore: s.earningsToneScore != null
          ? Number(s.earningsToneScore) + (s.earningsGuidance === 'raised' ? 0.5 : s.earningsGuidance === 'lowered' ? -0.5 : 0)
          : null,
      };
    };

    // Format Type 2 response
    const formatSetup = (s) => {
      const meta = s.metadata || {};
      const assetType = meta.assetType || 'stock';
      const assetTypeLabel = assetType === 'etf' ? '📊 ETF' : '📈 STOCK';
      const etfNote = assetType === 'etf' && meta.expenseRatio ? ` (${meta.expenseRatio}% expense)` : '';

      return {
        asset: s.asset,
        assetType,
        assetTypeLabel,
        expenseRatio: meta.expenseRatio,
        etfCategory: meta.etfCategory,
        confidence: Math.round(s.confidence * 100),
        currentPrice: meta.currentPrice || 0,
        ma20: meta.ma20 || 0,
        distanceFromMA20: meta.distanceFromMA20 || 0,
        createdAt: s.createdAt,
        signalType: 'setup',
        setupType: meta.setupType || 'unknown',
        consolidationRange: meta.setupConsolidationRangePercent || 0,
        consolidationVolume: meta.setupConsolidationVolumePercent || 0,
        displayType: s.confidence >= 0.95 ? 'green' : s.confidence >= 0.85 ? 'orange' : 'yellow',
        agentDecision: meta.agentDecision || s.agentDecision || '',
        sector: meta.sector || 'Unknown',
        industry: meta.industry || 'Unknown',
        displayAsset: `${s.asset} ${assetTypeLabel}${etfNote}`,
        earningsTone: null,
        earningsToneScore: null,
        earningsGuidance: null,
        earningsQuarter: null,
        earningsYear: null,
        earningsSortScore: null,
      };
    };

    // Apply asset type filter
    const filterByAssetType = (signal) => {
      // For raw DB signals, assetType is in metadata; for formatted signals, it's a direct property
      const assetType = signal.assetType || signal.metadata?.assetType;
      if (assetTypeFilter === 'stocks') return assetType === 'stock';
      if (assetTypeFilter === 'etfs') return assetType === 'etf';
      return true; // 'all'
    };

    // Combine and format, filtering out removed assets and applying type filter
    console.log(`[DEBUG] assetTypeFilter="${assetTypeFilter}", breakoutSignals=${breakoutSignals.length}, setupSignals=${setupSignals.length}`);
    const formattedBreakouts = breakoutSignals
      .filter(s => !removedAssetSet.has(s.asset) && filterByAssetType(s))
      .map(formatBreakout);
    const formattedSetups = setupSignals
      .filter(s => {
        const passes = !removedAssetSet.has(s.asset) && filterByAssetType(s);
        if (!passes && s.asset === 'ALKS') console.log(`[DEBUG] ALKS filtered out: removed=${removedAssetSet.has(s.asset)}, filterByAssetType=${filterByAssetType(s)}, assetType=${s.metadata?.assetType}`);
        return passes;
      })
      .map(formatSetup);

    let allSignals = [...formattedBreakouts, ...formattedSetups];

    // Decorate with Winner tier (A/B/C) so the Signals view shows which names
    // also pass the fundamentals gate. Same 7-day lookback as the Winners →
    // Signals join in /api/winners. Highest-priority screenType wins.
    if (allSignals.length > 0) {
      const sigAssets = [...new Set(allSignals.map(s => s.asset))];
      const winnerSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const winnerRows = await db.winnerSignal.findMany({
        where: { asset: { in: sigAssets }, createdAt: { gte: winnerSince } },
        select: { asset: true, tier: true, screenType: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      });
      const tierRank = { A: 0, B: 1, C: 2 };
      const bestByAsset = new Map();
      for (const w of winnerRows) {
        const cur = bestByAsset.get(w.asset);
        if (!cur || (tierRank[w.tier] ?? 9) < (tierRank[cur.tier] ?? 9)) {
          bestByAsset.set(w.asset, w);
        }
      }
      allSignals = allSignals.map(s => {
        const w = bestByAsset.get(s.asset);
        return w ? { ...s, winnerTier: w.tier, winnerScreen: w.screenType } : s;
      });
    }

    // Politician (Senate) purchase overlay — attach when the asset has a
    // recent Purchase disclosure. Signal in the noise: a senator bought this
    // symbol in the last 90 days.
    allSignals = allSignals.map(s => {
      const pb = politicianBuysBySymbol.get((s.asset || '').toUpperCase());
      return pb ? { ...s, politicianBuy: pb } : s;
    });

    const sorted = allSignals.sort((a, b) => b.confidence - a.confidence);

    // Stopped-out names never count as high-confidence, whatever their score —
    // they stay visible but drop into the medium group (frontend sinks them last).
    // No lower bound here: every signal already passed the raw >=0.80 gate in
    // SQL; display confidence only dips below 80 via the extension distance
    // penalty, and those should stay visible (penalized), not vanish.
    const highConfidence = sorted.filter(s => s.confidence >= 95 && !s.stoppedOut);
    const mediumConfidence = [
      ...sorted.filter(s => s.confidence < 95 && !s.stoppedOut),
      ...sorted.filter(s => s.stoppedOut),
    ];

    const breakoutCount = formattedBreakouts.filter(s => s.signalType === 'breakout').length;
    const extensionCount = formattedBreakouts.filter(s => s.signalType === 'extension').length;
    const setupCount = formattedSetups.length;

    // Latest market-breadth snapshot per scan mode. baseCount = stocks in a
    // loose setup-base state (not tradable individually, but useful as a
    // breadth gauge). handleCount duplicates the tradable handle watchlist.
    const breadthRows = await db.$queryRaw`
      SELECT DISTINCT ON (mode) mode, "baseCount", "handleCount", "totalScanned", "createdAt"
      FROM "MarketBreadth"
      WHERE "createdAt" > NOW() - INTERVAL '72 hours'
      ORDER BY mode, "createdAt" DESC
    `;
    const breadth = { stocks: null, etfs: null };
    for (const row of breadthRows) {
      breadth[row.mode] = {
        baseCount: row.baseCount,
        handleCount: row.handleCount,
        totalScanned: row.totalScanned,
        asOf: row.createdAt,
      };
    }

    res.json({
      highConfidence,
      mediumConfidence,
      stats: {
        highConfidenceCount: highConfidence.length,
        mediumConfidenceCount: mediumConfidence.length,
        total: sorted.length,
        breakoutCount,
        extensionCount,
        setupCount,
        breadth,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/scan', async (req, res) => {
  try {
    // Import the agent dynamically
    const { BreakoutAgent } = await import('./dist/agent.js');
    const { getConfig } = await import('./dist/config.js');

    const config = getConfig();
    const agent = new BreakoutAgent();

    res.json({ status: 'scanning', assetsCount: config.assets.length, message: 'Scan started in background' });

    // Run scan in background (don't wait for it)
    // Run both stocks and ETFs scans sequentially to respect FMP 750rpm limit
    (async () => {
      try {
        const stocksResults = await agent.analyzeMarkets(config.assets, "stocks");
        const etfsResults = await agent.analyzeMarkets(config.assets, "etfs");
        const allResults = [...stocksResults, ...etfsResults];
        const alerts = allResults.filter((r) => r.shouldAlert).length;
        console.log(`✅ On-demand scan completed: ${allResults.length} signals, ${alerts} alerts`);
      } catch (error) {
        console.error('❌ On-demand scan failed:', error);
      }
    })();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Winners screen — most recent qualifying row per asset, filtered by screen type.
// type=setup → fundamentals + technical setup
// type=moving&window=1w|1m|3m → fundamentals + trailing return
app.get('/api/winners', async (req, res) => {
  try {
    const rawType = typeof req.query.type === 'string' ? req.query.type : 'setup';
    const rawWindow = typeof req.query.window === 'string' ? req.query.window : '1m';
    const validWindows = ['1w', '1m', '3m'];
    const window = validWindows.includes(rawWindow) ? rawWindow : '1m';
    const screenType = rawType === 'moving' ? `moving-${window}` : 'setup';
    const isMoving = screenType.startsWith('moving-');
    const tier = typeof req.query.tier === 'string' ? req.query.tier.toUpperCase() : null;

    // Pull last 14 days, then dedupe by asset (most recent wins). This mirrors
    // how /api/signals surfaces "current state" without letting stale rows leak.
    const since = new Date();
    since.setDate(since.getDate() - 14);

    const where = { screenType, createdAt: { gte: since }, ...regionWhere(regionOf(req)) };
    if (tier && ['A', 'B', 'C'].includes(tier)) where.tier = tier;

    const rows = await db.winnerSignal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    const byAsset = new Map();
    for (const r of rows) {
      if (!byAsset.has(r.asset)) byAsset.set(r.asset, r);
    }

    const tierOrder = { A: 0, B: 1, C: 2 };
    const winnersRaw = [...byAsset.values()].sort((a, b) => {
      // Moving: sort by return magnitude (biggest movers first). Setup: by tier then confidence.
      if (isMoving) return (b.returnPct ?? 0) - (a.returnPct ?? 0);
      const t = (tierOrder[a.tier] ?? 9) - (tierOrder[b.tier] ?? 9);
      if (t !== 0) return t;
      return b.confidence - a.confidence;
    });

    // Decorate with current breakout/setup state so the Winners UI shows
    // which of these names are also actively flagged by the breakout agent.
    // 7-day lookback = survives weekends without dragging in stale rows.
    const assetList = winnersRaw.map(w => w.asset);
    let signalStateByAsset = new Map();
    if (assetList.length > 0) {
      const sinceState = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const [breakouts, setups] = await Promise.all([
        db.breakoutSignal.findMany({
          where: { asset: { in: assetList }, createdAt: { gte: sinceState }, breakoutType: { in: ['Type1', 'Type1b', 'Type3'] } },
          orderBy: { createdAt: 'desc' },
          select: { asset: true, breakoutType: true, createdAt: true },
        }),
        db.signal.findMany({
          where: { asset: { in: assetList }, createdAt: { gte: sinceState }, agentName: 'BreakoutAgent', signalType: { startsWith: 'setup-' } },
          orderBy: { createdAt: 'desc' },
          select: { asset: true, createdAt: true },
        }),
      ]);
      // Most recent per asset wins (rows already sorted desc).
      const latestBreak = new Map();
      for (const r of breakouts) if (!latestBreak.has(r.asset)) latestBreak.set(r.asset, r);
      const latestSetup = new Map();
      for (const r of setups) if (!latestSetup.has(r.asset)) latestSetup.set(r.asset, r);

      // Priority: extension > breakout > setup. A newer setup row doesn't mean
      // a stock "went back" to setup — extension/breakout are further along in
      // the workflow and take precedence when both exist in the 7-day window.
      for (const asset of assetList) {
        const b = latestBreak.get(asset);
        const s = latestSetup.get(asset);
        if (b) {
          const label = b.breakoutType === 'Type3' ? 'extension'
            : b.breakoutType === 'Type1b' ? 'breakout-weak'
            : 'breakout';
          signalStateByAsset.set(asset, label);
        } else if (s) {
          signalStateByAsset.set(asset, 'setup');
        }
      }
    }
    const winners = winnersRaw.map(w => ({
      ...w,
      signalType: signalStateByAsset.get(w.asset) ?? null,
      politicianBuy: politicianBuysBySymbol.get((w.asset || '').toUpperCase()) || null,
    }));

    res.json({
      screenType,
      window: isMoving ? window : null,
      generatedAt: new Date().toISOString(),
      count: winners.length,
      winners,
    });
  } catch (error) {
    console.error('[/api/winners] failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Beat & Raise screen: stocks whose most recent scan shows an earnings beat AND
// raised forward guidance (both cached on BreakoutSignal from transcript analysis),
// filtered to those with two consecutive quarters of sequential EPS growth.
// Universe = recently-scanned breakout stocks; EPS-trend check hits FMP live but
// only for the already-narrowed beat+raise candidates (a handful), 6h cached.
// ponytail: universe is limited to scanned breakout names, not the whole market;
// widen by feeding more symbols through the scanner if coverage matters.
const epsQuartersCache = new Map(); // symbol -> { eps: number[], expiresAt }
const EPS_QUARTERS_TTL_MS = 6 * 60 * 60 * 1000; // 6h — quarterly data changes slowly

async function getQuarterlyEps(symbol) {
  const now = Date.now();
  const cached = epsQuartersCache.get(symbol);
  if (cached && cached.expiresAt > now) return cached.eps;
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return null;
  try {
    const url = `https://financialmodelingprep.com/stable/income-statement?symbol=${encodeURIComponent(symbol)}&period=quarter&limit=3&apikey=${apiKey}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const data = await r.json();
    if (!Array.isArray(data)) return null;
    const eps = data.map(q => Number(q?.eps)).filter(Number.isFinite); // newest-first
    epsQuartersCache.set(symbol, { eps, expiresAt: now + EPS_QUARTERS_TTL_MS });
    return eps;
  } catch {
    return null;
  }
}

app.get('/api/beat-raise', async (req, res) => {
  try {
    const since = new Date();
    since.setDate(since.getDate() - 14);
    const rows = await db.breakoutSignal.findMany({
      where: { createdAt: { gte: since }, epsBeat: true, earningsGuidance: 'raised', ...regionWhere(regionOf(req)) },
      orderBy: { createdAt: 'desc' },
    });

    // Most recent scan per asset wins.
    const byAsset = new Map();
    for (const r of rows) if (!byAsset.has(r.asset)) byAsset.set(r.asset, r);
    const candidates = [...byAsset.values()];

    // Keep only names with two consecutive quarters of EPS growth: eps[0] > eps[1] > eps[2].
    const results = [];
    for (const c of candidates) {
      const eps = await getQuarterlyEps(c.asset);
      if (!eps || eps.length < 3) continue;
      if (!(eps[0] > eps[1] && eps[1] > eps[2])) continue;
      results.push({
        asset: c.asset,
        currentPrice: c.currentPrice,
        sector: c.sector,
        industry: c.industry,
        epsGrowthPct: c.epsGrowthPct,
        epsSurprisePct: c.epsSurprisePct,
        earningsGuidance: c.earningsGuidance,
        earningsTone: c.earningsTone,
        earningsQuarter: c.earningsQuarter,
        earningsYear: c.earningsYear,
        breakoutType: c.breakoutType,
        confidence: c.confidence,
        epsQuarters: eps.slice(0, 3), // [latest, prev, prev2]
        createdAt: c.createdAt,
      });
    }
    // Biggest surprise first.
    results.sort((a, b) => (b.epsSurprisePct ?? 0) - (a.epsSurprisePct ?? 0));

    res.json({ generatedAt: new Date().toISOString(), count: results.length, stocks: results });
  } catch (error) {
    console.error('[/api/beat-raise] failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Format a Date as local YYYY-MM-DD (the same day-frame the scan-session logic uses).
const localDay = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

app.get('/api/unusual-volume', async (req, res) => {
  try {
    // Latest scan session anchors "today": off-hours the UTC day rolls over
    // before the next session runs, which would empty the panel.
    const latest = await db.breakoutSignal.findFirst({
      where: regionWhere(regionOf(req)),
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const latestDate = latest ? localDay(new Date(latest.createdAt)) : localDay(new Date());

    // ?date=YYYY-MM-DD scopes to that scan day; default = latest. Parse with an
    // explicit time so it lands on LOCAL midnight (matching the day-frame above),
    // not UTC midnight.
    const dateParam = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : latestDate;
    const dayStart = new Date(`${dateParam}T00:00:00`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    // volumeRatio = volume / avgVolume, so >= 2 means 100%+ above average.
    // bullishCandle => the move was on the upside.
    const rows = await db.breakoutSignal.findMany({
      where: { createdAt: { gte: dayStart, lt: dayEnd }, volumeRatio: { gte: 2 }, bullishCandle: true, ...regionWhere(regionOf(req)) },
      orderBy: { createdAt: 'desc' },
    });

    // Most recent scan per asset wins.
    const byAsset = new Map();
    for (const r of rows) if (!byAsset.has(r.asset)) byAsset.set(r.asset, r);
    const stocks = [...byAsset.values()]
      .map((c) => {
        // Same display confidence the Signals list uses, so we can tag movers
        // that surged on volume but aren't actionable (e.g. over-extended Type3).
        const isExtension = c.breakoutType === 'Type3';
        const entry = c.entryPrice != null ? Number(c.entryPrice) : null;
        const pctGainFromEntry = (isExtension && entry > 0)
          ? ((c.currentPrice - entry) / entry) * 100
          : null;
        const displayConfidence = displayConfidenceFor(c.confidence, isExtension, pctGainFromEntry);
        return {
          asset: c.asset,
          currentPrice: c.currentPrice,
          sector: c.sector,
          industry: c.industry,
          volumeRatio: c.volumeRatio,
          breakoutType: c.breakoutType,
          confidence: c.confidence,
          displayConfidence,
          lowConfidence: displayConfidence < 80, // below the actionable Signals bar
          createdAt: c.createdAt,
        };
      })
      .sort((a, b) => (b.volumeRatio ?? 0) - (a.volumeRatio ?? 0)); // biggest surge first

    res.json({ generatedAt: new Date().toISOString(), date: dateParam, latestDate, count: stocks.length, stocks });
  } catch (error) {
    console.error('[/api/unusual-volume] failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Resolve the signed-in user's local row. requireAuth() guarantees a session,
// so getAuth().userId is always present here.
async function reqUser(req) {
  const { userId } = getAuth(req);
  return ensureUser(userId);
}

// Verify a list belongs to the signed-in user before any read/write on it.
async function ownedList(req, listId) {
  const user = await reqUser(req);
  return db.shortlistList.findFirst({ where: { id: listId, userId: user.id } });
}

// Lists for the signed-in user. Auto-creates a default so the UI always has one.
app.get('/api/shortlist-lists', requireAuth(), async (req, res) => {
  try {
    const user = await reqUser(req);
    let lists = await db.shortlistList.findMany({
      where: { userId: user.id },
      orderBy: { order: 'asc' },
      include: { _count: { select: { items: true } } },
    });
    if (lists.length === 0) {
      const created = await db.shortlistList.create({ data: { userId: user.id, name: 'My List', order: 0 } });
      lists = [{ ...created, _count: { items: 0 } }];
    }
    res.json(lists.map((l) => ({ id: l.id, name: l.name, order: l.order, count: l._count.items })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/shortlist-lists', requireAuth(), async (req, res) => {
  try {
    const user = await reqUser(req);
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const max = await db.shortlistList.aggregate({ where: { userId: user.id }, _max: { order: true } });
    const list = await db.shortlistList.create({ data: { userId: user.id, name, order: (max._max.order ?? -1) + 1 } });
    res.json(list);
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ error: 'A list with that name already exists' });
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/shortlist-lists/:id', requireAuth(), async (req, res) => {
  try {
    if (!(await ownedList(req, req.params.id))) return res.status(404).json({ error: 'not found' });
    const data = {};
    if (typeof req.body.name === 'string') data.name = req.body.name.trim();
    if (typeof req.body.order === 'number') data.order = req.body.order;
    const list = await db.shortlistList.update({ where: { id: req.params.id }, data });
    res.json(list);
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ error: 'A list with that name already exists' });
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/shortlist-lists/:id', requireAuth(), async (req, res) => {
  try {
    const user = await reqUser(req);
    const r = await db.shortlistList.deleteMany({ where: { id: req.params.id, userId: user.id } });
    if (r.count === 0) return res.status(404).json({ error: 'not found' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/shortlist', requireAuth(), async (req, res) => {
  try {
    const { listId } = req.query;
    if (!listId || !(await ownedList(req, listId))) return res.status(404).json({ error: 'list not found' });
    const items = await db.shortlist.findMany({ where: { listId }, orderBy: { addedAt: 'desc' } });
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/shortlist', requireAuth(), async (req, res) => {
  try {
    const { listId, asset } = req.body;
    if (!listId || !(await ownedList(req, listId))) return res.status(404).json({ error: 'list not found' });
    const item = await db.shortlist.upsert({
      where: { listId_asset: { listId, asset } },
      update: { updatedAt: new Date() },
      create: { listId, asset },
    });
    res.json(item);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/shortlist/:listId/:asset', requireAuth(), async (req, res) => {
  try {
    const { listId, asset } = req.params;
    if (!(await ownedList(req, listId))) return res.status(404).json({ error: 'list not found' });
    await db.shortlist.deleteMany({ where: { listId, asset } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/removed-assets', async (req, res) => {
  try {
    const { asset } = req.body;
    const item = await db.removedAsset.upsert({
      where: { asset },
      update: { removedAt: new Date() },
      create: { asset, id: randomUUID() },
    });
    res.json(item);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/removed-assets/:asset', async (req, res) => {
  try {
    const { asset } = req.params;
    await db.removedAsset.delete({ where: { asset } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/transcript/:symbol/analyze', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const { getOrAnalyzeTranscript } = await import('./dist/tools/transcript-analysis.js');
    const analysis = await getOrAnalyzeTranscript(symbol);
    if (!analysis) {
      return res.status(404).json({ error: 'No transcript available for ' + symbol });
    }
    res.json({
      asset: analysis.asset,
      quarter: analysis.quarter,
      year: analysis.year,
      tone: analysis.tone,
      toneScore: analysis.toneScore,
      guidanceDirection: analysis.guidanceDirection,
      riskFlags: analysis.riskFlags,
      highlights: analysis.highlights,
      summary: analysis.summary,
      modelUsed: analysis.modelUsed,
      createdAt: analysis.createdAt,
    });
  } catch (error) {
    console.error('[Transcript on-demand] failed:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/transcript/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const analysis = await db.transcriptAnalysis.findFirst({
      where: { asset: symbol.toUpperCase() },
      orderBy: [{ year: 'desc' }, { quarter: 'desc' }],
    });
    if (!analysis) return res.json(null);
    res.json({
      asset: analysis.asset,
      quarter: analysis.quarter,
      year: analysis.year,
      tone: analysis.tone,
      toneScore: analysis.toneScore,
      guidanceDirection: analysis.guidanceDirection,
      riskFlags: analysis.riskFlags,
      highlights: analysis.highlights,
      summary: analysis.summary,
      modelUsed: analysis.modelUsed,
      createdAt: analysis.createdAt,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Chart candles come from Yahoo's keyless v8 API, NOT FMP — this keeps chart
// views off the FMP bandwidth budget (charts were 500-bar fetches competing with
// the scanner) and keeps them working while FMP is rate-limited. FMP is the
// fallback if Yahoo is unavailable. 30m cache, stale-on-total-failure.
const candlesCache = new Map(); // symbol -> { bars, expiresAt }
const CANDLES_TTL_MS = 30 * 60 * 1000; // 30m

// bars: [{ time:'YYYY-MM-DD', open, high, low, close, volume }] ascending — the
// shape lightweight-charts expects.
async function fetchYahooCandles(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1d`;
  const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!resp.ok) throw new Error(`Yahoo ${resp.status}`);
  const r = (await resp.json())?.chart?.result?.[0];
  const ts = r?.timestamp;
  const q = r?.indicators?.quote?.[0];
  if (!ts || !q) throw new Error('Yahoo: empty result');
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    if (o == null || h == null || l == null || c == null) continue; // skip gap bars
    bars.push({ time: new Date(ts[i] * 1000).toISOString().slice(0, 10), open: o, high: h, low: l, close: c, volume: q.volume[i] ?? 0 });
  }
  return bars;
}

async function fetchFmpCandles(symbol) {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) throw new Error('FMP_API_KEY not set');
  const resp = await fetch(`https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${encodeURIComponent(symbol)}&limit=500&apikey=${apiKey}`);
  if (!resp.ok) throw new Error(`FMP ${resp.status}`);
  const data = await resp.json();
  const rows = Array.isArray(data) ? data : (data.historical || data.results || []);
  return rows
    .reverse()
    .map(b => ({ time: b.date, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }))
    .filter(b => b.time && b.open && b.high && b.low && b.close);
}

app.get('/api/candles/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const cached = candlesCache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) return res.json(cached.bars);

  let bars;
  try {
    bars = await fetchYahooCandles(symbol);
  } catch (yErr) {
    console.warn(`[/api/candles] Yahoo failed for ${symbol}: ${yErr.message}; falling back to FMP`);
    try {
      bars = await fetchFmpCandles(symbol);
    } catch (fErr) {
      if (cached) return res.json(cached.bars); // stale beats a broken chart
      console.error(`[/api/candles] both sources failed for ${symbol}: ${fErr.message}`);
      return res.status(502).json({ error: `candles unavailable: ${fErr.message}` });
    }
  }

  if (!bars || !bars.length) return res.json(cached ? cached.bars : []);
  console.log(`[/api/candles] ${symbol} = ${bars.length} bars`);
  candlesCache.set(symbol, { bars, expiresAt: Date.now() + CANDLES_TTL_MS });
  res.json(bars);
});

// Shared historical-closes cache reused by /api/sparklines and /api/backtest.
// Stores {date, close}[] going back further than sparklines need so the backtest
// can look up forward returns without re-fetching.
const historicalCache = new Map(); // symbol -> { data: [{date, close}], expiresAt }
const HISTORICAL_TTL_MS = 60 * 60 * 1000; // 1h

async function getHistoricalCloses(symbol, minBars = 40) {
  const now = Date.now();
  const cached = historicalCache.get(symbol);
  if (cached && cached.expiresAt > now && cached.data.length >= minBars) {
    return cached.data;
  }
  // Yahoo first (keyless, off the FMP budget) via the shared candle fetcher;
  // FMP fallback. Both yield {date, close}[] oldest-first.
  let closes = null;
  try {
    const bars = await fetchYahooCandles(symbol); // ascending {time,open,...,close}
    closes = bars
      .map((b) => ({ date: b.time, close: Number(b.close) }))
      .filter((b) => b.date && Number.isFinite(b.close));
  } catch { /* fall through to FMP */ }

  if (!closes || closes.length < 2) {
    const apiKey = process.env.FMP_API_KEY;
    if (apiKey) {
      try {
        const r = await fetch(`https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${encodeURIComponent(symbol)}&limit=${minBars}&apikey=${apiKey}`);
        if (r.ok) {
          const data = await r.json();
          const bars = Array.isArray(data) ? data : (data.historical || data.results || []);
          // Newest-first from FMP → reverse to oldest-first for date-ordered lookup.
          closes = bars
            .slice(0, minBars)
            .reverse()
            .map((b) => ({ date: String(b?.date || '').slice(0, 10), close: Number(b?.close) }))
            .filter((b) => b.date && Number.isFinite(b.close));
        }
      } catch { /* ignore, handled below */ }
    }
  }

  if (!closes || closes.length < 2) return null;
  historicalCache.set(symbol, { data: closes, expiresAt: now + HISTORICAL_TTL_MS });
  return closes;
}

// Sparklines: cached daily-close series for dashboard row micro-charts.
// Fetches ~30 EOD bars per symbol from FMP with bounded concurrency + 15min TTL.
const sparklineCache = new Map(); // symbol -> { data: number[], expiresAt: number }
const SPARKLINE_TTL_MS = 15 * 60 * 1000;

app.post('/api/sparklines', async (req, res) => {
  const symbols = Array.isArray(req.body?.symbols)
    ? req.body.symbols.filter((s) => typeof s === 'string').slice(0, 200)
    : [];
  const now = Date.now();
  const result = {};
  const missing = [];
  for (const s of symbols) {
    const cached = sparklineCache.get(s);
    if (cached && cached.expiresAt > now) result[s] = cached.data;
    else missing.push(s);
  }

  if (missing.length) {
    const CONCURRENCY = 8;
    for (let i = 0; i < missing.length; i += CONCURRENCY) {
      const chunk = missing.slice(i, i + CONCURRENCY);
      await Promise.allSettled(
        chunk.map(async (sym) => {
          const closes = await getHistoricalCloses(sym, 30);
          if (!closes) return;
          const values = closes.map((c) => c.close);
          if (values.length >= 2) {
            sparklineCache.set(sym, { data: values, expiresAt: now + SPARKLINE_TTL_MS });
            result[sym] = values;
          }
        }),
      );
    }
  }
  res.json(result);
});

// Market Pulse: public feed of social-sentiment trending + market news, with
// each ticker cross-referenced against our live signals. Two market-wide FMP
// calls per cache-miss, cached server-side for ALL visitors → negligible
// bandwidth (no per-ticker fan-out).
let pulseCache = null; // { data, expiresAt }
const PULSE_TTL_MS = 10 * 60 * 1000; // 10 min

app.get('/api/pulse', async (req, res) => {
  if (pulseCache && pulseCache.expiresAt > Date.now()) {
    return res.json({ ...pulseCache.data, cached: true });
  }
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'FMP_API_KEY not set' });

  try {
    const [trendRaw, newsRaw] = await Promise.all([
      fetch(`https://financialmodelingprep.com/api/v4/social-sentiments/trending?type=bullish&source=stocktwits&apikey=${apiKey}`)
        .then((r) => (r.ok ? r.json() : [])).catch(() => []),
      fetch(`https://financialmodelingprep.com/stable/news/general-latest?limit=18&apikey=${apiKey}`)
        .then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]);

    const trending = (Array.isArray(trendRaw) ? trendRaw : []).slice(0, 12).map((t) => ({
      symbol: t.symbol,
      name: t.name || null,
      sentiment: Number(t.sentiment) || 0,           // 0..1
      lastSentiment: Number(t.lastSentiment) || 0,   // prior reading → momentum
    }));
    const news = (Array.isArray(newsRaw) ? newsRaw : []).slice(0, 12).map((n) => ({
      symbol: n.symbol || null,
      title: n.title,
      publisher: n.publisher || n.site || null,
      image: n.image || null,
      url: n.url || null,
      publishedDate: n.publishedDate || null,
    }));

    // One DB pass: which of these tickers have a live signal (last 14 days)?
    const symbols = [...new Set([
      ...trending.map((t) => t.symbol),
      ...news.map((n) => n.symbol),
    ].filter(Boolean))];
    const sigMap = {};
    if (symbols.length) {
      const sigs = await db.breakoutSignal.findMany({
        where: {
          asset: { in: symbols },
          createdAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
        },
        orderBy: { createdAt: 'desc' },
        distinct: ['asset'],
        select: { asset: true, breakoutType: true, confidence: true },
      });
      for (const s of sigs) {
        sigMap[s.asset] = { breakoutType: s.breakoutType, confidence: Number(s.confidence) };
      }
    }
    const attach = (item) => ({ ...item, signal: item.symbol ? sigMap[item.symbol] || null : null });

    const data = {
      generatedAt: new Date().toISOString(),
      trending: trending.map(attach),
      news: news.map(attach),
      signalCount: Object.keys(sigMap).length,
      cached: false,
    };
    pulseCache = { data, expiresAt: Date.now() + PULSE_TTL_MS };
    res.json(data);
  } catch (error) {
    console.error('[/api/pulse] failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Per-ticker social sentiment + recent news for the dashboard drawer. On-demand
// (one open = one cache-miss = 2 FMP calls), cached per symbol → bandwidth-safe.
const tickerPulseCache = new Map(); // symbol -> { data, expiresAt }
const TICKER_PULSE_TTL_MS = 15 * 60 * 1000; // 15 min

app.get('/api/ticker-pulse/:symbol', async (req, res) => {
  const symbol = String(req.params.symbol || '').toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  const cached = tickerPulseCache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) return res.json({ ...cached.data, cached: true });
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'FMP_API_KEY not set' });

  try {
    const [sentRaw, newsRaw] = await Promise.all([
      fetch(`https://financialmodelingprep.com/api/v4/historical/social-sentiment?symbol=${encodeURIComponent(symbol)}&page=0&apikey=${apiKey}`)
        .then((r) => (r.ok ? r.json() : [])).catch(() => []),
      fetch(`https://financialmodelingprep.com/stable/news/stock?symbols=${encodeURIComponent(symbol)}&limit=5&apikey=${apiKey}`)
        .then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]);

    // Blend StockTwits + X bullishness, weighted by post volume.
    const combine = (row) => {
      if (!row) return null;
      const st = Number(row.stocktwitsSentiment), tw = Number(row.twitterSentiment);
      const stP = Number(row.stocktwitsPosts) || 0, twP = Number(row.twitterPosts) || 0;
      const parts = [];
      if (Number.isFinite(st)) parts.push([st, stP || 1]);
      if (Number.isFinite(tw)) parts.push([tw, twP || 1]);
      if (!parts.length) return null;
      const wsum = parts.reduce((a, [, w]) => a + w, 0);
      return {
        bullish: parts.reduce((a, [v, w]) => a + v * w, 0) / wsum,
        posts: stP + twP,
        impressions: (Number(row.stocktwitsImpressions) || 0) + (Number(row.twitterImpressions) || 0),
      };
    };

    // Per-ticker history is too sparse/noisy for a reliable momentum read
    // (thin-volume hours report 0), so we surface only the latest bullish level.
    const arr = Array.isArray(sentRaw) ? sentRaw : [];
    const latest = combine(arr[0]);
    const sentiment = latest ? {
      bullishPct: Math.round(latest.bullish * 100),
      posts: latest.posts,
      impressions: latest.impressions,
      asOf: arr[0]?.date || null,
    } : null;

    const news = (Array.isArray(newsRaw) ? newsRaw : []).slice(0, 5).map((n) => ({
      title: n.title,
      publisher: n.publisher || n.site || null,
      url: n.url || null,
      publishedDate: n.publishedDate || null,
    }));

    const data = { symbol, sentiment, news, cached: false };
    tickerPulseCache.set(symbol, { data, expiresAt: Date.now() + TICKER_PULSE_TTL_MS });
    res.json(data);
  } catch (error) {
    console.error('[/api/ticker-pulse] failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Backtest: aggregate historical signal performance.
// Pulls first Type1/Type3 signal per asset in the lookback window, computes
// forward return at `horizon` days using cached FMP historical closes, and
// returns summary stats + tier/sector breakdowns + recent-signal list.
const backtestCache = new Map(); // cacheKey -> { data, expiresAt }
const BACKTEST_TTL_MS = 6 * 60 * 60 * 1000; // 6h

app.get('/api/backtest', async (req, res) => {
  const horizon = Math.min(60, Math.max(1, parseInt(req.query.horizon) || 10));
  const lookback = Math.min(180, Math.max(7, parseInt(req.query.lookback) || 90));
  const type = req.query.type === 'Type3' ? 'Type3' : 'Type1';

  const cacheKey = `${type}:${lookback}:${horizon}`;
  const cached = backtestCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return res.json({ ...cached.data, cached: true });
  }

  try {
    // First signal per asset in [lookback+horizon+5 .. horizon] window.
    // Excludes signals too recent to have finished the forward window.
    // Using MAKE_INTERVAL(days => ..::int) avoids Prisma int-coercion issues with INTERVAL * int.
    const startDaysAgo = lookback + horizon + 5;
    const endDaysAgo = horizon;
    const signals = await db.$queryRaw`
      SELECT DISTINCT ON (asset)
        asset,
        "createdAt",
        "currentPrice",
        confidence,
        sector,
        "signalDate"
      FROM "BreakoutSignal"
      WHERE "breakoutType" = ${type}
        AND "createdAt" > NOW() - MAKE_INTERVAL(days => ${startDaysAgo}::int)
        AND "createdAt" < NOW() - MAKE_INTERVAL(days => ${endDaysAgo}::int)
      ORDER BY asset, "createdAt" ASC
    `;
    console.log(`[/api/backtest] ${type} ${lookback}d/${horizon}d: ${signals.length} candidate signals`);

    const evaluated = [];
    const uniqueAssets = [...new Set(signals.map((s) => s.asset))];
    const CONCURRENCY = 8;
    // Need enough bars to cover lookback + horizon window with buffer.
    const barCount = lookback + horizon + 15;
    let fetched = 0, skippedPrice = 0, skippedIdx = 0;

    for (let i = 0; i < uniqueAssets.length; i += CONCURRENCY) {
      const batch = uniqueAssets.slice(i, i + CONCURRENCY);
      await Promise.allSettled(
        batch.map(async (sym) => {
          const closes = await getHistoricalCloses(sym, barCount);
          if (!closes || closes.length < horizon + 1) {
            skippedPrice++;
            return;
          }
          fetched++;
          const sigsForAsset = signals.filter((s) => s.asset === sym);
          for (const sig of sigsForAsset) {
            // Prisma returns DateTime as a JS Date; must go through toISOString to get YYYY-MM-DD.
            // String(dateObj) yields "Fri May 29 2026..." which fails lexicographic comparison against ISO close dates.
            const rawDate = sig.signalDate || sig.createdAt;
            const dateStr = (rawDate instanceof Date ? rawDate : new Date(rawDate))
              .toISOString()
              .slice(0, 10);
            const idx = closes.findIndex((c) => c.date >= dateStr);
            if (idx === -1) { skippedIdx++; continue; }
            const targetIdx = idx + horizon;
            if (targetIdx >= closes.length) { skippedIdx++; continue; }
            const entry = closes[idx].close;
            const exit = closes[targetIdx].close;
            if (!entry || !exit) continue;
            const returnPct = ((exit - entry) / entry) * 100;
            evaluated.push({
              asset: sig.asset,
              signalDate: closes[idx].date,
              entryPrice: entry,
              exitPrice: exit,
              exitDate: closes[targetIdx].date,
              returnPct,
              confidence: Number(sig.confidence) * 100,
              sector: sig.sector || 'Unknown',
            });
          }
        }),
      );
    }

    // Overall summary. The whole panel models an 8% stop-loss, so every
    // magnitude stat (avg/median/worst) uses returns capped at -8% — otherwise
    // a "worst -15%" under an "8% stop" caption contradicts itself. Win rate and
    // best are computed on raw returns (a stop caps losses, never gains).
    const cappedReturns = evaluated.map((e) => Math.max(-8, e.returnPct));
    const totalReturn = evaluated.reduce((s, e) => s + e.returnPct, 0);
    const cappedTotalReturn = cappedReturns.reduce((s, r) => s + r, 0);
    const wins = evaluated.filter((e) => e.returnPct > 0).length;
    const sortedReturns = [...cappedReturns].sort((a, b) => a - b);
    const median = sortedReturns.length
      ? sortedReturns[Math.floor(sortedReturns.length / 2)]
      : 0;
    const bestReturn = evaluated.length ? Math.max(...evaluated.map((e) => e.returnPct)) : 0;
    const worstReturn = sortedReturns.length ? sortedReturns[0] : 0;

    // By confidence tier
    const tiers = [
      { label: '95-99%', min: 95, max: 100 },
      { label: '90-94%', min: 90, max: 95 },
      { label: '85-89%', min: 85, max: 90 },
      { label: '80-84%', min: 80, max: 85 },
    ];
    const byTier = tiers.map((t) => {
      const rows = evaluated.filter((e) => e.confidence >= t.min && e.confidence < t.max);
      if (!rows.length) return { ...t, count: 0, avgReturn: 0, medianReturn: 0, winRate: 0 };
      // Capped (8% stop) for magnitude; raw for win rate — matches the headline.
      const rs = rows.map((r) => Math.max(-8, r.returnPct)).sort((a, b) => a - b);
      const avg = rs.reduce((a, b) => a + b, 0) / rs.length;
      const med = rs[Math.floor(rs.length / 2)];
      const winsInTier = rows.filter((r) => r.returnPct > 0).length;
      return {
        ...t,
        count: rows.length,
        avgReturn: avg,
        medianReturn: med,
        winRate: (winsInTier / rows.length) * 100,
      };
    });

    // By sector
    const sectorMap = {};
    for (const e of evaluated) {
      const sec = e.sector || 'Unknown';
      (sectorMap[sec] || (sectorMap[sec] = [])).push(e.returnPct);
    }
    const bySector = Object.entries(sectorMap)
      .map(([sector, returns]) => ({
        sector,
        count: returns.length,
        avgReturn: returns.reduce((a, b) => a + Math.max(-8, b), 0) / returns.length,
        winRate: (returns.filter((r) => r > 0).length / returns.length) * 100,
      }))
      .filter((s) => s.count >= 2) // hide singleton sectors
      .sort((a, b) => b.avgReturn - a.avgReturn);

    const recent = [...evaluated]
      .sort((a, b) => b.signalDate.localeCompare(a.signalDate))
      .slice(0, 25);

    console.log(`[/api/backtest] ${type}: ${uniqueAssets.length} unique assets → priced ${fetched}, skipped-no-price ${skippedPrice}, skipped-idx ${skippedIdx} → ${evaluated.length} evaluated`);

    const result = {
      params: { type, lookback, horizon },
      generatedAt: new Date().toISOString(),
      summary: {
        totalSignals: evaluated.length,
        uniqueAssets: uniqueAssets.length,
        avgReturn: evaluated.length ? cappedTotalReturn / evaluated.length : 0,
        avgReturnRaw: evaluated.length ? totalReturn / evaluated.length : 0,
        stopLossPct: 8,
        medianReturn: median,
        winRate: evaluated.length ? (wins / evaluated.length) * 100 : 0,
        bestReturn,
        worstReturn,
      },
      byTier,
      bySector,
      recent,
      cached: false,
    };
    backtestCache.set(cacheKey, { data: result, expiresAt: Date.now() + BACKTEST_TTL_MS });
    res.json(result);
  } catch (error) {
    console.error('[/api/backtest] failed:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`📊 Dashboard running on http://localhost:${PORT}`);
  console.log(`   • API: http://localhost:${PORT}/api/signals`);
  console.log(`   • Trigger scan: POST http://localhost:${PORT}/api/scan`);
});
