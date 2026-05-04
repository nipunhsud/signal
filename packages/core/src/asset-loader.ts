import fs from 'fs';

export interface AssetTier {
  symbols: string[];
  description: string;
}

export class AssetLoader {
  private cache: Map<string, string[]> = new Map();

  /**
   * Load assets from a TradingView-format file (NYSE:AA,NYSE:AAMI,...)
   * Strips the exchange prefix and returns just symbols
   */
  loadFromFile(filePath: string): string[] {
    if (this.cache.has(filePath)) {
      return this.cache.get(filePath)!;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const symbols = content
      .split(',')
      .map((s) => s.trim())
      .map((s) => {
        // Strip exchange prefix (NYSE:AAPL → AAPL)
        const parts = s.split(':');
        return parts[parts.length - 1];
      })
      .filter((s) => s.length > 0);

    this.cache.set(filePath, symbols);
    return symbols;
  }

  /**
   * Load and slice assets by tier (e.g., first 50, next 50, etc.)
   * Useful for staggered scanning to avoid API rate limits
   */
  loadTier(filePath: string, tierNumber: number, tierSize: number = 50): string[] {
    const all = this.loadFromFile(filePath);
    const start = (tierNumber - 1) * tierSize;
    return all.slice(start, start + tierSize);
  }

  /**
   * Load a specific number of symbols, optionally randomized
   * Useful for testing or light scanning
   */
  loadSubset(filePath: string, count: number, randomize: boolean = false): string[] {
    let symbols = this.loadFromFile(filePath);

    if (randomize) {
      symbols = symbols.sort(() => Math.random() - 0.5);
    }

    return symbols.slice(0, count);
  }

  /**
   * Get all symbols
   */
  loadAll(filePath: string): string[] {
    return this.loadFromFile(filePath);
  }
}

export const assetLoader = new AssetLoader();
