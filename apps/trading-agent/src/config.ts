// All knobs come from env so the same image runs paper and (later) live.
// Defaults are deliberately conservative: 1% of equity at risk per trade,
// 20% of equity per position, 5 open positions, halt after a 3% day.
export type TradingMode = "paper" | "live";

// Operating points from the sizing grid in docs/exit-rules-study.md. One env
// lever, TRADE_PROFILE, picks the preset; any explicit TRADE_* variable still
// overrides the preset's value.
//   invested      10 slots · 1% risk · trail 20% on every grade → ~13%/yr at 10 bp, 27% max DD (with the RS rank + 200MA switch)
//   conservative   5 slots · 1% risk · trail 20% on every grade → ~9%/yr, 25% max DD, ~1/3 in cash
//   rotation      10 slots · 1% risk · no trail, sell after 60 days → ~19%/yr at 10 bp, 55% max DD
export type TradingProfile = "invested" | "conservative" | "rotation";
export const PROFILES: Record<
  TradingProfile,
  {
    maxOpenPositions: number;
    riskPerTradePct: number;
    trailGrades: string;
    trailPct: number;
    maExit: number;
    holdDays: number;
  }
> = {
  invested: {
    maxOpenPositions: 10,
    riskPerTradePct: 1,
    trailGrades: "S,A+,A",
    trailPct: 20,
    maExit: 50,
    holdDays: 365,
  },
  conservative: {
    maxOpenPositions: 5,
    riskPerTradePct: 1,
    trailGrades: "S,A+,A",
    trailPct: 20,
    maExit: 50,
    holdDays: 365,
  },
  // Growth-first clock rotation: 7% stop, no trail, sell after ~42 bars and
  // hand the slot to the strongest new breakout. ~19%/yr at 10 bp/side in the
  // study, 55% worst drawdown.
  rotation: {
    maxOpenPositions: 10,
    riskPerTradePct: 1,
    trailGrades: "",
    trailPct: 0,
    maExit: 0,
    holdDays: 60,
  },
};

export interface TradingConfig {
  profile: TradingProfile;
  enabled: boolean;
  mode: TradingMode;
  liveConfirmed: boolean;
  alpaca: {
    keyId: string;
    secretKey: string;
    tradingBaseUrl: string;
    dataBaseUrl: string;
  };
  riskPerTradePct: number; // % of equity lost if the stop fills
  maxPositionPct: number; // % of equity in any single position
  maxOpenPositions: number;
  maxDailyLossPct: number; // % drawdown from day-start equity that halts new entries
  maxSignalAgeHours: number; // only act on alerts younger than this
  maxPctAbovePivot: number; // beyond this the dashboard calls the row "extended"
  holdDays: number; // calendar days before a time exit (backstop); 0 disables
  maExit: number; // sell at next open after a close below this SMA; 0 disables
  trailPct: number; // trailing stop % from the peak high; replaces the MA exit on trailGrades; 0 disables
  trailGrades: string[]; // grades managed by the trail instead of the MA exit (default S only)
  allowedGrades: string[];
  allowEtfs: boolean;
  rsMin: number; // 0-99: skip candidates whose rsRating is below this (0 = no floor)
  regimeMa: number; // market switch: SPY close vs this SMA; 0 disables
  regimeExit: boolean; // also flatten the book while SPY is below the SMA
  regimeSymbol: string;
  cronSchedule: string;
}

let envRef: NodeJS.ProcessEnv = process.env;
function num(name: string, fallback: number): number {
  const raw = envRef[name];
  if (raw === undefined || raw === "") return fallback;
  const v = Number(raw);
  if (!Number.isFinite(v))
    throw new Error(`${name} must be a number, got "${raw}"`);
  return v;
}

