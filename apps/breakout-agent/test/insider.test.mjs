// Form 4: what the filing says, and what the 90-day rollup makes of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseForm4, summarizeInsider, insiderTag, insiderWords } from '../insider.js';

const f4 = ({ owner = 'Doe Jane', director = 1, officer = 0, tenPct = 0, title = '', planned = 0, txs = [] }) => `<?xml version="1.0"?>
<ownershipDocument>
  <documentType>4</documentType>
  <periodOfReport>2026-09-16</periodOfReport>
  <issuer><issuerCik>0001851112</issuerCik><issuerName>TEST CO</issuerName><issuerTradingSymbol>TEST</issuerTradingSymbol></issuer>
  <reportingOwner>
    <reportingOwnerId><rptOwnerCik>0000001</rptOwnerCik><rptOwnerName>${owner}</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isDirector>${director}</isDirector><isOfficer>${officer}</isOfficer><isTenPercentOwner>${tenPct}</isTenPercentOwner>${title ? `<officerTitle><value>${title}</value></officerTitle>` : ''}</reportingOwnerRelationship>
  </reportingOwner>
  <aff10b5One>${planned}</aff10b5One>
  <nonDerivativeTable>${txs.map((t) => `
    <nonDerivativeTransaction>
      <securityTitle><value>Common</value></securityTitle>
      <transactionDate><value>${t.date}</value></transactionDate>
      <transactionCoding><transactionFormType>4</transactionFormType><transactionCode>${t.code}</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>${t.shares}</value></transactionShares>
        ${t.price == null ? '' : `<transactionPricePerShare><value>${t.price}</value></transactionPricePerShare>`}
        <transactionAcquiredDisposedCode><value>${t.code === 'S' || t.code === 'F' ? 'D' : 'A'}</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
    </nonDerivativeTransaction>`).join('')}
  </nonDerivativeTable>
</ownershipDocument>`;

const filing = (o) => ({ ...parseForm4(f4(o)), filedAt: o.filedAt || '2026-09-17', link: 'https://sec.gov/x' });
const ASOF = new Date('2026-09-27T00:00:00Z');

test('a filing yields the owner, their role, and every transaction with its code', () => {
  const f = parseForm4(f4({ owner: 'Shachar Erez', txs: [{ date: '2026-09-16', code: 'S', shares: 50000, price: 6.2568 }] }));
  assert.equal(f.symbol, 'TEST');
  assert.equal(f.owner, 'Shachar Erez');
  assert.equal(f.role, 'director');
  assert.deepEqual(f.transactions.map((t) => [t.code, t.shares, t.price]), [['S', 50000, 6.2568]]);
});

test('an officer title beats the generic role word', () => {
  const f = parseForm4(f4({ director: 0, officer: 1, title: 'Chief Revenue Officer', txs: [{ date: '2026-09-10', code: 'P', shares: 1000, price: 10 }] }));
  assert.equal(f.role, 'Chief Revenue Officer');
});

test('a form that is not a 4 is not parsed as one', () => {
  assert.equal(parseForm4('<ownershipDocument><documentType>3</documentType></ownershipDocument>'), null);
  assert.equal(parseForm4('not xml'), null);
  assert.equal(parseForm4(''), null);
});

test('only open-market codes count as a buy or a sell', () => {
  // A grant, an option exercise and a tax withholding are compensation, not a view.
  const s = summarizeInsider([filing({ txs: [
    { date: '2026-09-10', code: 'A', shares: 40000, price: 0 },
    { date: '2026-09-10', code: 'M', shares: 10000, price: 1 },
    { date: '2026-09-10', code: 'F', shares: 3000, price: 10 },
  ] })], { asOf: ASOF });
  assert.equal(s.buys, 0);
  assert.equal(s.sells, 0);
  assert.equal(s.tone, 'quiet');
  assert.match(insiderWords(s, { asOf: ASOF }), /reported compensation only/);
});

test('two different insiders buying is a cluster; one is not', () => {
  const one = summarizeInsider([filing({ owner: 'A', txs: [{ date: '2026-09-10', code: 'P', shares: 1000, price: 10 }] })], { asOf: ASOF });
  assert.equal(one.cluster, false);
  assert.equal(insiderTag(one), 'insider buy');

  const two = summarizeInsider([
    filing({ owner: 'A', txs: [{ date: '2026-09-10', code: 'P', shares: 1000, price: 10 }] }),
    filing({ owner: 'B', txs: [{ date: '2026-09-11', code: 'P', shares: 2000, price: 11 }] }),
  ], { asOf: ASOF });
  assert.equal(two.cluster, true);
  assert.equal(two.buyers, 2);
  assert.equal(two.buyValue, 1000 * 10 + 2000 * 11);
  assert.equal(insiderTag(two), 'insider cluster buy');
});

