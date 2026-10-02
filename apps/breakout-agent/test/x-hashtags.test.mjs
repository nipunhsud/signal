import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withHashtags, hashtagsFor, xLength } from '../dist/x-post.js';

test('links count as 23 characters, the way X counts them', () => {
  assert.equal(xLength('see https://dataquant.ai/$NVDA?s=abcdef1234'), 4 + 23);
});

test('at most two tags, on their own last line', () => {
  const out = withHashtags('$MTW closed above its pivot today, $21.34.', ['#stocks', '#breakout', '#extra'], 280);
  assert.equal(out, '$MTW closed above its pivot today, $21.34.\n\n#stocks #breakout');
});

test('a sector tag replaces the generic one when the sector is known', () => {
  assert.deepEqual(hashtagsFor('breakout', { sector: 'Technology', industry: 'Semiconductors' }), ['#stocks', '#Semiconductors']);
  assert.deepEqual(hashtagsFor('breakout', { sector: 'Utilities' }), ['#stocks', '#breakout']);
  assert.deepEqual(hashtagsFor('market'), ['#StockMarket', '#investing']);
});

test('tags are dropped, one at a time, rather than pushing a post past the limit', () => {
  const body = 'x'.repeat(268);
  assert.equal(withHashtags(body, ['#stocks', '#breakout'], 280), `${body}\n\n#stocks`);
  assert.equal(withHashtags('x'.repeat(279), ['#stocks'], 280), 'x'.repeat(279));
});

test('a tag already in the text is not added twice', () => {
  assert.equal(withHashtags('Earnings day. #earnings', ['#earnings', '#stocks'], 280), 'Earnings day. #earnings\n\n#stocks');
});

test('X_HASHTAGS=false turns tags off', () => {
  process.env.X_HASHTAGS = 'false';
  try {
    assert.equal(withHashtags('A post.', ['#stocks'], 280), 'A post.');
  } finally {
    delete process.env.X_HASHTAGS;
  }
});

test('the account is Premium by default; X_PREMIUM=false restores 280', async () => {
  const { xMaxChars } = await import('../dist/x-post.js');
  assert.equal(xMaxChars(), 10000);
  process.env.X_PREMIUM = 'false';
  try {
    assert.equal(xMaxChars(), 280);
  } finally {
    delete process.env.X_PREMIUM;
  }
});
