// The chat's tools are the MCP server's tools, served in-process. The public
// endpoint never gets the subscriber tools; the chat always does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildMcpServer } from '../mcp.js';

const deps = {
  computeMarketHealth: async () => ({ score: 57, regime: 'caution' }),
  computeSectorStrength: async () => ({ sectors: [] }),
  getDailyCandles: async () => [],
  detectBases: () => [],
  alertLedger: async ({ since, until, region }) => ({ since, until, region, alerts: [{ asset: 'AAPL', kind: 'pivot', grade: 'A+', pct: 2.9, status: 'past' }], summary: { count: 1, past: 1, fell: 0, below: 0, avgCappedPct: 2.9 } }),
  signalHistory: async (symbol) => ({ asset: symbol, episodes: [{ grade: 'A', status: 'past', pct: 4.1 }], rows: 3 }),
};

async function open(opts) {
  const server = buildMcpServer(deps, opts);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: 't', version: '0' });
  await client.connect(ct);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

test('the public MCP never lists the alert pool; the subscriber chat does', async () => {
  const pub = await open();
  const names = (await pub.client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['get_base_xray', 'get_market_health', 'get_sector_strength', 'search_learn']);
  await pub.close();

  const sub = await open({ subscriber: true });
  const subNames = (await sub.client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(subNames, ['get_base_xray', 'get_market_health', 'get_recent_alerts', 'get_sector_strength', 'get_signal_history', 'search_learn']);
  await sub.close();
});

test('tool schemas are JSON schema the Messages API accepts, and calls reach the ledger', async () => {
  const sub = await open({ subscriber: true });
  const { tools } = await sub.client.listTools();
  for (const t of tools) {
    assert.equal(t.inputSchema.type, 'object', `${t.name} has an object schema`);
    assert.ok(t.description.length > 40, `${t.name} explains itself`);
  }
  const r = await sub.client.callTool({ name: 'get_recent_alerts', arguments: { days: 7 } });
  const body = JSON.parse(r.content[0].text);
  assert.equal(body.summary.count, 1);
  assert.equal(body.alerts[0].asset, 'AAPL');
  const h = await sub.client.callTool({ name: 'get_signal_history', arguments: { symbol: 'swks' } });
  assert.equal(JSON.parse(h.content[0].text).asset, 'SWKS', 'symbols are upper-cased');
  await sub.close();
});

test('the chat module loads and names the model and the voice rules', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../chat.js', import.meta.url), 'utf8');
  assert.match(src, /const MODEL = 'claude-opus-5';/);
  assert.match(src, /Report, don't recommend/);
  assert.match(src, /subscriber: true/, 'the chat opens the subscriber tool set');
  assert.doesNotMatch(src, /updateMany|\.create\(\{|\.delete\(/, 'the chat never writes');
});
