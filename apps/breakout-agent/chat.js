// chat.dataquant.ai — a conversation over the alert pool.
//
// The model gets the SAME read-only tools the MCP server exposes (market
// health, sector strength, base X-ray, learn search) plus the subscriber-only
// alert pool and per-ticker history, all served in-process through an
// in-memory MCP client/server pair — one tool definition, one schema, no
// network hop. Nothing here writes anything.
//
// Streams server-sent events to the browser: `tool` (a lookup started),
// `text` (a delta of the reply), `done`, `error`.
import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildMcpServer } from './mcp.js';

const MODEL = 'claude-opus-5';
const MAX_TOOL_ROUNDS = 12;

// Voice: .claude/skills/dataquant-voice/SKILL.md. Report what the screen saw;
// no recommendations. The reader is a subscriber choosing what to study next.
const SYSTEM = `You are DataQuant's screen, answering a subscriber who is looking at the recent alert pool: the breakouts the screen emailed, each with a base grade, a pivot, a fail level 7% under it, and where price stands now.

You help them compare, reason about, filter and shortlist names from that pool. You have read-only tools: the alert pool, each ticker's alert history, the base X-ray (every base in two years with depth, length, coil, volume dry-up, failed pokes), market health, sector strength, and the Learn articles. Call the pool first when the question is about "recent" or "these" names; call the X-ray or history when the question is about one name's structure or track record; call market health when the question is about the tape. Prefer several tool calls in one turn over guessing.

How to write:
- Report, don't recommend. Say what the screen sees: grade, depth, weeks, volume, where price sits versus the pivot and the fail level. Never say what to buy, sell, size, or where to exit. No "entry", "stop", "trade", "position".
- Numbers carry the message. "16-week base, 12% deep, closed 2.6% past the pivot" beats "strong setup". Two numbers per sentence at most.
- Plain words, no hype, no exclamation marks, no emoji, no headings for short answers. Tables are fine when comparing three or more names; keep them to the columns that decide the comparison.
- When the user asks which to pick, rank by the evidence the screen has (grade, depth, base length, RS, distance from the pivot, whether the fail level held) and say what the ranking rests on. Say plainly when names are close or when the pool has nothing that fits.
- The historical figures behind the grades: S 62.6% of breakouts positive after 20 bars with 11.6% touching the fail level; A+ 57.7% / 22.6%; A 54.8% / 32.1%; ungraded 32%. Cheat entries (a shelf inside a forming base) are newer and less validated; say so when they come up.
- End with one sentence: "Screen output for research, not advice." only when the answer names price levels.

Today is {{today}}. Prices are the latest scan close, not live quotes.`;

// One request = one in-memory MCP client. Cheap to build; nothing to pool.
async function openTools(deps) {
  const server = buildMcpServer(deps, { subscriber: true });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: 'dataquant-chat', version: '1.0.0' });
  await client.connect(clientT);
  const { tools } = await client.listTools();
  const defs = tools.map((t) => ({ name: t.name, description: t.description || '', input_schema: t.inputSchema }));
  const call = async (name, input) => {
    const r = await client.callTool({ name, arguments: input || {} });
    const text = (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    return { text: text || '(no data)', isError: !!r.isError };
  };
  const close = async () => { try { await client.close(); } catch {} try { await server.close(); } catch {} };
  return { defs, call, close };
}

// messages: Anthropic.MessageParam[] built by the page (user/assistant text
// turns only; tool turns from earlier requests are not replayed — each answer
// re-fetches what it needs, which keeps the transcript small and current).
export async function runChat({ messages, deps, send, region = 'us', signal }) {
  const anthropic = new Anthropic();
  const tools = await openTools(deps);
  const today = new Date().toISOString().slice(0, 10);
  const system = SYSTEM.replace('{{today}}', today) + (region === 'in' ? '\nThe subscriber is looking at the Indian market (NSE/BSE, prices in rupees); pass region "in" to the tools.' : '');
  const history = [...messages];
  let rounds = 0;
  try {
    while (rounds++ < MAX_TOOL_ROUNDS) {
      const stream = anthropic.messages.stream({
        model: MODEL,
        max_tokens: 16000,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        tools: tools.defs,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        messages: history,
      }, { signal });
      stream.on('text', (delta) => send('text', { delta }));
      const msg = await stream.finalMessage();
      if (msg.stop_reason === 'refusal') { send('text', { delta: 'The screen cannot answer that one.' }); break; }
      history.push({ role: 'assistant', content: msg.content });
      const uses = msg.content.filter((b) => b.type === 'tool_use');
      if (msg.stop_reason !== 'tool_use' || !uses.length) break;
      const results = [];
      for (const u of uses) {
        send('tool', { name: u.name, input: u.input });
        try {
          const r = await tools.call(u.name, u.input);
          results.push({ type: 'tool_result', tool_use_id: u.id, content: r.text, is_error: r.isError });
        } catch (e) {
          results.push({ type: 'tool_result', tool_use_id: u.id, content: `lookup failed: ${e.message}`, is_error: true });
        }
      }
      history.push({ role: 'user', content: results });
    }
    send('done', {});
  } finally {
    await tools.close();
  }
}

// Express handler for POST /api/chat. Streams server-sent events.
//
// Cancellation keys off the RESPONSE closing, never the request: on Node 16+
// an IncomingMessage emits 'close' as soon as its body has been consumed, so
// `req.on('close', abort)` cancelled every model call the instant it began and
// the page received an empty stream ("The screen had nothing to add.").
export async function handleChatRequest(req, res, { deps, run = runChat } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'chat is not configured on this server' });
  const raw = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const messages = raw
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-24)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
  if (!messages.length || messages[messages.length - 1].role !== 'user') return res.status(400).json({ error: 'a user message is required' });
  const region = req.body?.region === 'in' ? 'in' : 'us';
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const send = (event, data) => { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  const ac = new AbortController();
  // The client went away before we finished: stop paying for the answer.
  res.on('close', () => { if (!res.writableFinished) ac.abort(); });
  try {
    await run({ messages, deps, send, region, signal: ac.signal });
  } catch (e) {
    if (!ac.signal.aborted) {
      console.error('[/api/chat] failed:', e);
      send('error', { message: e?.status === 429 ? 'The screen is busy, try again in a moment.' : 'The answer did not come through. Try again.' });
    }
  } finally {
    res.end();
  }
}
