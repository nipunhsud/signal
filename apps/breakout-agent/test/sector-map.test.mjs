// Translating Nasdaq's sector names into the screen's. Pure, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NASDAQ_TO_SCREEN, SCREEN_SECTORS, toScreenSector, needsSector } from '../sector-map.js';

test('the names that differ are the point of the map', () => {
  // Same sector, different vocabulary. Backfilling without translating would
  // split each of these across two spellings in the Sector Strength tab.
  assert.equal(toScreenSector('Finance'), 'Financial Services');
  assert.equal(toScreenSector('Health Care'), 'Healthcare');
  assert.equal(toScreenSector('Consumer Discretionary'), 'Consumer Cyclical');
  assert.equal(toScreenSector('Consumer Staples'), 'Consumer Defensive');
  assert.equal(toScreenSector('Telecommunications'), 'Communication Services');
});

test('the names that already match pass through unchanged', () => {
  for (const s of ['Basic Materials', 'Energy', 'Industrials', 'Real Estate', 'Technology', 'Utilities']) {
    assert.equal(toScreenSector(s), s);
  }
});

test('one unknown is never filled with another', () => {
  // Miscellaneous is Nasdaq's own unclassified bucket.
  assert.equal(toScreenSector('Miscellaneous'), null);
  assert.equal(toScreenSector(''), null);
  assert.equal(toScreenSector(null), null);
  assert.equal(toScreenSector('Something Else'), null);
  assert.ok(!SCREEN_SECTORS.has('Miscellaneous'));
  assert.ok(!SCREEN_SECTORS.has('Unclassified'));
});

test('every target is a sector the screen already uses', () => {
  // A typo here would invent a thirteenth sector that ranks on its own.
  const known = new Set(['Basic Materials', 'Communication Services', 'Consumer Cyclical', 'Consumer Defensive',
    'Energy', 'Financial Services', 'Healthcare', 'Industrials', 'Real Estate', 'Technology', 'Utilities']);
  for (const v of SCREEN_SECTORS) assert.ok(known.has(v), `${v} is a sector the screen already shows`);
  assert.equal(SCREEN_SECTORS.size, 11);
  assert.equal(Object.keys(NASDAQ_TO_SCREEN).length, 11, 'one Nasdaq name per screen sector');
});

test('only a missing sector is filled; a known one is never overwritten', () => {
  assert.equal(needsSector({ sector: null }), true);
  assert.equal(needsSector({ sector: '' }), true);
  assert.equal(needsSector({ sector: 'Unclassified' }), true, 'the bucket the tab ranks third');
  assert.equal(needsSector({ sector: 'Energy' }), false);
  assert.equal(needsSector({ sector: 'Healthcare' }), false);
  assert.equal(needsSector({}), true);
});