export function getConfig(env: NodeJS.ProcessEnv = process.env): TradingConfig {
  const mode = (env.TRADING_MODE || "paper") as TradingMode;
  if (mode !== "paper" && mode !== "live") {
    throw new Error(`TRADING_MODE must be "paper" or "live", got "${mode}"`);
  }
  const profile = (env.TRADE_PROFILE || "invested") as TradingProfile;
  if (!PROFILES[profile]) {
    throw new Error(
      `TRADE_PROFILE must be one of ${Object.keys(PROFILES).join(", ")}, got "${profile}"`,
    );
  }
  const preset = PROFILES[profile];
  envRef = env;
  const defaultTradingUrl =
    mode === "live"
      ? "https://api.alpaca.markets"
      : "https://paper-api.alpaca.markets";
  return {
    profile,
    enabled: env.TRADING_ENABLED === "true",
    mode,
    liveConfirmed: env.TRADING_LIVE_CONFIRM === "I_UNDERSTAND",
    alpaca: {
      keyId: env.ALPACA_API_KEY || "",
      secretKey: env.ALPACA_API_SECRET || "",
      tradingBaseUrl: env.ALPACA_TRADING_URL || defaultTradingUrl,
      dataBaseUrl: env.ALPACA_DATA_URL || "https://data.alpaca.markets",
    },
    riskPerTradePct: num("TRADE_RISK_PCT", preset.riskPerTradePct),
    maxPositionPct: num("TRADE_MAX_POSITION_PCT", 20),
    maxOpenPositions: Math.floor(
      num("TRADE_MAX_OPEN_POSITIONS", preset.maxOpenPositions),
    ),
    maxDailyLossPct: num("TRADE_MAX_DAILY_LOSS_PCT", 3),
    maxSignalAgeHours: num("TRADE_MAX_SIGNAL_AGE_HOURS", 24),
    maxPctAbovePivot: num("TRADE_MAX_PCT_ABOVE_PIVOT", 5),
    holdDays: Math.floor(num("TRADE_HOLD_DAYS", preset.holdDays)),
    maExit: Math.floor(num("TRADE_MA_EXIT", preset.maExit)),
    trailPct: num("TRADE_TRAIL_PCT", preset.trailPct),
    trailGrades: (env.TRADE_TRAIL_GRADES || preset.trailGrades)
      .split(",")
      .map((g) => g.trim())
      .filter(Boolean),
    allowedGrades: (env.TRADE_ALLOWED_GRADES || "S,A+,A")
      .split(",")
      .map((g) => g.trim())
      .filter(Boolean),
    allowEtfs: (env.TRADE_ALLOW_ETFS || "true") === "true",
    rsMin: num("TRADE_RS_MIN", 0),
    regimeMa: Math.floor(num("TRADE_REGIME_MA", 200)),
    regimeExit: (env.TRADE_REGIME_EXIT || "true") === "true",
    regimeSymbol: env.TRADE_REGIME_SYMBOL || "SPY",
    cronSchedule: env.TRADE_CRON_SCHEDULE || "*/5 * * * 1-5",
  };
}

// Refuses to start in a state that could place unintended orders.
export function validateConfig(c: TradingConfig): string[] {
  const problems: string[] = [];
  if (!c.alpaca.keyId || !c.alpaca.secretKey)
    problems.push("ALPACA_API_KEY / ALPACA_API_SECRET missing");
  if (c.mode === "live" && !c.liveConfirmed)
    problems.push(
      "TRADING_MODE=live requires TRADING_LIVE_CONFIRM=I_UNDERSTAND",
    );
  if (c.mode === "live" && /paper-api/.test(c.alpaca.tradingBaseUrl))
    problems.push("live mode pointed at the paper URL");
  if (c.mode === "paper" && !/paper-api/.test(c.alpaca.tradingBaseUrl))
    problems.push("paper mode must use the paper-api URL");
  if (c.riskPerTradePct <= 0 || c.riskPerTradePct > 5)
    problems.push("TRADE_RISK_PCT must be in (0, 5]");
  if (c.maxPositionPct <= 0 || c.maxPositionPct > 100)
    problems.push("TRADE_MAX_POSITION_PCT must be in (0, 100]");
  if (c.maxOpenPositions < 1)
    problems.push("TRADE_MAX_OPEN_POSITIONS must be >= 1");
  return problems;
}
