import type {
  Broker,
  BrokerAccount,
  BrokerOrder,
  BrokerPosition,
  DailyBar,
  EntryWithStopParams,
  OrderStatus,
} from "./types.js";

// Alpaca Trading API v2 over plain fetch (Node 20+). Paper and live differ
// only by base URL; the data API (latest trade) is a separate host and works
// with the same keys on the free IEX feed.
export interface AlpacaOptions {
  keyId: string;
  secretKey: string;
  tradingBaseUrl: string;
  dataBaseUrl: string;
  timeoutMs?: number;
}

interface AlpacaOrder {
  id: string;
  client_order_id: string;
  symbol: string;
  side: "buy" | "sell";
  type: string;
  status: string;
  qty: string | null;
  filled_qty: string | null;
  filled_avg_price: string | null;
  filled_at: string | null;
  submitted_at: string | null;
  legs?: AlpacaOrder[] | null;
}

export class AlpacaBroker implements Broker {
  readonly name = "alpaca";
  private readonly timeoutMs: number;

  constructor(private readonly opts: AlpacaOptions) {
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  private async request<T>(
    base: string,
    path: string,
    init: { method?: string; body?: unknown; allow404?: boolean } = {},
  ): Promise<T | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(base + path, {
        method: init.method || "GET",
        headers: {
          "APCA-API-KEY-ID": this.opts.keyId,
          "APCA-API-SECRET-KEY": this.opts.secretKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: ctrl.signal,
      });
      if (res.status === 404 && init.allow404) return null;
      const text = await res.text();
      if (!res.ok) {
        throw new Error(
          `Alpaca ${init.method || "GET"} ${path} → ${res.status}: ${text.slice(0, 300)}`,
        );
      }
      return text ? (JSON.parse(text) as T) : null;
    } finally {
      clearTimeout(timer);
    }
  }

  private trading<T>(
    path: string,
    init?: { method?: string; body?: unknown; allow404?: boolean },
  ) {
    return this.request<T>(this.opts.tradingBaseUrl, path, init);
  }

  async getAccount(): Promise<BrokerAccount> {
    const a = (await this.trading<any>("/v2/account"))!;
    if (a.trading_blocked || a.account_blocked) {
      throw new Error(`Alpaca account ${a.id} is blocked from trading`);
    }
    return {
      id: a.id,
      equity: Number(a.equity),
      cash: Number(a.cash),
      buyingPower: Number(a.buying_power),
    };
  }

  async getPositions(): Promise<BrokerPosition[]> {
    const rows = (await this.trading<any[]>("/v2/positions")) || [];
    return rows.map((p) => ({
      symbol: p.symbol,
      qty: Number(p.qty),
      avgEntryPrice: Number(p.avg_entry_price),
      currentPrice: Number(p.current_price),
      marketValue: Number(p.market_value),
      unrealizedPnl: Number(p.unrealized_pl),
    }));
  }

  async isMarketOpen(): Promise<boolean> {
    const c = (await this.trading<any>("/v2/clock"))!;
    return Boolean(c.is_open);
  }

  async isTradable(symbol: string): Promise<boolean> {
    const a = await this.trading<any>(
      `/v2/assets/${encodeURIComponent(symbol)}`,
      { allow404: true },
    );
    return Boolean(a && a.tradable && a.status === "active");
  }

  async getLatestPrice(symbol: string): Promise<number | null> {
    const r = await this.request<any>(
      this.opts.dataBaseUrl,
      `/v2/stocks/${encodeURIComponent(symbol)}/trades/latest?feed=iex`,
      { allow404: true },
    );
    const p = r?.trade?.p;
    return typeof p === "number" && p > 0 ? p : null;
  }

  async submitEntryWithStop(p: EntryWithStopParams): Promise<BrokerOrder> {
    // OTO: the stop-loss leg is created only after the entry fills. GTC so the
    // stop survives past today's close; the market entry itself fills at once.
    const body = {
      symbol: p.symbol,
      qty: String(p.qty),
      side: "buy",
      type: "market",
      time_in_force: "gtc",
      order_class: "oto",
      client_order_id: p.clientOrderId,
      stop_loss: { stop_price: p.stopPrice.toFixed(2) },
    };
    const o = (await this.trading<AlpacaOrder>("/v2/orders", {
      method: "POST",
      body,
    }))!;
    return mapOrder(o);
  }

