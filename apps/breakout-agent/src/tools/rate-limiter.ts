export class RateLimiter {
  private tokensPerSecond: number;
  private burstCapacity: number;
  private lastTokenRefill: number;
  private tokens: number;

  constructor(callsPerMinute: number = 400) {
    this.tokensPerSecond = callsPerMinute / 60;
    this.burstCapacity = Math.max(10, Math.floor(callsPerMinute / 6));
    this.tokens = this.burstCapacity;
    this.lastTokenRefill = Date.now();
  }

  private refillTokens() {
    const now = Date.now();
    const elapsed = (now - this.lastTokenRefill) / 1000;
    this.tokens = Math.min(
      this.burstCapacity,
      this.tokens + elapsed * this.tokensPerSecond,
    );
    this.lastTokenRefill = now;
  }

  private async waitForToken() {
    while (true) {
      this.refillTokens();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.waitForToken();
    return fn();
  }
}

const callsPerMinute = parseInt(process.env.RATE_LIMIT_PER_MIN || "400");
export const globalRateLimiter = new RateLimiter(callsPerMinute);
