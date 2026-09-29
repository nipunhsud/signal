// Fields the dashboard reads have to be fields the server actually sends.
//
// /api/signals does not hand the query rows straight out: it builds an explicit
// object, field by field. Twice now a column has been wired to a field the SQL
// selected and that object never copied — the sort silently did nothing and the
// column rendered a dash on every row (`signalDate`, the Breakout column). The
// comparator skips an unknown key without complaining, so nothing fails loudly.
//
// This walks the dashboard's own sort map and column renderers, collects the
// signal fields they read, and checks each one against the keys the mapper
// returns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

// The object literal /api/signals returns, read as its top-level keys.
function mapperKeys() {
  const start = server.indexOf('      return {\n        asset: s.asset,');
  assert.ok(start > 0, 'found the /api/signals response mapper');
  let depth = 0, i = server.indexOf('{', start);
  const body = [];
  for (; i < server.length; i++) {
    const ch = server[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) break; }
    if (depth === 1) body.push(ch);
  }
  const text = body.join('');
  const keys = new Set();
  // Top-level keys only: a key sits at the start of a line at two-space depth.
  for (const line of text.split('\n')) {
    const m = line.match(/^\s{8}([A-Za-z_$][\w$]*)\s*:/);
    if (m) keys.add(m[1]);
  }
  return keys;
}

// Every `s.field` the sort map reads.
function sortMapFields() {
  const start = page.indexOf('          breakoutOn: (s) =>');
  assert.ok(start > 0, 'found the sort map');
  const block = page.slice(page.lastIndexOf('{', start), page.indexOf('};', start));
  return new Set([...block.matchAll(/\bs\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
}

const KEYS = mapperKeys();

test('the mapper is being read correctly', () => {
  for (const known of ['asset', 'currentPrice', 'rsRating', 'sector', 'createdAt']) {
    assert.ok(KEYS.has(known), `expected ${known} among the mapper keys`);
  }
  assert.ok(KEYS.size > 30, `expected a full object, got ${KEYS.size} keys`);
});

test('every field the sort map reads is a field the server sends', () => {
  // Fields the frontend adds itself after fetching, not server output.
  const CLIENT_SIDE = new Set(['_sortIndex', 'shortlisted']);
  const missing = [...sortMapFields()].filter((f) => !KEYS.has(f) && !CLIENT_SIDE.has(f));
  assert.deepEqual(missing, [], `sort map reads fields /api/signals never sends: ${missing.join(', ')}`);
});

test('the Breakout column has the field it renders', () => {
  assert.match(page, /data-label="Breakout"[^>]*>\$\{this\.breakoutWhenHtml\(signal\)\}/, 'the column calls breakoutWhenHtml');
  assert.match(page, /breakoutWhenHtml\(signal\) \{\s*\n\s*const sd = signal\.signalDate/, 'breakoutWhenHtml reads signalDate');
  assert.ok(KEYS.has('signalDate'), '/api/signals must send signalDate or every row shows a dash');
});

test('the SQL that feeds the mapper selects signalDate', () => {
  assert.match(server, /"signalDate"/, 'signalDate is selected somewhere in the signals query');
});
