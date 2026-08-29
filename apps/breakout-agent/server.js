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
import { postXThread, postXThreadDetailed } from './dist/x-post.js';
import { renderScorecardPng, renderMarketHealthPng, metaFor, metaHtml } from './og-card.js';
import { detectBases } from './base-detect.js';
import { handleMcpRequest } from './mcp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const db = new PrismaClient();

// Runtime FMP kill switch (admin-togglable, stored in RuntimeFlag; env
// FMP_DISABLED=true is a hard override). 30s cache keeps it off the hot path.
// MUST be declared before any top-level startup call that awaits fmpOff()
// (refreshPoliticianBuys runs at module load) — a later `let` is a TDZ
// ReferenceError that crash-loops the whole server.
let fmpFlagCache = { value: false, expires: 0 };
async function fmpOff() {
  if (process.env.FMP_DISABLED === 'true') return true;
  if (Date.now() < fmpFlagCache.expires) return fmpFlagCache.value;
  let v = false;
  try {
    const row = await db.runtimeFlag.findUnique({ where: { key: 'fmp_disabled' } });
    v = row?.value === 'true';
  } catch { /* table may not exist mid-rollout */ }
  fmpFlagCache = { value: v, expires: Date.now() + 30 * 1000 };
  return v;
}

// Politician (Senate) purchases cache. Refreshes every 12h — the source
// disclosures trickle in, no need to hammer it. In-memory only: on process
// restart we refetch, no DB persistence required.
// symbol → { name, office, transactionDate, disclosureDate, amount, link }
const politicianBuysBySymbol = new Map();
async function refreshPoliticianBuys() {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return;
  if (await fmpOff()) return;
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
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID; // monthly ($49/mo)
const STRIPE_PRICE_ID_YEARLY = process.env.STRIPE_PRICE_ID_YEARLY; // annual ($449/yr)
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
  // Anonymous: send to the landing with the intended destination preserved, so
  // the landing can open Clerk sign-in and return the user to where they were
  // headed (e.g. a /$TICKER deep link from the pulse page) instead of dumping
  // them on the homepage.
  if (!userId) return res.redirect('/?ref=dashboard&next=' + encodeURIComponent(req.originalUrl));

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

app.get(/^\/og\/([A-Za-z.\-]+)\.png$/, async (req, res, next) => {
  try {
    const ticker = req.params[0].toUpperCase();
    // /og/pulse.png is the market-health card, registered later — not a ticker.
    if (ticker === 'PULSE') return next();
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
    res.type('html').send(metaHtml(metaFor(s, `${origin}/og/${ticker}.png?v=${encodeURIComponent(String(s.id || 'na').slice(-10))}`, `${origin}${req.path}`)));
  } catch (error) {
    console.error('[deep-link og] failed:', error);
    next();
  }
});
app.get(/^\/\$[A-Za-z.\-]+$/, paywall, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Cashtag-free alias for the same deep link: X limits posts to ONE cashtag,
// and "/$NVDA" inside a tweeted URL counts as a second one. Tweets link
// /s/NVDA instead; behavior is identical to /$NVDA.
app.get('/s/:symbol([A-Za-z.\\-]+)', async (req, res, next) => {
  if (!isCrawler(req.get('user-agent'))) return next();
  try {
    const ticker = req.params.symbol.toUpperCase();
    const s = (await latestSignalFor(ticker)) || { asset: ticker };
    const proto = req.get('x-forwarded-proto') || req.protocol;
    const origin = `${proto}://${req.get('host')}`;
    res.type('html').send(metaHtml(metaFor(s, `${origin}/og/${ticker}.png?v=${encodeURIComponent(String(s.id || 'na').slice(-10))}`, `${origin}${req.path}`)));
  } catch (error) {
    console.error('[deep-link og /s] failed:', error);
    next();
  }
});
app.get('/s/:symbol([A-Za-z.\\-]+)', paywall, (req, res) => {
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

  // Plan selection: monthly (default) or yearly. Yearly quietly falls back to
  // monthly until STRIPE_PRICE_ID_YEARLY is configured — never 500 a signup.
  const plan = req.body?.plan === 'yearly' && STRIPE_PRICE_ID_YEARLY ? 'yearly' : 'monthly';
  const priceId = plan === 'yearly' ? STRIPE_PRICE_ID_YEARLY : STRIPE_PRICE_ID;

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
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      trial_period_days: 30,
      metadata: { clerkUserId: userId, plan },
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

// RS backfill: rows written before the RS pipeline existed (or during universe
// warm-up) carry rsRating null forever. Fill nulls from the CURRENT fresh
// universe — honest only for recent rows (RS drifts), so cap at 7 days back.
// Idempotent (touches only nulls); runs at boot and every 6h as self-healing.
async function backfillRecentRs() {
  try {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const universe = await db.assetReturn.findMany({
      where: { updatedAt: { gte: dayAgo } },
      select: { asset: true, assetType: true, region: true, rsScore: true, sector: true },
    });
    if (universe.length < 50) return;
    const groups = new Map(); // region:assetType -> sorted scores
    const byAsset = new Map();
    for (const r of universe) {
      const k = `${r.region}:${r.assetType}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r.rsScore);
      byAsset.set(r.asset, r);
    }
    for (const list of groups.values()) list.sort((a, b) => a - b);
    const rankOf = (r) => {
      const g = groups.get(`${r.region}:${r.assetType}`);
      if (!g || g.length < 20) return null;
      let lo = 0, hi = g.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (g[mid] < r.rsScore) lo = mid + 1; else hi = mid; }
      return Math.min(99, Math.max(1, Math.round((lo / g.length) * 99)));
    };
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const rows = await db.breakoutSignal.findMany({
      where: { rsRating: null, createdAt: { gte: cutoff } },
      select: { asset: true },
      distinct: ['asset'],
    });
    let updated = 0;
    for (const { asset } of rows) {
      const ar = byAsset.get(asset);
      if (!ar) continue;
      const rating = rankOf(ar);
      if (rating == null) continue;
      const r = await db.breakoutSignal.updateMany({
        where: { asset, rsRating: null, createdAt: { gte: cutoff } },
        data: { rsRating: rating },
      });
      updated += r.count;
    }
    if (updated) console.log(`[rs-backfill] filled ${updated} rows across ${rows.length} assets (universe ${universe.length})`);

    // Sector heal: Yahoo-mode rows are born 'Unclassified' — repair recent ones
    // from the per-asset sector memory in AssetReturn.
    const sectorRows = await db.breakoutSignal.findMany({
      where: { sector: 'Unclassified', createdAt: { gte: cutoff } },
      select: { asset: true },
      distinct: ['asset'],
    });
    let sectorFixed = 0;
    for (const { asset } of sectorRows) {
      let known = byAsset.get(asset)?.sector;
      if (!known) {
        // Memory erased (pre-fix Yahoo-mode scans nulled it) — recover from the
        // asset's own signal history and write it back into AssetReturn.
        const prior = await db.breakoutSignal.findFirst({
          where: { asset, NOT: [{ sector: null }, { sector: 'Unclassified' }] },
          orderBy: { createdAt: 'desc' },
          select: { sector: true },
        });
        known = prior?.sector || null;
        if (!known) {
          // Setup rows keep sector in Signal.metadata JSON — second source.
          const rows = await db.$queryRaw`
            SELECT metadata->>'sector' AS sector FROM "Signal"
            WHERE asset = ${asset}
              AND metadata->>'sector' IS NOT NULL
              AND metadata->>'sector' <> 'Unclassified'
            ORDER BY "createdAt" DESC LIMIT 1`;
          known = rows?.[0]?.sector || null;
        }
        if (known) {
          await db.assetReturn.update({ where: { asset }, data: { sector: known } }).catch(() => {});
        }
      }
      if (!known) continue;
      const r = await db.breakoutSignal.updateMany({
        where: { asset, sector: 'Unclassified', createdAt: { gte: cutoff } },
        data: { sector: known },
      });
      sectorFixed += r.count;
    }
    if (sectorFixed) console.log(`[rs-backfill] repaired sector on ${sectorFixed} rows`);

    // VCP re-grade under the recalibrated definition (coil 0.7-0.9 + volume
    // >= 2x). Pure DB math — no external data needed. Idempotent: rows WITH
    // both metrics get the exact new verdict; old-definition badges on rows
    // missing the metrics are cleared (unverifiable = no badge).
    const regraded = await db.$executeRaw`
      UPDATE "BreakoutSignal"
      SET "isVcp" = ("breakoutType" = 'Type1' AND "coilRatio" >= 0.7 AND "coilRatio" < 0.9 AND "volumeRatio" >= 2)
      WHERE "createdAt" >= ${cutoff}
        AND "coilRatio" IS NOT NULL AND "volumeRatio" IS NOT NULL
        AND "isVcp" IS DISTINCT FROM ("breakoutType" = 'Type1' AND "coilRatio" >= 0.7 AND "coilRatio" < 0.9 AND "volumeRatio" >= 2)`;
    const cleared = await db.$executeRaw`
      UPDATE "BreakoutSignal" SET "isVcp" = false
      WHERE "createdAt" >= ${cutoff} AND "isVcp" = true
        AND ("coilRatio" IS NULL OR "volumeRatio" IS NULL)`;
    if (regraded || cleared) console.log(`[rs-backfill] VCP re-grade: ${regraded} recomputed, ${cleared} unverifiable badges cleared`);

  } catch (e) {
    console.warn('[rs-backfill] failed:', e.message);
  }

  // Cohort backfill for fresh breakouts minted before the column existed.
  // Same 8-cell grid as breakout-logic.ts: S = sky + >=80d base + >=2x vol,
  // A = any blue sky, B = long+loud without sky, C = rest. Only fills nulls
  // with all three inputs present — the scanner's own verdict is never
  // overwritten. Own error scope: an RS/FMP failure above must not starve it.
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const cohortFilled = await db.$executeRaw`
      UPDATE "BreakoutSignal"
      SET "cohort" = CASE
        WHEN "isBlueSky" AND "priorBaseDays" >= 80 AND "volumeRatio" >= 2 THEN 'S'
        WHEN "isBlueSky" THEN 'A'
        WHEN "priorBaseDays" >= 80 AND "volumeRatio" >= 2 THEN 'B'
        ELSE 'C' END
      WHERE "createdAt" >= ${cutoff} AND "cohort" IS NULL
        AND "breakoutType" IN ('Type1', 'Type1b')
        AND "volumeRatio" IS NOT NULL`;
    if (cohortFilled) console.log(`[rs-backfill] cohort backfill: graded ${cohortFilled} rows`);
  } catch (e) {
    console.warn('[rs-backfill] cohort backfill failed:', e.message);
  }
}
setTimeout(backfillRecentRs, 20 * 1000); // after boot, once DB is warm
// Every 30 min, not 6h: scanners write fresh rows every 15 min, and while the
// inline RS computation has gaps the healer must not lose that race. Cheap —
// it only ever touches null ratings / Unclassified sectors in a 7-day window.
setInterval(backfillRecentRs, 30 * 60 * 1000);

app.post('/api/admin/fmp-toggle', async (req, res) => {
  if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only — sign in as an admin user' });
  const disabled = !!req.body?.disabled;
  await db.runtimeFlag.upsert({
    where: { key: 'fmp_disabled' },
    create: { key: 'fmp_disabled', value: String(disabled) },
    update: { value: String(disabled) },
  });
  fmpFlagCache = { value: disabled, expires: Date.now() + 30 * 1000 };
  console.warn(`[FMP] admin set fmp_disabled=${disabled} — agents pick it up next scan cycle`);
  res.json({ fmpDisabled: disabled });
});

app.get('/api/admin/status', async (req, res) => {
  // dailyBars: rows in the owned EOD archive — watch it fill after the
  // DailyBar rollout and grow by ~1 bar/symbol/day thereafter.
  let dailyBars = null;
  try { dailyBars = await db.dailyBar.count(); } catch {}
  res.json({ isAdmin: await isAdmin(req), fmpDisabled: await fmpOff(), dailyBars });
});

// No requireAuth() here — that middleware redirects unauthenticated requests to
// an HTML page, which breaks fetch()'s res.json(). isAdmin() (reads getAuth via
// the global clerkMiddleware) gates it and always returns JSON.
// Single-tweet breakout card. The /$TICKER deep link unfurls the live OG
// scorecard on X. Null-safe: skips any field the row doesn't carry (e.g.
// Yahoo-mode rows lack sector/EPS; RS may lag a cycle).
function composeBreakoutTweet(asset, sig) {
  const cur = /\.(NS|BO)$/i.test(asset) ? '₹' : '$';
  const money = (v) => (v != null && Number.isFinite(Number(v)) ? cur + Number(v).toFixed(2) : null);
  const isExt = sig.breakoutType === 'Type3';
  const tags = [];
  if (sig.isVcp) tags.push('VCP');
  if (sig.isBlueSky) tags.push('Blue Sky · 52w-high base');
  if (sig.rsRating != null) tags.push(`RS ${sig.rsRating}`);
  const conf = sig.confidence != null ? Math.round(Number(sig.confidence) * 100) : null;
  // Two-tweet thread: main post is link-free (X deprioritizes posts with
  // external links) and carries the one allowed cashtag; the reply holds the
  // /$TICKER deep link — legal there since the cashtag limit is per post —
  // whose OG scorecard unfurls the chart card.
  const main = [
    `$${asset.replace(/\.(NS|BO)$/i, '')} ${isExt ? 'breakout extension' : 'breakout'} 🚨`,
    '',
    [money(sig.entryPrice) && `Entry ${money(sig.entryPrice)}`, money(sig.stopLoss) && `Stop ${money(sig.stopLoss)}`, money(sig.currentPrice) && `Now ${money(sig.currentPrice)}`]
      .filter(Boolean).join(' · '),
    [conf != null && `Confidence ${conf}/100`, ...tags].filter(Boolean).join(' · '),
    '',
    'Systematic signal — not advice.',
  ].filter((l) => l !== null).join('\n');
  // The ?s= version matters: X caches link cards BY THE TWEETED URL and won't
  // re-scrape a URL it has seen — an unversioned link can unfurl a stale card
  // forever. A fresh query per signal forces a fresh scrape.
  const ver = encodeURIComponent(String(sig.id || Date.now()).slice(-10));
  const reply = `Chart, levels & the 2-year base X-ray → https://dataquant.ai/$${encodeURIComponent(asset)}?s=${ver}`;
  return [main, reply];
}

app.post('/api/admin/tweet-breakout', async (req, res) => {
  if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only — sign in as an admin user' });
  const asset = String(req.body?.asset || '').toUpperCase().trim();
  if (!asset) return res.status(400).json({ error: 'asset required' });

  const sig = await db.breakoutSignal.findFirst({
    where: { asset, breakoutType: { in: ['Type1', 'Type1b', 'Type3'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (!sig) return res.status(404).json({ error: `No breakout signal on record for ${asset}` });

  const tweets = composeBreakoutTweet(asset, sig);
  if (!req.body?.confirm) return res.json({ preview: true, tweets });

  // The editor may send edited text; validate and prefer it over the composed draft.
  const edited = sanitizeEditedTweets(req.body?.tweets);
  if (edited?.error) return res.status(400).json({ error: edited.error });
  const toPost = edited?.tweets?.length ? edited.tweets : tweets;

  // Attach the live scorecard as media on the main tweet — an image is not a
  // link, so the visual rides the main post without reach penalty. Fails open.
  let mediaPng = null;
  try { mediaPng = renderScorecardPng(sig); } catch (e) { console.warn('[tweet-breakout] card render failed:', e.message); }

  const result = await postXThreadDetailed(toPost, mediaPng ? { mediaPng } : undefined);
  if (!result.ok) return res.status(502).json({ error: `X post failed: ${result.error}. Env issues: set X_POST_ENABLED=true + the four X_* tokens in the droplet root .env, then \`docker compose up -d dashboard\`.` });
  await db.breakoutSignal.update({ where: { id: sig.id }, data: { xPostedAt: new Date() } });
  console.log(`✓ Admin tweeted $${asset} breakout${edited?.tweets?.length ? ' (edited)' : ''}`);
  res.json({ ok: true, tweets: toPost });
});

// Edited-tweet payload guard, shared by the admin tweet endpoints.
function sanitizeEditedTweets(raw) {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return { error: 'tweets must be an array of strings' };
  const tweets = raw.map((t) => String(t)).map((t) => t.trim()).filter((t) => t.length);
  if (!tweets.length) return { error: 'no non-empty tweets provided' };
  if (tweets.length > 6) return { error: 'at most 6 tweets per thread' };
  const over = tweets.findIndex((t) => t.length > 280);
  if (over >= 0) return { error: `tweet ${over + 1} exceeds 280 characters (${tweets[over].length})` };
  return { tweets };
}

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

  const edited = sanitizeEditedTweets(req.body?.tweets);
  if (edited?.error) return res.status(400).json({ error: edited.error });
  const toPost = edited?.tweets?.length ? edited.tweets : tweets;

  const result = await postXThreadDetailed(toPost);
  if (!result.ok) return res.status(502).json({ error: `X post failed: ${result.error}. Env issues: set X_POST_ENABLED=true + the four X_* tokens in the droplet root .env, then \`docker compose up -d dashboard\`.` });
  await db.transcriptAnalysis.update({ where: { id: ta.id }, data: { xPostedAt: new Date() } });
  console.log(`✓ Admin tweeted $${asset} earnings (${toPost.length} tweets${edited?.tweets?.length ? ', edited' : ''})`);
  res.json({ ok: true, tweets: toPost });
});

// Static assets (landing.html, CSS, JS, images) remain public. Note: because
// this comes AFTER the explicit "/" handler above, root requests go to the
// landing page, not to index.html.
// extensions: ['html'] serves /learn/<slug> from learn/<slug>.html — clean
// article URLs without a route per page.
app.use(express.static('public', { extensions: ['html'] }));

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
          bs."isVcp",
          bs."rsRating",
          bs."upDownVolumeRatio",
          bs."failedPokes",
          bs."isBlueSky",
          bs."coilRatio",
          bs."isStaircase",
          bs."cohort",
          bs."volumeRatio",
          bs."priorBaseDays",
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
        "isVcp",
        "rsRating",
        "upDownVolumeRatio",
        "failedPokes",
        "isBlueSky",
        "coilRatio",
        "isStaircase",
        "cohort",
        "volumeRatio",
        "priorBaseDays",
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
      const isEp = s.breakoutType === 'EP';
      const isType1 = s.breakoutType === 'Type1';
      const isType1b = s.breakoutType === 'Type1b';
      const isType3 = s.breakoutType === 'Type3';
      const isExtension = isType3;
      const weakVolume = isType1b;

      // Stopped out: price has closed at/below the frozen stop. The trade is
      // dead — keep it visible but flag it and drop it out of alerts/high-conf.
      const stoppedOut = persistedStopLoss != null && s.currentPrice <= persistedStopLoss;

      const signalType = isEp ? 'ep' : isExtension ? 'extension' : 'breakout';
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
        // Retest: an alerted breakout whose price is back within 3% of the buy
        // point and not stopped — the actionable second-chance zone. Stays
        // signalType 'extension' internally (levels/overlays unchanged);
        // isRetest drives the badge, the filter, and the demotion exemption.
        isRetest: isExtension && !stoppedOut && pctGainFromEntry != null && pctGainFromEntry <= 3,
        isVcp: s.isVcp === true,
        rsRating: s.rsRating != null ? Number(s.rsRating) : null,
        upDownVolumeRatio: s.upDownVolumeRatio != null ? Number(s.upDownVolumeRatio) : null,
        failedPokes: s.failedPokes != null ? Number(s.failedPokes) : 0,
        isBlueSky: s.isBlueSky === true,
        coilRatio: s.coilRatio != null ? Number(s.coilRatio) : null,
        isStaircase: s.isStaircase === true,
        // Read-time fallback mirrors the scanner's 8-cell grid so rows minted
        // before the column existed still show a grade even if the DB
        // backfill hasn't caught them yet. Never overrides a stored verdict.
        cohort: s.cohort || (
          (s.breakoutType === 'Type1' || s.breakoutType === 'Type1b') && s.volumeRatio != null
            ? (s.isBlueSky && Number(s.priorBaseDays) >= 80 && Number(s.volumeRatio) >= 2 ? 'S'
              : s.isBlueSky ? 'A'
              : Number(s.priorBaseDays) >= 80 && Number(s.volumeRatio) >= 2 ? 'B' : 'C')
            : null),
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
        distanceToPivotPct: meta.distanceToPivotPct != null ? Number(meta.distanceToPivotPct) : null,
        rsRating: meta.rsRating != null ? Number(meta.rsRating) : null,
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
    // Stale extensions (>5 days past the breakout) leave the confidence buckets
    // entirely: the actionable entry window is gone, and the stopped-out list
    // shows they're where the losses live (35/35 stops were extensions, 32 of
    // them 6+ days old). They remain visible in a separate "tracking" list for
    // holders monitoring an open position — not as entry candidates.
    const isStaleExtension = (s) =>
      s.signalType === 'extension' &&
      !s.isRetest && // within 3% of the buy point = actionable at any age
      s.daysSinceBreakout != null &&
      s.daysSinceBreakout > 5 &&
      !s.stoppedOut;
    const tracking = sorted.filter(isStaleExtension);
    const highConfidence = sorted.filter(s => s.confidence >= 95 && !s.stoppedOut && !isStaleExtension(s));
    const mediumConfidence = [
      ...sorted.filter(s => s.confidence < 95 && !s.stoppedOut && !isStaleExtension(s)),
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
      tracking,
      stats: {
        highConfidenceCount: highConfidence.length,
        mediumConfidenceCount: mediumConfidence.length,
        trackingCount: tracking.length,
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
  if (await fmpOff()) return null;
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
  if (await fmpOff()) throw new Error('FMP disabled by admin flag');
  const resp = await fetch(`https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${encodeURIComponent(symbol)}&limit=500&apikey=${apiKey}`);
  if (!resp.ok) throw new Error(`FMP ${resp.status}`);
  const data = await resp.json();
  const rows = Array.isArray(data) ? data : (data.historical || data.results || []);
  return rows
    .reverse()
    .map(b => ({ time: b.date, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }))
    .filter(b => b.time && b.open && b.high && b.low && b.close);
}

// Aggregate daily bars into calendar weeks (Monday-anchored). Assumes input
// is ascending; each output bar keeps the first day's date as its time.
function resampleWeekly(bars) {
  const out = [];
  let cur = null;
  let curKey = null;
  for (const b of bars) {
    const d = new Date(b.time + 'T00:00:00Z');
    if (Number.isNaN(d.getTime())) continue;
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    if (key !== curKey) {
      if (cur) out.push(cur);
      curKey = key;
      cur = { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0 };
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume || 0;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// Cache always holds the full 2y daily set; range/tf are applied per request so
// every view shares one upstream fetch. Query: ?range=3m|6m|1y|2y (default all)
// and ?tf=d|w (default daily). Response stays a plain bar array.
const RANGE_DAYS = { '3m': 93, '6m': 186, '1y': 366, '2y': 740 };
function shapeCandles(bars, range, tf) {
  let out = bars;
  const days = RANGE_DAYS[range];
  if (days) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    out = out.filter((b) => b.time >= cutoff);
  }
  if (tf === 'w') out = resampleWeekly(out);
  return out;
}

// Shared 2y-daily-bar getter behind the cache; throws only when there is no
// fresh data AND no stale fallback. Reused by /api/candles and /api/bases.
async function getDailyCandles(symbol) {
  const cached = candlesCache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) return cached.bars;
  let bars;
  try {
    bars = await fetchYahooCandles(symbol);
  } catch (yErr) {
    console.warn(`[candles] Yahoo failed for ${symbol}: ${yErr.message}; falling back to FMP`);
    try {
      bars = await fetchFmpCandles(symbol);
    } catch (fErr) {
      if (cached) return cached.bars; // stale beats a broken chart
      throw new Error(`candles unavailable: ${fErr.message}`);
    }
  }
  if (!bars || !bars.length) {
    if (cached) return cached.bars;
    return [];
  }
  console.log(`[candles] ${symbol} = ${bars.length} bars`);
  candlesCache.set(symbol, { bars, expiresAt: Date.now() + CANDLES_TTL_MS });
  return bars;
}

app.get('/api/candles/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const { range, tf } = req.query;
  try {
    const bars = await getDailyCandles(symbol);
    res.json(shapeCandles(bars, range, tf));
  } catch (err) {
    console.error(`[/api/candles] ${symbol}: ${err.message}`);
    res.status(502).json({ error: err.message });
  }
});

// Market health: the "M" gate a breakout system needs — is this a tape that
// rewards breakouts right now? Three components, 0-100:
//   trend (0-50):        benchmark vs 50/200MA + 50MA slope
//   distribution (0-25): O'Neil distribution days in the last 25 sessions
//                        (down >=0.2% on higher volume than the prior day)
//   breadth (0-25):      % of the scanned universe with a positive 1-month
//                        return (from the same store RS ranks on)
// >=70 risk-on · 45-69 caution · <45 risk-off (avoid new entries).
const marketHealthCache = new Map(); // region -> { data, expiresAt }
async function computeMarketHealth(region) {
  const cached = marketHealthCache.get(region);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  {
    // Per-benchmark gauge: trend vs 50/200MA + slope, and O'Neil distribution
    // days over the last 25 sessions. Index volume can be missing (^NSEI often
    // reports 0) — fall back to a price-only proxy: down days of >=1%.
    const gaugeFor = (bars) => {
      const closes = bars.map(b => b.close);
      const last = closes[closes.length - 1];
      const avg = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
      const ma50 = avg(closes.slice(-50));
      const ma200 = avg(closes.slice(-200));
      const ma50Rising = ma50 > avg(closes.slice(-60, -10));
      let trendScore = 0;
      if (last > ma50) trendScore += 25;
      if (last > ma200) trendScore += 15;
      if (ma50Rising) trendScore += 10;
      const win = bars.slice(-26);
      const hasVolume = win.filter(b => (b.volume || 0) > 0).length > 20;
      let distributionDays = 0;
      for (let i = 1; i < win.length; i++) {
        const downEnough = win[i].close <= win[i - 1].close * 0.998;
        if (hasVolume) {
          if (downEnough && (win[i].volume || 0) > (win[i - 1].volume || 0)) distributionDays++;
        } else if (win[i].close <= win[i - 1].close * 0.99) {
          distributionDays++;
        }
      }
      return { trendScore, aboveMA50: last > ma50, aboveMA200: last > ma200, ma50Rising, distributionDays, volumeBased: hasVolume };
    };

    // US watches SPY AND QQQ — O'Neil's market call counts distribution on both
    // exchanges and respects the worse one; growth breakouts live on the Nasdaq.
    // Trend averages the two; distribution takes the max.
    const benchmarks = region === 'IN' ? ['^NSEI'] : ['SPY', 'QQQ'];
    const perBenchmark = {};
    for (const b of benchmarks) {
      const bars = await getDailyCandles(b);
      if (!bars || bars.length < 210) throw new Error(`only ${bars?.length ?? 0} bars for ${b}`);
      perBenchmark[b] = { ...gaugeFor(bars), asOf: bars[bars.length - 1].time };
    }
    const gauges = Object.values(perBenchmark);
    const trendScore = Math.round(gauges.reduce((s, g) => s + g.trendScore, 0) / gauges.length);
    const distributionDays = Math.max(...gauges.map(g => g.distributionDays));
    const distributionScore = Math.max(0, 25 - distributionDays * 5);
    const benchmark = benchmarks.join('+');
    const barsAsOf = gauges[0].asOf;

    // Breadth blends two horizons: 1-month anchors the regime (15 pts), the
    // last week reacts faster (10 pts). The 1w-vs-1m gap is the direction cue —
    // a week meaningfully weaker than the month means breadth is deteriorating
    // before the monthly number shows it.
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const universe = await db.assetReturn.findMany({
      where: { region, assetType: 'stock', updatedAt: { gte: dayAgo }, return1mPct: { not: null } },
      select: { return1mPct: true, return1wPct: true },
    });
    const pctPos = (f) => {
      const rows = universe.filter(r => f(r) != null);
      return rows.length >= 50 ? Math.round((rows.filter(r => f(r) > 0).length / rows.length) * 100) : null;
    };
    const breadthPct = pctPos(r => r.return1mPct);
    const breadth1wPct = pctPos(r => r.return1wPct);
    const breadthScore = breadthPct != null
      ? Math.round((breadthPct / 100) * 15) + (breadth1wPct != null ? Math.round((breadth1wPct / 100) * 10) : Math.round((breadthPct / 100) * 10))
      : 12; // neutral until populated
    const breadthDirection = breadthPct != null && breadth1wPct != null
      ? (breadth1wPct - breadthPct <= -10 ? 'deteriorating' : breadth1wPct - breadthPct >= 10 ? 'improving' : 'steady')
      : null;

    const score = trendScore + distributionScore + breadthScore;
    const regime = score >= 70 ? 'risk-on' : score >= 45 ? 'caution' : 'risk-off';
    const advice = regime === 'risk-on'
      ? 'Tape supports breakouts — normal position sizing.'
      : regime === 'caution'
        ? 'Mixed tape — take only the best setups, size down, honor stops fast.'
        : 'Defensive — avoid new entries; breakouts fail in this tape. Protect open positions.';

    const data = {
      region,
      benchmark,
      asOf: barsAsOf,
      score,
      regime,
      advice,
      components: {
        // Combined booleans are conservative: true only when EVERY benchmark agrees
        trend: {
          score: trendScore,
          max: 50,
          aboveMA50: gauges.every(g => g.aboveMA50),
          aboveMA200: gauges.every(g => g.aboveMA200),
          ma50Rising: gauges.every(g => g.ma50Rising),
          perBenchmark: Object.fromEntries(benchmarks.map(b => [b, {
            score: perBenchmark[b].trendScore,
            aboveMA50: perBenchmark[b].aboveMA50,
            aboveMA200: perBenchmark[b].aboveMA200,
            ma50Rising: perBenchmark[b].ma50Rising,
          }])),
        },
        distribution: {
          score: distributionScore,
          max: 25,
          days: distributionDays,
          window: 25,
          volumeBased: gauges.every(g => g.volumeBased),
          perBenchmark: Object.fromEntries(benchmarks.map(b => [b, perBenchmark[b].distributionDays])),
        },
        breadth: { score: breadthScore, max: 25, pctPositive1m: breadthPct, pctPositive1w: breadth1wPct, direction: breadthDirection, universe: universe.length },
      },
    };
    marketHealthCache.set(region, { data, expiresAt: Date.now() + 15 * 60 * 1000 });
    return data;
  }
}

app.get('/api/market-health', async (req, res) => {
  try {
    res.json(await computeMarketHealth(req.query.region === 'in' ? 'IN' : 'US'));
  } catch (err) {
    console.error('[/api/market-health]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// Shareable OG card for /pulse: today's market-health reading as a 1200×630
// PNG, so a shared pulse link previews with live data. 15-min cache matches
// the underlying gauge.
app.get('/og/pulse.png', async (req, res) => {
  try {
    const mh = await computeMarketHealth(req.query.region === 'in' ? 'IN' : 'US');
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=900');
    res.send(renderMarketHealthPng(mh));
  } catch (err) {
    console.error('[/og/pulse.png]', err.message);
    res.status(502).end();
  }
});

// Earnings dates for chart markers. FMP /stable/earnings returns past AND
// upcoming report dates; day-cached; fails open (empty = no markers) when FMP
// is paused or the key is missing.
const earnDatesCache = new Map(); // symbol -> { data, expiresAt }
app.get('/api/earnings-dates/:symbol', async (req, res) => {
  const symbol = String(req.params.symbol || '').toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-^]{0,11}$/.test(symbol)) return res.status(400).json({ error: 'bad symbol' });
  const cached = earnDatesCache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) return res.json(cached.data);
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey || (await fmpOff())) return res.json({ symbol, dates: [] });
  try {
    const r = await fetch(`https://financialmodelingprep.com/stable/earnings?symbol=${encodeURIComponent(symbol)}&limit=12&apikey=${apiKey}`);
    const rows = r.ok ? await r.json() : [];
    const dates = (Array.isArray(rows) ? rows : [])
      .map((x) => ({ date: String(x.date || '').slice(0, 10), reported: x.epsActual != null }))
      .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date))
      .sort((a, b) => a.date.localeCompare(b.date));
    const data = { symbol, dates };
    earnDatesCache.set(symbol, { data, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
    res.json(data);
  } catch (e) {
    res.json({ symbol, dates: [] });
  }
});

// ── Email capture (pulse page) ──────────────────────────────────────────────
const subscribeHits = new Map(); // ip -> { count, resetAt } — light abuse guard
app.post('/api/subscribe', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
  const now = Date.now();
  const hit = subscribeHits.get(ip);
  if (hit && hit.resetAt > now && hit.count >= 10) return res.status(429).json({ error: 'Too many attempts — try later' });
  subscribeHits.set(ip, hit && hit.resetAt > now ? { count: hit.count + 1, resetAt: hit.resetAt } : { count: 1, resetAt: now + 60 * 60 * 1000 });

  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: 'Enter a valid email' });
  }
  const source = String(req.body?.source || 'pulse').slice(0, 40);
  try {
    await db.emailSubscriber.upsert({ where: { email }, create: { email, source }, update: {} });
    res.json({ ok: true });
  } catch (e) {
    console.error('[subscribe]', e.message);
    res.status(500).json({ error: 'Try again in a moment' });
  }
});

// ── Scheduled X posts (US market audience only) ─────────────────────────────
// Poor-man's cron: minute tick + a RuntimeFlag date guard so restarts/multiple
// deploys never double-post. All content is US-region; NSE never tweets.
const etParts = () => {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((a, x) => (a[x.type] = x.value, a), {});
  return { day: p.weekday, hhmm: `${p.hour}:${p.minute}`, date: `${p.year}-${p.month}-${p.day}` };
};
async function oncePerDay(flagKey, date, fn) {
  try {
    const row = await db.runtimeFlag.findUnique({ where: { key: flagKey } });
    if (row?.value === date) return;
    // claim BEFORE posting so a crash can't double-post; a lost post beats a spammed feed
    await db.runtimeFlag.upsert({ where: { key: flagKey }, create: { key: flagKey, value: date }, update: { value: date } });
    await fn();
  } catch (e) {
    console.error(`[sched:${flagKey}]`, e.message);
  }
}

async function postDailyMarketHealth() {
  const mh = await computeMarketHealth('US');
  const c = mh.components || {};
  const label = mh.regime === 'risk-on' ? 'RISK-ON ✅' : mh.regime === 'caution' ? 'CAUTION ⚠️' : 'RISK-OFF 🛑';
  const dd = c.distribution?.days;
  const ddPer = c.distribution?.perBenchmark ? Object.entries(c.distribution.perBenchmark).map(([b, d]) => `${b} ${d}`).join(' · ') : '';
  const br = c.breadth?.pctPositive1m;
  const lines = [
    `Market health: ${mh.score}/100 — ${label}`,
    '',
    `Trend ${c.trend?.score ?? '—'}/50${c.trend?.aboveMA50 === false ? ' (a benchmark below its 50-day)' : ''}`,
    dd != null ? `Distribution days: ${dd} in 25 sessions${ddPer ? ` (${ddPer})` : ''}` : null,
    br != null ? `Breadth: ${br}% of ${(c.breadth?.universe || 0).toLocaleString('en-US')} stocks positive over 1m${c.breadth?.pctPositive1w != null ? ` · ${c.breadth.pctPositive1w}% 1w` : ''}` : null,
    '',
    mh.advice,
  ].filter((l) => l !== null);
  const reply = `Methodology + live gauge (free, no login) → https://dataquant.ai/pulse?d=${mh.asOf}`;
  let mediaPng = null;
  try { mediaPng = renderMarketHealthPng(mh); } catch (e) { console.warn('[daily-health] card render failed:', e.message); }
  const r = await postXThreadDetailed([lines.join('\n'), reply], mediaPng ? { mediaPng } : undefined);
  console.log(r.ok ? `✓ Daily market-health posted (${mh.score} ${mh.regime})` : `⊘ Daily market-health post failed: ${r.error}`);
}

async function postWeeklyReceipts() {
  // Honest weekly ledger: every fresh US breakout (Type1/1b) from the last 7
  // days, judged by its latest row — above entry, stopped, or underwater.
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const rows = await db.breakoutSignal.findMany({
    where: { breakoutType: { in: ['Type1', 'Type1b'] }, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    distinct: ['asset'],
    select: { asset: true, entryPrice: true, stopLoss: true, currentPrice: true },
  });
  const us = rows.filter((r) => !/\.(NS|BO)$/i.test(r.asset) && r.entryPrice > 0 && r.currentPrice > 0);
  if (us.length < 3) { console.log(`⊘ Weekly receipts: only ${us.length} signals — skipping`); return; }
  const graded = us.map((r) => ({ ...r, pct: ((r.currentPrice - r.entryPrice) / r.entryPrice) * 100, stopped: r.stopLoss != null && r.currentPrice <= r.stopLoss }));
  const winners = graded.filter((g) => !g.stopped && g.pct > 0).sort((a, b) => b.pct - a.pct);
  const stopped = graded.filter((g) => g.stopped);
  const avg = graded.reduce((s, g) => s + Math.max(-8, g.pct), 0) / graded.length;
  const fmtPct = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
  const main = [
    `This week's breakout signals — all of them, wins and losses:`,
    '',
    `${graded.length} fresh breakouts · ${winners.length} above entry · ${stopped.length} stopped (-8% cap)`,
    `Average: ${fmtPct(avg)} (equal weight, stop-capped)`,
    winners[0] ? `Best: $${winners[0].asset} ${fmtPct(winners[0].pct)}` : null,
    stopped[0] ? `Worst: stopped out — that's the discipline working` : null,
    '',
    `We publish every signal, not a highlight reel. Not advice.`,
  ].filter((l) => l !== null).join('\n');
  const reply = `Live signals, market health & methodology → https://dataquant.ai/pulse?w=${new Date().toISOString().slice(0, 10)}`;
  const r = await postXThreadDetailed([main, reply]);
  console.log(r.ok ? `✓ Weekly receipts posted (${graded.length} signals, avg ${fmtPct(avg)})` : `⊘ Weekly receipts failed: ${r.error}`);
}

setInterval(() => {
  const t = etParts();
  if (t.hhmm === '09:00') oncePerDay('daily_health_post', t.date, postDailyMarketHealth);
  if (t.day === 'Sat' && t.hhmm === '11:00') oncePerDay('weekly_receipts_post', t.date, postWeeklyReceipts);
}, 60 * 1000);

// Sector strength: roll the cross-sectional returns store up by sector.
// Same fresh-24h window RS ranks on; per-market via ?region=in|us. Leaders =
// stocks in the top quintile of the whole market's rsScore.
async function computeSectorStrength(region) {
  {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await db.assetReturn.findMany({
      where: { region, assetType: 'stock', updatedAt: { gte: dayAgo } },
      select: { asset: true, sector: true, rsScore: true, return1wPct: true, return1mPct: true, return3mPct: true },
    });
    if (rows.length < 20) {
      return { region, asOf: new Date().toISOString(), universe: rows.length, sectors: [], note: 'universe still populating — sector data appears after the next scan cycles' };
    }
    const scores = rows.map(r => r.rsScore).sort((a, b) => a - b);
    const q80 = scores[Math.floor(scores.length * 0.8)];
    const median = (arr) => {
      const v = arr.filter(x => x != null && Number.isFinite(x)).sort((a, b) => a - b);
      return v.length ? v[Math.floor(v.length / 2)] : null;
    };
    const bySector = new Map();
    for (const r of rows) {
      const key = r.sector || 'Unclassified';
      if (!bySector.has(key)) bySector.set(key, []);
      bySector.get(key).push(r);
    }
    const sectors = [...bySector.entries()]
      .filter(([, list]) => list.length >= 3) // too few stocks = noise
      .map(([sector, list]) => ({
        sector,
        stocks: list.length,
        medianRsScore: median(list.map(r => r.rsScore)),
        median1wPct: median(list.map(r => r.return1wPct)),
        median1mPct: median(list.map(r => r.return1mPct)),
        median3mPct: median(list.map(r => r.return3mPct)),
        leaders: list.filter(r => r.rsScore >= q80).length,
        leadersPct: Math.round((list.filter(r => r.rsScore >= q80).length / list.length) * 100),
        topAssets: list.sort((a, b) => b.rsScore - a.rsScore).slice(0, 3).map(r => r.asset),
      }))
      .sort((a, b) => (b.medianRsScore ?? -Infinity) - (a.medianRsScore ?? -Infinity))
      .map((s, i) => ({ rank: i + 1, ...s }));
    return { region, asOf: new Date().toISOString(), universe: rows.length, sectors };
  }
}

app.get('/api/sector-strength', async (req, res) => {
  try {
    res.json(await computeSectorStrength(req.query.region === 'in' ? 'IN' : 'US'));
  } catch (err) {
    console.error('[/api/sector-strength]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// MCP endpoint: DataQuant's free data layer for AI agents — market health,
// sector strength, base X-ray, learn content. Stateless streamable HTTP; no
// auth (free tools only; signals are NOT exposed here).
app.post('/mcp', async (req, res) => {
  try {
    await handleMcpRequest(req, res, { computeMarketHealth, computeSectorStrength, getDailyCandles, detectBases });
  } catch (err) {
    console.error('[/mcp]', err.message);
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'internal error' }, id: null });
  }
});
// Stateless server: no SSE stream or session teardown to offer on GET/DELETE.
app.get('/mcp', (req, res) => res.status(405).json({ error: 'POST JSON-RPC to this endpoint (stateless streamable HTTP; no SSE stream)' }));
app.delete('/mcp', (req, res) => res.status(405).end());

// Base X-ray: every consolidation episode in the cached 2y of daily bars —
// forming and resolved — each with pivot, depth, duration, quality metrics and
// breakout outcome. Computed on demand (pure function of the candles) and
// cached; nothing is persisted.
const basesCache = new Map(); // symbol -> { payload, expiresAt }
app.get('/api/bases/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const cached = basesCache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) return res.json(cached.payload);
  try {
    const bars = await getDailyCandles(symbol);
    const payload = { symbol: symbol.toUpperCase(), asOf: bars.length ? bars[bars.length - 1].time : null, bases: detectBases(bars) };
    basesCache.set(symbol, { payload, expiresAt: Date.now() + CANDLES_TTL_MS });
    res.json(payload);
  } catch (err) {
    console.error(`[/api/bases] ${symbol}: ${err.message}`);
    res.status(502).json({ error: err.message });
  }
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
    if (apiKey && !(await fmpOff())) {
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
    // Log upstream failures instead of swallowing them — a 429 during a scan
    // burst was rendering the whole page empty with no trace in the logs.
    const loggedFetch = (label, url) =>
      fetch(url)
        .then((r) => {
          if (!r.ok) {
            console.warn(`[/api/pulse] ${label} HTTP ${r.status}`);
            return [];
          }
          return r.json();
        })
        .catch((e) => {
          console.warn(`[/api/pulse] ${label} failed: ${e.message}`);
          return [];
        });
    const [trendRaw, newsRaw] = (await fmpOff())
      ? [[], []] // FMP paused — go straight to the Yahoo fallbacks below
      : await Promise.all([
          loggedFetch('social-trending', `https://financialmodelingprep.com/api/v4/social-sentiments/trending?type=bullish&source=stocktwits&apikey=${apiKey}`),
          loggedFetch('news', `https://financialmodelingprep.com/stable/news/general-latest?limit=18&apikey=${apiKey}`),
        ]);

    let trending = (Array.isArray(trendRaw) ? trendRaw : []).slice(0, 12).map((t) => ({
      symbol: t.symbol,
      name: t.name || null,
      sentiment: Number(t.sentiment) || 0,           // 0..1
      lastSentiment: Number(t.lastSentiment) || 0,   // prior reading → momentum
    }));
    let news = (Array.isArray(newsRaw) ? newsRaw : []).slice(0, 12).map((n) => ({
      symbol: n.symbol || null,
      title: n.title,
      publisher: n.publisher || n.site || null,
      image: n.image || null,
      url: n.url || null,
      publishedDate: n.publishedDate || null,
    }));

    // Keyless fallbacks — the FMP v4 social endpoint is discontinued on newer
    // plans and the news endpoint can be plan-gated; the page must not go blank.
    if (!trending.length) {
      try {
        const r = await fetch('https://query1.finance.yahoo.com/v1/finance/trending/US?count=20', { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (r.ok) {
          const quotes = (await r.json())?.finance?.result?.[0]?.quotes || [];
          trending = quotes
            .map((q) => q.symbol)
            .filter((s) => s && !/[-=^.]/.test(s)) // equities only — skip crypto/futures/indices
            .slice(0, 12)
            .map((symbol) => ({ symbol, name: null, sentiment: null, lastSentiment: null }));
          if (trending.length) console.log(`[/api/pulse] trending via Yahoo fallback (${trending.length})`);
        }
      } catch (e) { console.warn(`[/api/pulse] yahoo trending fallback failed: ${e.message}`); }
    }
    if (!news.length) {
      try {
        const r = await fetch('https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EGSPC&region=US&lang=en-US', { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (r.ok) {
          const xml = await r.text();
          const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 12);
          const field = (s, tag) => {
            const m = s.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`));
            return m ? m[1].trim() : null;
          };
          news = items.map(([, body]) => ({
            symbol: null,
            title: field(body, 'title'),
            publisher: 'Yahoo Finance',
            image: null,
            url: field(body, 'link'),
            publishedDate: field(body, 'pubDate'),
          })).filter((n) => n.title && n.url);
          if (news.length) console.log(`[/api/pulse] news via Yahoo RSS fallback (${news.length})`);
        }
      } catch (e) { console.warn(`[/api/pulse] yahoo news fallback failed: ${e.message}`); }
    }

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
    // Never cache an empty pulse: a transient upstream failure (FMP 429 during
    // a scan burst) would otherwise freeze the page blank for the whole TTL.
    // Serve the empty result once, retry on the next request.
    if (data.trending.length || data.news.length) {
      pulseCache = { data, expiresAt: Date.now() + PULSE_TTL_MS };
    }
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
  if (await fmpOff()) return res.json({ sentiment: null, news: [], fmpPaused: true });

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
