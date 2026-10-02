// One FMP budget, shared by every container that holds the key.
//
// The bug this replaces: each container was configured RATE_LIMIT_PER_MIN=600
// and there are seven of them — five US tiers and two IN — so the fleet could
// issue 4,200 requests a minute against a 750/minute plan, 5.6x over. Measured
// over 24 hours in September 2026 that produced 140,798 rate-limit responses.
//
// It did not fail loudly. FMP answers an over-quota screener call with HTTP 200
// and a SHORTER array rather than an error, so the universe fetch came back
// with 1,351 of 3,525 stocks, passed every ok() check, and was cached for the
// trading day. The screen ran on 38% of the market and said nothing.
//
// So the budget is divided here rather than per container, and a 429 now moves
// the whole process into a cooldown instead of being retried by one caller
// while the rest keep pushing.
const FLEET_PER_MIN = parseInt(process.env.FMP_FLEET_LIMIT_PER_MIN || "750");
const FLEET_CONTAINERS = parseInt(process.env.FMP_FLEET_CONTAINERS || "7");
// RATE_LIMIT_PER_MIN is a CAP, not an override, and that distinction is the
// whole fix. Every tier already carries RATE_LIMIT_PER_MIN=600 in its env file,
// so treating it as an override would leave the fleet exactly where it was —
// 600 a container, seven containers, 4,200 a minute. The smaller of the two
// wins. A single container that genuinely owns the key sets
// FMP_FLEET_CONTAINERS=1 and gets the whole budget, which makes the fleet
// arithmetic explicit instead of implied.
const CAP = process.env.RATE_LIMIT_PER_MIN ? parseInt(process.env.RATE_LIMIT_PER_MIN) : null;
const DERIVED = Math.max(20, Math.floor(FLEET_PER_MIN / Math.max(1, FLEET_CONTAINERS)));
const EFFECTIVE = CAP != null ? Math.min(CAP, DERIVED) : DERIVED;

const COOLDOWN_BASE_MS = 2000;
const COOLDOWN_MAX_MS = 60000;
// A quiet spell this long means the pressure is off and the backoff resets.
const COOLDOWN_RESET_MS = 120000;

const jitter = (ms: number) => ms * (0.75 + Math.random() * 0.5);

export class RateLimiter {
  private tokensPerSecond: number;
  private burstCapacity: number;
  private lastTokenRefill: number;
  private tokens: number;
  // Shared cooldown: set when anything sees a 429, respected by every caller.
  private blockedUntil = 0;
  private consecutive429 = 0;
  private last429At = 0;
  private stats = { calls: 0, rateLimited: 0, cooldownMs: 0 };

  constructor(callsPerMinute: number) {
    this.tokensPerSecond = callsPerMinute / 60;
    this.burstCapacity = Math.max(5, Math.floor(callsPerMinute / 6));
    this.tokens = this.burstCapacity;
    this.lastTokenRefill = Date.now();
  }

  private refillTokens() {
    const now = Date.now();
    const elapsed = (now - this.lastTokenRefill) / 1000;
    this.tokens = Math.min(this.burstCapacity, this.tokens + elapsed * this.tokensPerSecond);
    this.lastTokenRefill = now;
  }

  // A 429 anywhere stops the whole process for a spell that doubles while the
  // pressure lasts. Jittered, because seven containers backing off in lockstep
  // just rebuild the same spike one interval later.
  notifyRateLimited() {
    const now = Date.now();
    if (now - this.last429At > COOLDOWN_RESET_MS) this.consecutive429 = 0;
    this.last429At = now;
    this.consecutive429 += 1;
    this.stats.rateLimited += 1;
    const wait = jitter(Math.min(COOLDOWN_MAX_MS, COOLDOWN_BASE_MS * 2 ** (this.consecutive429 - 1)));
    this.blockedUntil = Math.max(this.blockedUntil, now + wait);
    this.stats.cooldownMs += wait;
    if (this.consecutive429 === 1 || this.consecutive429 % 25 === 0) {
      console.warn(`[rate-limit] 429 #${this.consecutive429} — holding ${Math.round(wait / 1000)}s (budget ${Math.round(this.tokensPerSecond * 60)}/min)`);
    }
  }

  notifyOk() {
    if (this.consecutive429 && Date.now() - this.last429At > COOLDOWN_RESET_MS) this.consecutive429 = 0;
  }

  private async waitForToken() {
    while (true) {
      const now = Date.now();
      if (now < this.blockedUntil) {
        await new Promise((r) => setTimeout(r, Math.min(1000, this.blockedUntil - now)));
        continue;
      }
      this.refillTokens();
      if (this.tokens >= 1) { this.tokens -= 1; return; }
      // Jittered so the containers do not all wake on the same tick.
      await new Promise((r) => setTimeout(r, jitter(120)));
    }
  }

  // Most callers hand back a fetch Response, so a 429 is detected here without
  // every call site having to remember. Anything else passes through untouched.
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.waitForToken();
    this.stats.calls += 1;
    try {
      const out = await fn();
      const status = (out as { status?: unknown } | null)?.status;
      if (typeof status === "number") {
        if (status === 429) this.notifyRateLimited();
        else if (status < 400) this.notifyOk();
      }
      return out;
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number }; status?: number })?.response?.status
        ?? (err as { status?: number })?.status;
      if (status === 429) this.notifyRateLimited();
      throw err;
    }
  }

  snapshot() {
    return { ...this.stats, perMinute: Math.round(this.tokensPerSecond * 60), blockedForMs: Math.max(0, this.blockedUntil - Date.now()) };
  }
}

export const RATE_LIMIT_PER_MIN = EFFECTIVE;
export const globalRateLimiter = new RateLimiter(EFFECTIVE);
console.log(`[rate-limit] ${EFFECTIVE}/min for this container — ${FLEET_PER_MIN}/min fleet ÷ ${FLEET_CONTAINERS} containers${CAP != null && CAP > DERIVED ? `, capping the configured ${CAP}` : ""}`);
