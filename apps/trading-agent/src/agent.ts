import { db } from "./db.js";
import type { TradingConfig } from "./config.js";
import type { Broker, BrokerOrder, BrokerPosition } from "./broker/types.js";
import { toBrokerSymbol } from "./broker/types.js";
import {
  dailyLossBreached,
  entryZone,
  isUsSymbol,
  sizePosition,
} from "./risk.js";
import { afterClose, closedBelowMa, nyDate, trailingStop } from "./exits.js";
import {
  passesRsFloor,
  rankCandidates,
  regimeFrom,
  type Regime,
} from "./selection.js";

export const KILL_SWITCH_KEY = "trading_halted"; // RuntimeFlag value "true" stops new entries
const DAY_EQUITY_KEY = "trading_day_equity"; // RuntimeFlag JSON {date, equity}
const DAILY_REVIEW_KEY = "trading_daily_review"; // RuntimeFlag: NY date of the last completed sell-rule review
const REGIME_KEY = "trading_regime"; // RuntimeFlag JSON Regime — the market switch, refreshed once per NY date

export interface CycleSummary {
  halted: string | null;
  reconciled: number;
  reviewed: number; // positions checked by the after-close sell-rule review
  exits: number; // positions sent to market (time backstop or a fired sell rule)
  entered: string[];
  skipped: Array<{ asset: string; reason: string; permanent: boolean }>;
  errors: string[];
}

export class TradingAgent {
  constructor(
    private readonly broker: Broker,
    private readonly config: TradingConfig,
  ) {}

  async runCycle(): Promise<CycleSummary> {
    const started = Date.now();
    const summary: CycleSummary = {
      halted: null,
      reconciled: 0,
      reviewed: 0,
      exits: 0,
      entered: [],
      skipped: [],
      errors: [],
    };

    try {
      // Bookkeeping always runs, even when entries are halted: fills and
      // stops must be recorded regardless of whether we are adding risk.
      summary.reconciled = await this.reconcileOpenTrades(summary);
      summary.reviewed = await this.dailyReview(summary);
      summary.exits = await this.executeExits(summary);

      const halted = await this.entryHaltReason();
      if (halted) {
        summary.halted = halted;
        console.log(`[trader] entries halted: ${halted}`);
      } else {
        await this.enterNewSignals(summary);
      }
    } catch (err) {
      summary.errors.push(err instanceof Error ? err.message : String(err));
    }

    await db.agentRun.create({
      data: {
        agentName: `trading-agent:${this.config.mode}`,
        status: summary.errors.length
          ? summary.entered.length
            ? "partial"
            : "error"
          : "success",
        signalsFound: summary.entered.length + summary.skipped.length,
        alertsSent: summary.entered.length,
        errorMessage: summary.errors.length
          ? summary.errors.join(" | ").slice(0, 2000)
          : null,
        duration: Date.now() - started,
        completedAt: new Date(),
      },
    });
    return summary;
  }

  // ---------- guards ----------

  private async entryHaltReason(): Promise<string | null> {
    const flag = await db.runtimeFlag.findUnique({
      where: { key: KILL_SWITCH_KEY },
    });
    if (flag?.value === "true")
      return "kill switch (RuntimeFlag trading_halted=true)";

    const regime = await this.currentRegime();
    if (regime && !regime.above) {
      return `market regime: ${regime.symbol} $${regime.close.toFixed(2)} below its ${this.config.regimeMa}MA $${regime.ma.toFixed(2)} (${regime.date})`;
    }

    const account = await this.broker.getAccount();
    const today = nyDate();
    const row = await db.runtimeFlag.findUnique({
      where: { key: DAY_EQUITY_KEY },
    });
    let dayStart: { date: string; equity: number } | null = null;
    try {
      dayStart = row ? JSON.parse(row.value) : null;
    } catch {
      dayStart = null;
    }
    if (!dayStart || dayStart.date !== today) {
      dayStart = { date: today, equity: account.equity };
      await db.runtimeFlag.upsert({
        where: { key: DAY_EQUITY_KEY },
        create: { key: DAY_EQUITY_KEY, value: JSON.stringify(dayStart) },
        update: { value: JSON.stringify(dayStart) },
      });
    }
    if (
      dailyLossBreached(
        dayStart.equity,
        account.equity,
        this.config.maxDailyLossPct,
      )
    ) {
      return `daily loss cap: equity $${account.equity.toFixed(0)} vs day start $${dayStart.equity.toFixed(0)} (${this.config.maxDailyLossPct}%)`;
    }
    return null;
  }

