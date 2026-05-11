import { IBClient } from "./tools/ib-client.js";
import { executeOrder, OrderExecutionResult } from "./tools/execute-order.js";
import { db } from "./db.js";
import { TradingConfig } from "./config.js";

export class TradingAgent {
  private ibClient: IBClient;
  private config: TradingConfig;

  constructor(config: TradingConfig) {
    this.config = config;
    this.ibClient = new IBClient(config.ibkrBaseUrl);
  }

  async initialize(): Promise<void> {
    await this.ibClient.checkAuth();
    this.ibClient.startKeepalive();
    console.log("[TradingAgent] IB gateway authenticated. Keepalive started.");
  }

  async executePendingSignals(): Promise<OrderExecutionResult[]> {
    const pendingSignals = await db.breakoutSignal.findMany({
      where: {
        shouldAlert: true,
        executedAt: null,
      },
      orderBy: { createdAt: "asc" },
      take: 10,
    });

    if (!pendingSignals.length) {
      console.log("[TradingAgent] No pending signals.");
      return [];
    }

    console.log(
      `[TradingAgent] Found ${pendingSignals.length} pending signal(s).`,
    );
    const results: OrderExecutionResult[] = [];

    for (const signal of pendingSignals) {
      console.log(
        `[TradingAgent] Processing signal for ${signal.asset} (id=${signal.id})`,
      );

      const ageMs = Date.now() - signal.createdAt.getTime();
      const ageHours = ageMs / (1000 * 60 * 60);

      if (ageHours > 4) {
        console.log(
          `[TradingAgent] Signal for ${signal.asset} is ${ageHours.toFixed(1)}h old, skipping.`,
        );
        await db.breakoutSignal.update({
          where: { id: signal.id },
          data: { executedAt: new Date() },
        });
        results.push({
          asset: signal.asset,
          success: false,
          riskReason: "Signal too old (>4h)",
        });
        continue;
      }

      try {
        const result = await executeOrder({
          signalId: signal.id,
          asset: signal.asset,
          currentPrice: signal.currentPrice,
          client: this.ibClient,
          config: this.config,
        });
        results.push(result);
      } catch (err) {
        console.error(
          `[TradingAgent] Unexpected error for ${signal.asset}:`,
          err,
        );
        results.push({
          asset: signal.asset,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return results;
  }

  shutdown(): void {
    this.ibClient.stopKeepalive();
  }
}
