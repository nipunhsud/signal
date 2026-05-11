export interface PositionSizing {
  quantity: number;
  positionValue: number;
  stopLossPrice: number;
  maxLoss: number;
  canAfford: boolean;
}

export interface RiskCheckResult {
  approved: boolean;
  reason: string;
  sizing?: PositionSizing;
}

export function checkRisk(params: {
  currentPrice: number;
  cashBalance: number;
  maxPositionSize: number;
  stopLossPercent: number;
}): RiskCheckResult {
  const { currentPrice, cashBalance, maxPositionSize, stopLossPercent } =
    params;

  if (currentPrice > maxPositionSize) {
    return {
      approved: false,
      reason: `Share price $${currentPrice.toFixed(2)} exceeds max position size $${maxPositionSize}`,
    };
  }

  const quantity = Math.floor(maxPositionSize / currentPrice);
  if (quantity < 1) {
    return {
      approved: false,
      reason: `Cannot buy even 1 share at $${currentPrice.toFixed(2)} with max position size $${maxPositionSize}`,
    };
  }

  const positionValue = quantity * currentPrice;
  const stopLossPrice = parseFloat(
    (currentPrice * (1 - stopLossPercent)).toFixed(4),
  );
  const maxLoss = positionValue - quantity * stopLossPrice;
  const canAfford = cashBalance >= positionValue;

  if (!canAfford) {
    return {
      approved: false,
      reason: `Insufficient cash: need $${positionValue.toFixed(2)}, have $${cashBalance.toFixed(2)}`,
    };
  }

  if (cashBalance < 95) {
    return {
      approved: false,
      reason: `Cash balance $${cashBalance.toFixed(2)} is below minimum $95 threshold`,
    };
  }

  return {
    approved: true,
    reason: "Risk check passed",
    sizing: { quantity, positionValue, stopLossPrice, maxLoss, canAfford },
  };
}

export function isAlreadyHeld(
  symbol: string,
  positions: Array<{ contractDesc: string; position: number }>,
): boolean {
  return positions.some(
    (p) =>
      p.position > 0 &&
      p.contractDesc.toUpperCase().includes(symbol.toUpperCase()),
  );
}