  /**
   * Market switch, cached per NY date in RuntimeFlag. Computed from the
   * benchmark's daily closes including the latest published bar.
   */
  private async currentRegime(): Promise<Regime | null> {
    if (this.config.regimeMa <= 0) return null;
    const today = nyDate();
    const row = await db.runtimeFlag.findUnique({ where: { key: REGIME_KEY } });
    if (row) {
      try {
        const cached = JSON.parse(row.value) as Regime;
        if (cached.date === today && cached.symbol === this.config.regimeSymbol)
          return cached;
      } catch {
        /* recompute */
      }
    }
    const bars = await this.broker.getDailyBars(
      this.config.regimeSymbol,
      this.config.regimeMa + 10,
    );
    const regime = regimeFrom(
      this.config.regimeSymbol,
      today,
      bars.map((b) => b.close),
      this.config.regimeMa,
    );
    if (!regime) return null; // not enough history: fail open (no switch), logged once per cycle
    await db.runtimeFlag.upsert({
      where: { key: REGIME_KEY },
      create: { key: REGIME_KEY, value: JSON.stringify(regime) },
      update: { value: JSON.stringify(regime) },
    });
    return regime;
  }

  // ---------- reconcile ----------

  /** Pulls broker state into Trade rows: entry fills, stop fills, exit fills. */
  private async reconcileOpenTrades(summary: CycleSummary): Promise<number> {
    const open = await db.trade.findMany({
      where: {
        mode: this.config.mode,
        broker: this.broker.name,
        status: { in: ["submitted", "filled", "closing"] },
      },
    });
    if (!open.length) return 0;
    const positions = await this.broker.getPositions();
    const bySymbol = new Map(positions.map((p) => [p.symbol, p]));
    let touched = 0;

    for (const t of open) {
      try {
        const symbol = toBrokerSymbol(t.asset);
        if (t.status === "submitted")
          touched += await this.reconcileSubmitted(t, bySymbol.get(symbol));
        else if (t.status === "filled")
          touched += await this.reconcileFilled(t, bySymbol.get(symbol));
        else if (t.status === "closing")
          touched += await this.reconcileClosing(t, bySymbol.get(symbol));
      } catch (err) {
        summary.errors.push(
          `${t.asset} reconcile: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return touched;
  }

  private async reconcileSubmitted(
    t: TradeRow,
    position: BrokerPosition | undefined,
  ): Promise<number> {
    const order = await this.broker.getOrderByClientId(t.clientOrderId);
    if (!order) {
      // Never reached the broker — safe to release the signal for a retry.
      await db.trade.update({
        where: { id: t.id },
        data: { status: "error", errorMessage: "order not found at broker" },
      });
      return 1;
    }
    if (
      order.status === "filled" ||
      (order.status === "partially_filled" && order.filledQty > 0 && position)
    ) {
      const stopLeg = order.legs.find((l) => l.side === "sell");
      await db.trade.update({
        where: { id: t.id },
        data: {
          status: "filled",
          orderId: order.id,
          stopOrderId: stopLeg?.id ?? t.stopOrderId,
          filledPrice: order.filledAvgPrice,
          filledQty: order.filledQty,
          filledAt: order.filledAt ?? new Date(),
        },
      });
      console.log(
        `[trader] ✓ filled ${t.asset} ${order.filledQty} @ $${order.filledAvgPrice?.toFixed(2)}`,
      );
      return 1;
    }
    if (["canceled", "expired", "rejected"].includes(order.status)) {
      await db.trade.update({
        where: { id: t.id },
        data: {
          status: "canceled",
          orderId: order.id,
          errorMessage: `entry ${order.status}`,
        },
      });
      console.log(`[trader] ✗ ${t.asset} entry ${order.status}`);
      return 1;
    }
    return 0; // still working
  }

  private async reconcileFilled(
    t: TradeRow,
    position: BrokerPosition | undefined,
  ): Promise<number> {
    if (position && position.qty > 0) return 0; // still holding

    // Position gone: the stop leg or a manual sell flattened it.
    const stop = t.stopOrderId
      ? await this.broker.getOrder(t.stopOrderId)
      : null;
    let exit: BrokerOrder | null =
      stop && stop.status === "filled" ? stop : null;
    let reason = "stop";
    if (!exit) {
      const since = t.filledAt ?? t.createdAt;
      const sells = (
        await this.broker.listClosedOrders(toBrokerSymbol(t.asset), since)
      ).filter((o) => o.side === "sell" && o.status === "filled");
      exit = sells[sells.length - 1] ?? null;
      reason = "manual";
    }
    if (!exit) return 0; // position missing but no fill visible yet — look again next cycle

    await this.closeTrade(t, exit, reason);
    return 1;
  }

  private async reconcileClosing(
    t: TradeRow,
    position: BrokerPosition | undefined,
  ): Promise<number> {
    const exit = t.exitOrderId
      ? await this.broker.getOrder(t.exitOrderId)
      : null;
    if (exit && exit.status === "filled") {
      await this.closeTrade(t, exit, t.exitReason ?? "time");
      return 1;
    }
    if (
      !position &&
      exit &&
      ["canceled", "expired", "rejected"].includes(exit.status)
    ) {
      // Exit failed but the position is gone anyway — the stop must have hit first.
      return this.reconcileFilled({ ...t, status: "filled" }, position);
    }
    return 0;
  }

  private async closeTrade(
    t: TradeRow,
    exit: BrokerOrder,
    reason: string,
  ): Promise<void> {
    const entry = t.filledPrice ?? t.entryPrice;
    const qty = exit.filledQty || t.filledQty || t.quantity;
    const exitPrice = exit.filledAvgPrice ?? null;
    const pnl = exitPrice != null ? (exitPrice - entry) * qty : null;
    await db.trade.update({
      where: { id: t.id },
      data: {
        status: "closed",
        exitOrderId: exit.id,
        exitPrice,
        exitAt: exit.filledAt ?? new Date(),
        exitReason: reason,
        realizedPnl: pnl,
      },
    });
    console.log(
      `[trader] ■ closed ${t.asset} (${reason}) ${qty} @ $${exitPrice?.toFixed(2)} pnl ${pnl == null ? "?" : `$${pnl.toFixed(2)}`}`,
    );
  }

  // ---------- sell rules ----------

  /**
   * Once per trading day after the close: for every filled position, either
   * ratchet the S-grade trailing stop up from the peak high, or flag a close
   * below the exit MA. Flags are acted on at the next open by executeExits().
   */
  private async dailyReview(summary: CycleSummary): Promise<number> {
    if (this.config.maExit <= 0 && this.config.trailPct <= 0) return 0;
    const sessionDate = afterClose() ? nyDate() : previousWeekday(nyDate());
    const flag = await db.runtimeFlag.findUnique({
      where: { key: DAILY_REVIEW_KEY },
    });
    if (flag?.value === sessionDate) return 0;

    const open = await db.trade.findMany({
      where: {
        mode: this.config.mode,
        broker: this.broker.name,
        status: "filled",
        exitSignal: null,
      },
    });
    let reviewed = 0;
    let complete = true;
    for (const t of open) {
      try {
        const symbol = toBrokerSymbol(t.asset);
        const bars = await this.broker.getDailyBars(
          symbol,
          Math.max(this.config.maExit, 50) + 10,
        );
        const latest = bars[bars.length - 1];
        if (!latest || latest.date < sessionDate) {
          complete = false; // today's bar not published yet — try again next cycle
          continue;
        }
        const fillDate = nyDate(t.filledAt ?? t.createdAt);
        const useTrail =
          this.config.trailPct > 0 &&
          t.baseGrade != null &&
          this.config.trailGrades.includes(t.baseGrade);
        if (useTrail) {
          const peak = Math.max(
            t.filledPrice ?? t.entryPrice,
            ...bars.filter((b) => b.date > fillDate).map((b) => b.high),
          );
          const next = trailingStop({
            peakHigh: peak,
            trailPct: this.config.trailPct,
            currentStop: t.stopLossPrice,
          });
          if (next && t.stopOrderId) {
            const replaced = await this.broker.replaceStop(t.stopOrderId, next);
            await db.trade.update({
              where: { id: t.id },
              data: { stopLossPrice: next, stopOrderId: replaced.id },
            });
            console.log(
              `[trader] ↑ trail ${t.asset}: stop $${t.stopLossPrice.toFixed(2)} → $${next.toFixed(2)} (peak $${peak.toFixed(2)})`,
            );
          } else if (next && !t.stopOrderId) {
            summary.errors.push(
              `${t.asset}: trail wants $${next} but no stop order id is recorded`,
            );
          }
        } else if (
          this.config.maExit > 0 &&
          closedBelowMa(
            bars.map((b) => b.close),
            this.config.maExit,
          )
        ) {
          const signal = `ma${this.config.maExit}`;
          await db.trade.update({
            where: { id: t.id },
            data: { exitSignal: signal, exitSignalAt: new Date() },
          });
          console.log(
            `[trader] ⚑ ${t.asset} closed $${latest.close.toFixed(2)} below the ${this.config.maExit}MA — sell at next open`,
          );
        }
        reviewed++;
      } catch (err) {
        complete = false;
        summary.errors.push(
          `${t.asset} review: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (complete) {
      await db.runtimeFlag.upsert({
        where: { key: DAILY_REVIEW_KEY },
        create: { key: DAILY_REVIEW_KEY, value: sessionDate },
        update: { value: sessionDate },
      });
    }
    return reviewed;
  }

  /** Flattens positions with a fired sell rule or past the hold-days backstop. Market hours only. */
  private async executeExits(summary: CycleSummary): Promise<number> {
    const cutoff =
      this.config.holdDays > 0
        ? new Date(Date.now() - this.config.holdDays * 24 * 60 * 60 * 1000)
        : null;
    const due = await db.trade.findMany({
      where: {
        mode: this.config.mode,
        broker: this.broker.name,
        status: "filled",
        OR: [
          { exitSignal: { not: null } },
          ...(cutoff ? [{ filledAt: { lte: cutoff } }] : []),
        ],
      },
    });
    if (!due.length) return 0;
    if (!(await this.broker.isMarketOpen())) return 0;

    let n = 0;
    for (const t of due) {
      const reason = t.exitSignal ?? "time";
      try {
        const order = await this.broker.closePosition(toBrokerSymbol(t.asset));
        await db.trade.update({
          where: { id: t.id },
          data: {
            status: "closing",
            exitReason: reason,
            exitOrderId: order?.id ?? null,
          },
        });
        console.log(`[trader] ⏏ exit ${t.asset} (${reason})`);
        n++;
      } catch (err) {
        summary.errors.push(
          `${t.asset} exit (${reason}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return n;
  }

  // ---------- entries ----------

  private async enterNewSignals(summary: CycleSummary): Promise<void> {
    const since = new Date(
      Date.now() - this.config.maxSignalAgeHours * 60 * 60 * 1000,
    );
    // "What we emailed" is the contract: shouldAlert + alertSentAt means the
    // grade gate, liquidity gate, market-hours gate and one-per-base dedup
    // in the breakout agent all passed. executedAt marks rows we've handled.
    // Strongest relative strength first (docs/exit-rules-study.md): when the
    // cycle has more candidates than free slots, the order decides the book.
    const candidates = rankCandidates(
      await db.breakoutSignal.findMany({
        where: {
          shouldAlert: true,
          alertSentAt: { gte: since },
          executedAt: null,
          baseGrade: { in: this.config.allowedGrades },
        },
        orderBy: { alertSentAt: "asc" },
        take: 50,
      }),
    );
    if (!candidates.length) return;

    const marketOpen = await this.broker.isMarketOpen();
    if (!marketOpen) {
      console.log(
        `[trader] ${candidates.length} candidate(s) waiting for market open`,
      );
      return;
    }

    const account = await this.broker.getAccount();
    const positions = await this.broker.getPositions();
    const openTrades = await db.trade.findMany({
      where: {
        mode: this.config.mode,
        broker: this.broker.name,
        status: { in: ["submitted", "filled", "closing"] },
      },
      select: { asset: true },
    });
    const heldSymbols = new Set([
      ...positions.filter((p) => p.qty > 0).map((p) => p.symbol),
      ...openTrades.map((t) => toBrokerSymbol(t.asset)),
    ]);
    let cash = account.cash;
    let openCount = heldSymbols.size;
    const seen = new Set<string>();

    for (const s of candidates) {
      // One evaluation per asset per cycle (multiple rows can carry the same alert).
      if (seen.has(s.asset)) {
        await this.markHandled(s.id);
        continue;
      }
      seen.add(s.asset);

      const skip = async (reason: string, permanent: boolean) => {
        summary.skipped.push({ asset: s.asset, reason, permanent });
        console.log(
          `[trader] ⊘ ${s.asset}: ${reason}${permanent ? "" : " (retry next cycle)"}`,
        );
        if (permanent) await this.recordSkip(s, account, reason);
      };

      if (!isUsSymbol(s.asset)) return skip("non-US symbol", true);
      if (!passesRsFloor(s.rsRating, this.config.rsMin))
        return skip(
          `RS ${s.rsRating ?? "n/a"} below floor ${this.config.rsMin}`,
          true,
        );
      if (s.assetType === "etf" && !this.config.allowEtfs)
        return skip("ETFs disabled", true);
      const symbol = toBrokerSymbol(s.asset);
      if (heldSymbols.has(symbol)) return skip("already held", true);
      if (openCount >= this.config.maxOpenPositions)
        return skip(
          `max open positions (${this.config.maxOpenPositions})`,
          false,
        );

      try {
        if (!(await this.broker.isTradable(symbol)))
          return skip("not tradable at broker", true);
        const price = await this.broker.getLatestPrice(symbol);
        if (!price) return skip("no live quote", false);

        const pivot = s.basePivot ?? s.entryPrice ?? s.resistance;
        const zone = entryZone(price, pivot, this.config.maxPctAbovePivot);
        if (zone === "below-pivot")
          return skip(
            `price $${price.toFixed(2)} back below pivot $${pivot.toFixed(2)}`,
            false,
          );
        if (zone === "extended")
          return skip(
            `price $${price.toFixed(2)} extended >${this.config.maxPctAbovePivot}% past pivot $${pivot.toFixed(2)}`,
            false,
          );

        const stopPrice = s.stopLoss ?? +(pivot * 0.93).toFixed(2);
        const sized = sizePosition({
          equity: account.equity,
          cash,
          price,
          stopPrice,
          riskPerTradePct: this.config.riskPerTradePct,
          maxPositionPct: this.config.maxPositionPct,
        });
        if (!sized.ok) return skip(sized.reason, true);
        const { qty, positionValue, riskAmount, maxPositionSize } =
          sized.sizing;

        const clientOrderId = `sf-${this.config.mode}-${s.id}`.slice(0, 48);
        // Row first, then order: a crash between the two leaves a "submitted"
        // row that reconcile resolves via clientOrderId (found → fill state,
        // not found → error, signal released). Never the reverse.
        const trade = await db.trade.create({
          data: {
            breakoutSignalId: s.id,
            asset: s.asset,
            broker: this.broker.name,
            mode: this.config.mode,
            accountId: account.id,
            clientOrderId,
            side: "BUY",
            quantity: qty,
            entryPrice: price,
            stopLossPrice: stopPrice,
            positionValue,
            maxPositionSize,
            riskAmount,
            baseGrade: s.baseGrade,
            status: "submitted",
            cashBefore: cash,
            equityBefore: account.equity,
          },
        });
        await this.markHandled(s.id);

        try {
          const order = await this.broker.submitEntryWithStop({
            symbol,
            qty,
            stopPrice,
            clientOrderId,
          });
          await db.trade.update({
            where: { id: trade.id },
            data: { orderId: order.id },
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await db.trade.update({
            where: { id: trade.id },
            data: { status: "error", errorMessage: msg.slice(0, 1000) },
          });
          summary.errors.push(`${s.asset} submit: ${msg}`);
          continue;
        }

        cash -= positionValue;
        openCount++;
        heldSymbols.add(symbol);
        summary.entered.push(s.asset);
        console.log(
          `[trader] ▶ BUY ${qty} ${symbol} @ ~$${price.toFixed(2)} stop $${stopPrice.toFixed(2)} (grade ${s.baseGrade}, risk $${riskAmount.toFixed(0)}, ${sized.sizing.binding} bound)`,
        );
      } catch (err) {
        summary.errors.push(
          `${s.asset}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private markHandled(signalId: string) {
    return db.breakoutSignal.update({
      where: { id: signalId },
      data: { executedAt: new Date() },
    });
  }

  /** A skipped row is data for the paper review: "would have traded, but…". */
  private async recordSkip(
    s: SignalRow,
    account: { id: string; equity: number; cash: number },
    reason: string,
  ) {
    await db.trade.create({
      data: {
        breakoutSignalId: s.id,
        asset: s.asset,
        broker: this.broker.name,
        mode: this.config.mode,
        accountId: account.id,
        clientOrderId: `sf-${this.config.mode}-skip-${s.id}`.slice(0, 48),
        side: "BUY",
        quantity: 0,
        entryPrice: s.currentPrice,
        stopLossPrice: s.stopLoss ?? 0,
        positionValue: 0,
        maxPositionSize: 0,
        baseGrade: s.baseGrade,
        status: "skipped",
        errorMessage: reason,
        cashBefore: account.cash,
        equityBefore: account.equity,
      },
    });
    await this.markHandled(s.id);
  }
}

function previousWeekday(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  do d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

type TradeRow = Awaited<ReturnType<typeof db.trade.findFirstOrThrow>>;
type SignalRow = Awaited<ReturnType<typeof db.breakoutSignal.findFirstOrThrow>>;
