import fs from 'fs';

export interface Config {
  assets: string[];
  dataSource: 'binance' | 'alpaca' | 'ibkr' | 'fmp';
  cronSchedule: string;
  geminiApiKey: string;
  emailService: string;
  ibkrBaseUrl: string;
}

function parseAssets(filePath: string): string[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  return content
    .split(',')
    .map((s) => s.trim())
    .map((s) => {
      const parts = s.split(':');
      return parts[parts.length - 1];
    })
    .filter((s) => s.length > 0);
}

function loadTier(filePath: string, tierNumber: number, tierSize: number): string[] {
  const all = parseAssets(filePath);
  const start = (tierNumber - 1) * tierSize;
  return all.slice(start, start + tierSize);
}

function loadSubset(filePath: string, count: number): string[] {
  const symbols = parseAssets(filePath);
  return symbols.slice(0, count);
}

export function getConfig(): Config {
  let assets: string[] = [];

  // Method 1: Load from file (ASSETS_FILE_PATH)
  if (process.env.ASSETS_FILE_PATH) {
    const filePath = process.env.ASSETS_FILE_PATH;
    const tier = parseInt(process.env.ASSETS_TIER || '1');
    const tierSize = parseInt(process.env.ASSETS_TIER_SIZE || '50');

    if (process.env.ASSETS_MODE === 'tier') {
      assets = loadTier(filePath, tier, tierSize);
    } else if (process.env.ASSETS_MODE === 'subset') {
      const count = parseInt(process.env.ASSETS_SUBSET_COUNT || '20');
      assets = loadSubset(filePath, count);
    } else {
      assets = parseAssets(filePath);
    }
  }
  // Method 2: Load from env var (comma-separated)
  else {
    const assetsStr = process.env.SCAN_ASSETS || 'AAPL,MSFT,NVDA';
    assets = assetsStr.split(',').map((a) => a.trim());
  }

  // Deduplicate assets
  assets = [...new Set(assets)];

  return {
    assets,
    dataSource: (process.env.DATA_SOURCE || 'ibkr') as 'binance' | 'alpaca' | 'ibkr' | 'fmp',
    cronSchedule: process.env.CRON_SCHEDULE || '0 * * * *', // hourly
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    emailService: process.env.EMAIL_SERVICE || 'gmail',
    ibkrBaseUrl: process.env.IBKR_BASE_URL || 'https://localhost:5000',
  };
}