  async getOrder(id: string): Promise<BrokerOrder | null> {
    const o = await this.trading<AlpacaOrder>(`/v2/orders/${id}?nested=true`, {
      allow404: true,
    });
    return o ? mapOrder(o) : null;
  }

  async getOrderByClientId(clientOrderId: string): Promise<BrokerOrder | null> {
    const o = await this.trading<AlpacaOrder>(
      `/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`,
      { allow404: true },
    );
    return o ? mapOrder(o) : null;
  }

  async listClosedOrders(symbol: string, after: Date): Promise<BrokerOrder[]> {
    const q = new URLSearchParams({
      status: "closed",
      symbols: symbol,
      after: after.toISOString(),
      limit: "100",
      nested: "true",
      direction: "asc",
    });
    const rows = (await this.trading<AlpacaOrder[]>(`/v2/orders?${q}`)) || [];
    return rows.map(mapOrder);
  }

  async getDailyBars(symbol: string, limit: number): Promise<DailyBar[]> {
    // Calendar window generous enough to hold `limit` trading days.
    const start = new Date(
      Date.now() - Math.ceil(limit * 1.6 + 10) * 24 * 60 * 60 * 1000,
    ).toISOString();
    const q = new URLSearchParams({
      timeframe: "1Day",
      start,
      limit: "1000",
      adjustment: "split",
      feed: "iex",
      sort: "asc",
    });
    const r = await this.request<any>(
      this.opts.dataBaseUrl,
      `/v2/stocks/${encodeURIComponent(symbol)}/bars?${q}`,
      { allow404: true },
    );
    const bars: DailyBar[] = (r?.bars || []).map((b: any) => ({
      date: String(b.t).slice(0, 10),
      open: Number(b.o),
      high: Number(b.h),
      low: Number(b.l),
      close: Number(b.c),
    }));
    return bars.slice(-limit);
  }

  async replaceStop(orderId: string, stopPrice: number): Promise<BrokerOrder> {
    const o = (await this.trading<AlpacaOrder>(`/v2/orders/${orderId}`, {
      method: "PATCH",
      body: { stop_price: stopPrice.toFixed(2) },
    }))!;
    return mapOrder(o);
  }

  async closePosition(symbol: string): Promise<BrokerOrder | null> {
    const o = await this.trading<AlpacaOrder>(
      `/v2/positions/${encodeURIComponent(symbol)}?cancel_orders=true`,
      { method: "DELETE", allow404: true },
    );
    return o ? mapOrder(o) : null;
  }
}

const STATUS_MAP: Record<string, OrderStatus> = {
  new: "new",
  accepted: "accepted",
  pending_new: "pending",
  accepted_for_bidding: "pending",
  held: "held",
  partially_filled: "partially_filled",
  filled: "filled",
  done_for_day: "canceled",
  canceled: "canceled",
  pending_cancel: "canceled",
  expired: "expired",
  rejected: "rejected",
  replaced: "replaced",
  pending_replace: "replaced",
  stopped: "filled",
  suspended: "held",
  calculated: "pending",
};

function mapOrder(o: AlpacaOrder): BrokerOrder {
  return {
    id: o.id,
    clientOrderId: o.client_order_id,
    symbol: o.symbol,
    side: o.side,
    type: o.type,
    status: STATUS_MAP[o.status] ?? "unknown",
    qty: Number(o.qty ?? 0),
    filledQty: Number(o.filled_qty ?? 0),
    filledAvgPrice:
      o.filled_avg_price != null ? Number(o.filled_avg_price) : null,
    filledAt: o.filled_at ? new Date(o.filled_at) : null,
    submittedAt: o.submitted_at ? new Date(o.submitted_at) : null,
    legs: (o.legs || []).map(mapOrder),
  };
}
