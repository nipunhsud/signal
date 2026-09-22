// DataQuant MCP server — the free data layer, exposed for AI agents.
// Stateless streamable-HTTP at POST /mcp: each request builds a fresh server +
// transport (no sessions to manage, safe behind Caddy). Free tools only:
// market health, sector strength, base X-ray, learn articles. Signals stay
// behind the subscription and are NOT exposed here.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEARN_DIR = path.join(__dirname, 'public', 'learn');

const asText = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 1) }] });

// Learn articles: strip the static HTML down to readable text once, cache it.
let learnCache = null;
export function loadLearn() {
  if (learnCache) return learnCache;
  const articles = [];
  try {
    for (const f of fs.readdirSync(LEARN_DIR)) {
      if (!f.endsWith('.html') || f === 'index.html') continue;
      const html = fs.readFileSync(path.join(LEARN_DIR, f), 'utf8');
      const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || f;
      const body = html
        .replace(/<script[\s\S]*?<\/script>/g, ' ')
        .replace(/<style[\s\S]*?<\/style>/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim();
      articles.push({
        slug: f.replace(/\.html$/, ''),
        url: `https://dataquant.ai/learn/${f.replace(/\.html$/, '')}`,
        title: title.replace(/\s*—\s*DataQuant Learn\s*$/, ''),
        text: body,
      });
    }
  } catch (e) {
    console.warn('[mcp] learn load failed:', e.message);
  }
  learnCache = articles;
  return articles;
}

// deps: { computeMarketHealth, computeSectorStrength, getDailyCandles, detectBases,
//         alertLedger?, signalHistory? }
// opts.subscriber: also register the subscriber-only tools (the alert pool and
// per-ticker alert history). The public /mcp endpoint never sets it; the chat
// at chat.dataquant.ai does, in-process, behind the paywall. Every tool is
// read-only.
export function buildMcpServer(deps, opts = {}) {
  const server = new McpServer({ name: 'dataquant', version: '1.0.0' });

  if (opts.subscriber) {
    server.tool(
      'get_recent_alerts',
      'The alert pool: every breakout the screen emailed in a window (default the last 14 days), judged from the latest close. Each row: ticker, when it was emailed, base grade (S/A+/A), kind (pivot close, deep-pivot for a 25-35% deep base resolved on 2x volume, or a cheat/low-cheat/handle shelf inside a forming base), pivot, fail level (7% under), latest price, % change, where it stands (past the pivot, below it, or fell through the fail level), activity (institutional activity from the tape, 0-10: heavy up/down days, prints at the high, base volume; 5+ doubles the odds of a +20% run at a higher fail rate) and sectorRank (1 = the leading sector by median RS, of sectorCount). Use this first to see what is in the pool before comparing or filtering.',
      {
        days: z.number().int().min(1).max(60).optional().describe('Window length in days ending today (default 14)'),
        region: z.enum(['us', 'in']).optional().describe('Market: us (default) or in (India)'),
      },
      async ({ days, region }) => {
        const until = new Date();
        const since = new Date(until.getTime() - (days || 14) * 24 * 60 * 60 * 1000);
        const ledger = await deps.alertLedger({ since, until, region: region === 'in' ? 'in' : 'us' });
        return asText({ since: since.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10), summary: ledger.summary, alerts: ledger.alerts });
      },
    );

    server.tool(
      'analyze_ticker',
      'The full dossier on one stock: price and trend snapshot, the current base and its grade, and EVERY factor weighed against what DataQuant\'s own full-history studies measured on that factor. Returns three groups — hitRate (levers that move the odds a breakout works: grade, blue sky, base age, depth, failed pokes, the market trend state), payoff (levers that move the size of the winner and the fail-level risk with it: relative strength, tape activity, breakout volume), and context (where price sits versus the pivot, sector rank, the screen\'s own record, earlier breakouts on the name) — plus the measured exit pair, and notCredited: the factors readers usually weigh that measured nothing (the market health score, distribution days, breadth, tightness, gaps). Every entry carries its reading, its evidence with the real numbers, a lean, and a Learn URL to cite. Call this for "analyse X", "what does the screen think of X", "is X worth watching", or any question that wants the whole picture on one name rather than one field. It works for any symbol, listed or not in the alert pool.',
      { symbol: z.string().min(1).max(12).regex(/^[A-Za-z.\-^]+$/).describe('Ticker symbol') },
      async ({ symbol }) => asText(await deps.analyzeTicker(symbol.toUpperCase())),
    );

    server.tool(
      'get_signal_history',
      'Everything the screen recorded for one ticker over two years, folded into episodes: first and last seen, base grade, pivot, entry and fail level, whether it was emailed and when, the kind of entry (pivot or shelf), latest price, best and current % from entry, and how it went (past the pivot, below, fell through the fail level). Use it to see how a name behaved on earlier breakouts.',
      { symbol: z.string().min(1).max(12).regex(/^[A-Za-z.\-^]+$/).describe('Ticker symbol') },
      async ({ symbol }) => asText(await deps.signalHistory(symbol.toUpperCase())),
    );
  }

  server.tool(
    'get_market_health',
    'DataQuant\'s market regime gauge (0-100): does the current tape reward breakouts? Components: benchmark trend vs 50/200-day averages (SPY+QQQ for US, NIFTY for India), O\'Neil distribution days over 25 sessions, and breadth of the scanned universe (1-month and 1-week). Regimes: >=70 risk-on, 45-69 caution, <45 risk-off. Measured caveat (44,142 graded breakouts, 1985-2026): the composite score does NOT predict breakout outcomes - risk-on profit factor 1.80, caution 1.80, risk-off 2.00, bands unordered. Only the trend component separates: benchmark under both its 50- and 200-day with the 50-day falling ran 1.27 with a 40% fail-level touch rate. Distribution days and breadth do not. Read the trend state, not the score.',
    { region: z.enum(['us', 'in']).optional().describe('Market: us (default) or in (India)') },
    async ({ region }) => asText(await deps.computeMarketHealth(region === 'in' ? 'IN' : 'US')),
  );

  server.tool(
    'get_sector_strength',
    'Sector strength rankings: every scanned stock\'s trailing returns rolled up by sector, strongest first — median 1-week/1-month/3-month returns, top-quintile leader counts, and top tickers per sector.',
    { region: z.enum(['us', 'in']).optional().describe('Market: us (default) or in (India)') },
    async ({ region }) => asText(await deps.computeSectorStrength(region === 'in' ? 'IN' : 'US')),
  );

  server.tool(
    'get_base_xray',
    'Base X-ray for one stock: every consolidation base built in the last 2 years — pivot, depth %, duration, coil ratio, volume dry-up, up/down volume, failed pokes, blue-sky flag, and for resolved bases the breakout date, volume ratio, and subsequent run %. US symbols plain (SEIC), Indian NSE symbols with .NS suffix (RELIANCE.NS).',
    { symbol: z.string().min(1).max(12).regex(/^[A-Za-z.\-^]+$/).describe('Ticker symbol') },
    async ({ symbol }) => {
      const bars = await deps.getDailyCandles(symbol.toUpperCase());
      return asText({
        symbol: symbol.toUpperCase(),
        asOf: bars.length ? bars[bars.length - 1].time : null,
        bases: deps.detectBases(bars),
        disclaimer: 'Research/education only — not investment advice.',
      });
    },
  );

  server.tool(
    'search_learn',
    'Search DataQuant\'s educational guides (VCP, relative strength, distribution days, base X-ray, backtest methodology, market health gauge). Returns matching articles with their full plain-text content and canonical URLs for citation.',
    { query: z.string().min(1).max(200).describe('Topic or keywords; empty-ish terms return the article list') },
    async ({ query }) => {
      const arts = loadLearn();
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      const scored = arts
        .map((a) => ({
          a,
          score: terms.reduce((s, t) => s + (a.title.toLowerCase().includes(t) ? 3 : 0) + (a.text.toLowerCase().includes(t) ? 1 : 0), 0),
        }))
        .sort((x, y) => y.score - x.score);
      const hits = scored.filter((s) => s.score > 0).slice(0, 2).map((s) => s.a);
      if (!hits.length) {
        return asText({ matches: [], articles: arts.map(({ slug, url, title }) => ({ slug, url, title })) });
      }
      return asText({ matches: hits });
    },
  );

  return server;
}

export async function handleMcpRequest(req, res, deps) {
  const server = buildMcpServer(deps);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
