interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

export class Cache {
  private data = new Map<string, CacheEntry<any>>();
  private ttlMs: number;

  constructor(ttlSeconds: number = 300) {
    this.ttlMs = ttlSeconds * 1000;
  }

  set<T>(key: string, value: T): void {
    this.data.set(key, { value, timestamp: Date.now() });
  }

  get<T>(key: string): T | null {
    const entry = this.data.get(key);
    if (!entry) return null;

    const age = Date.now() - entry.timestamp;
    if (age > this.ttlMs) {
      this.data.delete(key);
      return null;
    }

    return entry.value as T;
  }

  clear(): void {
    this.data.clear();
  }

  size(): number {
    return this.data.size;
  }
}

export const marketDataCache = new Cache(300); // 5-minute TTL for market data
