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

// deps: { computeMarketHealth, computeSectorStrength, getDailyCandles, detectBases }
export function buildMcpServer(deps) {
  const server = new McpServer({ name: 'dataquant', version: '1.0.0' });

  server.tool(
    'get_market_health',
    'DataQuant\'s market regime gauge (0-100): does the current tape reward breakouts? Components: benchmark trend vs 50/200-day averages (SPY+QQQ for US, NIFTY for India), O\'Neil distribution days over 25 sessions, and breadth of the scanned universe (1-month and 1-week). Regimes: >=70 risk-on, 45-69 caution, <45 risk-off.',
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