test('a 10b5-1 sale is separated out and does not make the tone selling', () => {
  const s = summarizeInsider([filing({ planned: 1, txs: [{ date: '2026-09-10', code: 'S', shares: 5000, price: 20 }] })], { asOf: ASOF });
  assert.equal(s.sells, 1);
  assert.equal(s.plannedSells, 1);
  assert.equal(s.realSells, 0, 'scheduled months earlier — not a read on this price');
  assert.equal(s.tone, 'quiet');
  assert.match(insiderWords(s, { asOf: ASOF }), /under a 10b5-1 plan/);
});

test('selling on the day an option was exercised is an exercise and sell, not a decision to reduce', () => {
  const s = summarizeInsider([filing({ txs: [
    { date: '2026-09-10', code: 'M', shares: 5000, price: 1 },
    { date: '2026-09-10', code: 'S', shares: 5000, price: 20 },
  ] })], { asOf: ASOF });
  assert.equal(s.exerciseSells, 1);
  assert.equal(s.realSells, 0);
  assert.equal(s.tone, 'quiet');
  assert.match(insiderWords(s, { asOf: ASOF }), /an exercise and sell/);
});

test('a discretionary sale does read as selling', () => {
  const s = summarizeInsider([filing({ txs: [{ date: '2026-09-16', code: 'S', shares: 50000, price: 6.2568 }] })], { asOf: ASOF });
  assert.equal(s.realSells, 1);
  assert.equal(s.tone, 'selling');
  assert.equal(insiderTag(s), 'insider selling');
});

test('buying and real selling together reads as both ways', () => {
  const s = summarizeInsider([
    filing({ owner: 'A', txs: [{ date: '2026-09-10', code: 'P', shares: 1000, price: 10 }] }),
    filing({ owner: 'B', txs: [{ date: '2026-09-12', code: 'S', shares: 4000, price: 11 }] }),
  ], { asOf: ASOF });
  assert.equal(s.tone, 'mixed');
  assert.equal(s.netValue, 1000 * 10 - 4000 * 11);
  assert.equal(insiderTag(s), 'insiders both ways');
});

test('transactions older than the window are dropped, and the window is stated', () => {
  const s = summarizeInsider([
    filing({ owner: 'A', filedAt: '2026-01-05', txs: [{ date: '2026-01-02', code: 'P', shares: 9999, price: 10 }] }),
    filing({ owner: 'B', txs: [{ date: '2026-09-10', code: 'P', shares: 100, price: 10 }] }),
  ], { asOf: ASOF, windowDays: 90 });
  assert.equal(s.buys, 1);
  assert.equal(s.buyShares, 100);
  assert.equal(s.cluster, false, 'the January buyer is outside the window');
  assert.match(insiderWords(s, { asOf: ASOF }), /in the last 90 days/);
});

test('the newest open-market transaction is the one reported, with how stale it is', () => {
  const s = summarizeInsider([
    filing({ owner: 'A', txs: [{ date: '2026-08-01', code: 'P', shares: 500, price: 9 }] }),
    filing({ owner: 'B', txs: [{ date: '2026-09-26', code: 'P', shares: 700, price: 12.5 }] }),
  ], { asOf: ASOF });
  assert.equal(s.latest.date, '2026-09-26');
  assert.equal(s.latest.owner, 'B');
  const w = insiderWords(s, { asOf: ASOF });
  assert.match(w, /a purchase of 700 shares at \$12\.50 on 2026-09-26, 1 day ago by B, director/);
});

test('no filing at all says so rather than implying nothing happened', () => {
  const s = summarizeInsider([], { asOf: ASOF });
  assert.equal(s.tone, 'quiet');
  assert.equal(insiderTag(s), null);
  assert.match(insiderWords(s, { asOf: ASOF }), /No Form 4 filed in the last 90 days\./);
});

test('the sentence carries no recommendation vocabulary', () => {
  const s = summarizeInsider([
    filing({ owner: 'A', txs: [{ date: '2026-09-10', code: 'P', shares: 1000, price: 10 }] }),
    filing({ owner: 'B', txs: [{ date: '2026-09-12', code: 'S', shares: 4000, price: 11 }] }),
  ], { asOf: ASOF });
  const w = insiderWords(s, { asOf: ASOF });
  assert.doesNotMatch(w, /\b(entry|stop|position|actionable|setup|bullish|strong|conviction)\b/i);
  assert.doesNotMatch(w, /[🚀🔥🚨📈]/u);
});
