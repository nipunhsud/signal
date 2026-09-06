// Minimal broker surface the agent needs. Alpaca implements it today; an IBKR
// adapter can be added without touching agent.ts.
export interface BrokerAccount {
  id: string;
  equity: number;
  cash: number;
  buyingPower: number;
}

export interface BrokerPosition {
  symbol: string;
  qty: number;
  avgEntryPrice: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
}

export type OrderStatus =
  | "new"
  | "accepted"
  | "pending"
  | "held"
  | "partially_filled"
  | "filled"
  | "canceled"
  | "expired"
  | "rejected"
  | "replaced"
  | "unknown";

export interface BrokerOrder {
  id: string;
  clientOrderId: string;
  symbol: string;
  side: "buy" | "sell";
  type: string;
  status: OrderStatus;
  qty: number;
  filledQty: number;
  filledAvgPrice: number | null;
  filledAt: Date | null;
  submittedAt: Date | null;
  legs: BrokerOrder[];
}

export interface EntryWithStopParams {
  symbol: string;
  qty: number;
  stopPrice: number;
  clientOrderId: string;
}

export interface DailyBar {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface Broker {
  readonly name: string;
  getAccount(): Promise<BrokerAccount>;
  getPositions(): Promise<BrokerPosition[]>;
  isMarketOpen(): Promise<boolean>;
  isTradable(symbol: string): Promise<boolean>;
  getLatestPrice(symbol: string): Promise<number | null>;
  /** Market buy that, once filled, arms a GTC stop-loss (one-triggers-other). */
  submitEntryWithStop(p: EntryWithStopParams): Promise<BrokerOrder>;
  getOrder(id: string): Promise<BrokerOrder | null>;
  getOrderByClientId(clientOrderId: string): Promise<BrokerOrder | null>;
  listClosedOrders(symbol: string, after: Date): Promise<BrokerOrder[]>;
  /** Cancels working orders on the symbol and market-sells the whole position. */
  closePosition(symbol: string): Promise<BrokerOrder | null>;
  /** Most recent completed daily bars, oldest first. */
  getDailyBars(symbol: string, limit: number): Promise<DailyBar[]>;
  /** Moves a working stop order to a new stop price; returns the replacement order. */
  replaceStop(orderId: string, stopPrice: number): Promise<BrokerOrder>;
}

// FMP/Yahoo write class shares as BRK-B; Alpaca (and most brokers) use BRK.B.
export function toBrokerSymbol(asset: string): string {
  return asset.replace(/-/g, ".");
}
