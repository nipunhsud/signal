import { IBClient } from "./ib-client.js";
import {
  checkRisk,
  isAlreadyHeld,
  RiskCheckResult,
} from "./risk-management.js";
import { db } from "../db.js";
import { TradingConfig } from "../config.js";

export interface OrderExecutionResult {
  asset: string;
  success: boolean;
  orderId?: string;
  quantity?: number;
  entryPrice?: number;
  stopLossPrice?: number;
  riskReason?: string;
  error?: string;
}

export async function executeOrder(params: {
  signalId: string;
  asset: string;
  currentPrice: number;
  client: IBClient;
  config: TradingConfig;
}): Promise<OrderExecutionResult> {
  const { signalId, asset, currentPrice, client, config } = params;

  try {
    const accountId = await client.getAccountId();

    const [cashBalance, positions] = await Promise.all([
      client.getCashBalance(accountId),
      client.getPositions(accountId),
    ]);

    if (isAlreadyHeld(asset, positions)) {
      return {
        asset,
        success: false,
        riskReason: `Already holding position in ${asset}`,
      };
    }

    const risk: RiskCheckResult = checkRisk({
      currentPrice,
      cashBalance,
      maxPositionSize: config.maxPositionSize,
      stopLossPercent: config.stopLossPercent,
    });

    if (!risk.approved || !risk.sizing) {
      console.log(
        `[ExecuteOrder] Risk check failed for ${asset}: ${risk.reason}`,
      );
      return { asset, success: false, riskReason: risk.reason };
    }

    const { quantity, positionValue, stopLossPrice } = risk.sizing;
    const conid = await client.resolveConid(asset);

    const orderResult = await client.placeOrder({
      accountId,
      conid,
      side: "BUY",
      quantity,
      orderType: "MKT",
    });

    console.log(
      `[ExecuteOrder] Order placed for ${asset}: orderId=${orderResult.orderId}, qty=${quantity}, ~$${positionValue.toFixed(2)}`,
    );

    await db.trade.create({
      data: {
        breakoutSignalId: signalId,
        asset,
        conid,
        orderId: orderResult.orderId,
        side: "BUY",
        quantity,
        entryPrice: currentPrice,
        stopLossPrice,
        positionValue,
        maxPositionSize: config.maxPositionSize,
        status: "submitted",
        accountId,
        cashBefore: cashBalance,
      },
    });

    await db.breakoutSignal.update({
      where: { id: signalId },
      data: { executedAt: new Date() },
    });

    return {
      asset,
      success: true,
      orderId: orderResult.orderId,
      quantity,
      entryPrice: currentPrice,
      stopLossPrice,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(
      `[ExecuteOrder] Failed to execute order for ${asset}:`,
      errorMsg,
    );

    try {
      await db.trade.create({
        data: {
          breakoutSignalId: signalId,
          asset,
          conid: "",
          side: "BUY",
          quantity: 0,
          entryPrice: currentPrice,
          stopLossPrice: 0,
          positionValue: 0,
          maxPositionSize: config.maxPositionSize,
          status: "error",
          errorMessage: errorMsg,
          accountId: "unknown",
          cashBefore: 0,
        },
      });
    } catch (_dbErr) {
      // Ignore
    }

    return { asset, success: false, error: errorMsg };
  }
}
