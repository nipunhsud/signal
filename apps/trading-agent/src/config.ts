export interface TradingConfig {
  ibkrBaseUrl: string;
  maxPositionSize: number;
  stopLossPercent: number;
  cronSchedule: string;
  geminiApiKey: string;
}

export function getConfig(): TradingConfig {
  const maxPos = parseFloat(process.env.MAX_POSITION_SIZE || '95');

  return {
    ibkrBaseUrl: process.env.IBKR_BASE_URL || 'https://localhost:5000',
    maxPositionSize: Math.min(maxPos, 95),
    stopLossPercent: parseFloat(process.env.STOP_LOSS_PERCENT || '0.02'),
    cronSchedule: process.env.TRADE_CRON_SCHEDULE || '*/5 * * * *',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
  };
}
