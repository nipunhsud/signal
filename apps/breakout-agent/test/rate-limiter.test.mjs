// The FMP budget. The bug this guards: seven containers each configured 600/min
// against a 750/min plan, 140,798 rate-limit responses in a day, and a screener
// that answers over-quota with HTTP 200 and a short list.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const load = async (env) => {
  for (const k of ['RATE_LIMIT_PER_MIN', 'FMP_FLEET_LIMIT_PER_MIN', 'FMP_FLEET_CONTAINERS']) delete process.env[k];
  Object.assign(process.env, env);
  // A fresh module per case, since the budget is read once at import.
  return import(`../dist/tools/rate-limiter.js?${Math.random()}`);
};

test('the configured per-container value is a cap, not an override', async () => {
  // Every tier env file already says 600. Treating that as an override would
  // leave the fleet at 4,200/min, which is the bug.
  const m = await load({ RATE_LIMIT_PER_MIN: '600' });
  assert.equal(m.RATE_LIMIT_PER_MIN, 107, '750 ÷ 7 wins over the configured 600');
});

test('a container that owns the key gets the whole budget', async () => {
  const m = await load({ FMP_FLEET_CONTAINERS: '1' });
  assert.equal(m.RATE_LIMIT_PER_MIN, 750);
});

test('a configured value below the share is respected', async () => {
  const m = await load({ RATE_LIMIT_PER_MIN: '40' });
  assert.equal(m.RATE_LIMIT_PER_MIN, 40, 'the cap wins when it is the smaller of the two');
});

test('a 429 puts the whole process into a jittered cooldown that doubles', async () => {
  const { RateLimiter } = await load({});
  const rl = new RateLimiter(600);
  rl.notifyRateLimited();
  const first = rl.snapshot().blockedForMs;
  assert.ok(first >= 1500 && first <= 2600, `first hold ~2s, got ${first}`);
  rl.notifyRateLimited();
  const second = rl.snapshot().blockedForMs;
  assert.ok(second > first, `second hold longer than the first (${first} -> ${second})`);
  assert.equal(rl.snapshot().rateLimited, 2);
});

test('the cooldown is capped so a bad spell cannot stall the scan forever', async () => {
  const { RateLimiter } = await load({});
  const rl = new RateLimiter(600);
  for (let i = 0; i < 40; i++) rl.notifyRateLimited();
  assert.ok(rl.snapshot().blockedForMs <= 60000 * 1.3, 'held at the one-minute ceiling');
});

test('a 429 response is detected without the call site having to say so', async () => {
  const { RateLimiter } = await load({});
  const rl = new RateLimiter(6000);
  await rl.execute(async () => ({ status: 429 }));
  assert.equal(rl.snapshot().rateLimited, 1, 'a Response-shaped 429 is counted');
  const rl2 = new RateLimiter(6000);
  await rl2.execute(async () => ({ status: 200 }));
  assert.equal(rl2.snapshot().rateLimited, 0);
});

test('a thrown 429 counts too, and still propagates', async () => {
  const { RateLimiter } = await load({});
  const rl = new RateLimiter(6000);
  await assert.rejects(() => rl.execute(async () => { throw { response: { status: 429 } }; }));
  assert.equal(rl.snapshot().rateLimited, 1);
});

test('a non-HTTP result passes through untouched', async () => {
  const { RateLimiter } = await load({});
  const rl = new RateLimiter(6000);
  assert.deepEqual(await rl.execute(async () => ({ rows: [1, 2] })), { rows: [1, 2] });
  assert.equal(rl.snapshot().rateLimited, 0);
});
