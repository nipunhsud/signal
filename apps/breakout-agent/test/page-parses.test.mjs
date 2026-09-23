// Every inline script in the dashboard has to parse.
//
// The Dashboard is a class, not an object literal, so a method followed by a
// comma is a syntax error — and one syntax error anywhere in that 384KB file
// takes the whole page down, leaving `dashboard is not defined` in the
// Playwright run and a blank screen in the browser. That signal is slow and
// reads like a navigation problem. This catches it in milliseconds and names
// the line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Script } from 'node:vm';

const PUBLIC = new URL('../public/', import.meta.url);
const pages = readdirSync(PUBLIC).filter((f) => f.endsWith('.html'));

// The opening tag only. Reading attributes off the whole match instead finds
// the `type="date"` of an <input> built inside the script's own templates,
// and then skips the very script this test exists to check.
const TAG = /<script([^>]*)>([\s\S]*?)<\/script>/g;
const JS = /^(module|text\/javascript|application\/javascript)$/i;

export function inlineScripts(html) {
  const out = [];
  let m;
  TAG.lastIndex = 0;
  while ((m = TAG.exec(html))) {
    const [, attrs, body] = m;
    if (/\bsrc\s*=/.test(attrs)) continue;   // external file, not inline
    if (!body.trim()) continue;
    const type = (attrs.match(/type\s*=\s*["']([^"']+)["']/) || [])[1];
    if (type && !JS.test(type)) continue;    // JSON-LD, importmap, a template
    out.push({ body, isModule: type === 'module' });
  }
  return out;
}

for (const page of pages) {
  test(`${page}: every inline script parses`, () => {
    const scripts = inlineScripts(readFileSync(new URL(page, PUBLIC), 'utf8'));
    scripts.forEach(({ body, isModule }, i) => {
      const label = `${page} inline script #${i + 1}`;
      try {
        new Script(isModule ? `(async () => {${body}})` : body, { filename: label });
      } catch (e) {
        assert.fail(`${label} does not parse: ${e.message}`);
      }
    });
  });
}

test('the dashboard script is the one being checked, not skipped', () => {
  const scripts = inlineScripts(readFileSync(new URL('index.html', PUBLIC), 'utf8'));
  const main = scripts.find((s) => s.body.includes('class Dashboard'));
  assert.ok(main, 'the Dashboard class is inside a script this test parses');
  assert.ok(main.body.length > 100_000, `and it is the big one (${main.body.length} chars)`);
});

test('a comma after a class method is caught', () => {
  const good = 'class D { a() { return 1 } b() { return 2 } }';
  new Script(good);
  assert.throws(() => new Script(good.replace('return 1 }', 'return 1 },')), SyntaxError);
});

test('the shared chat widget parses', () => {
  new Script(readFileSync(new URL('chat-widget.js', PUBLIC), 'utf8'), { filename: 'chat-widget.js' });
});

test('the pages that matter are covered', () => {
  for (const p of ['index.html', 'pulse.html']) assert.ok(pages.includes(p), `${p} is in public/`);
});
