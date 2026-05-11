import axios, { AxiosInstance } from "axios";
import https from "https";

export interface IBPosition {
  conid: number;
  contractDesc: string;
  position: number;
  mktPrice: number;
  mktValue: number;
  avgCost: number;
  unrealizedPnl: number;
}

export interface IBOrderResult {
  orderId: string;
  orderStatus: string;
}

export class IBClient {
  private http: AxiosInstance;
  private accountId: string | null = null;
  private conidCache: Map<string, string> = new Map();
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private _baseUrl: string) {
    this.http = axios.create({
      baseURL: this._baseUrl,
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      timeout: 10_000,
    });
  }

  startKeepalive(): void {
    if (this.keepaliveTimer) return;
    this.keepaliveTimer = setInterval(async () => {
      try {
        await this.http.post("/v1/api/tickle");
      } catch (err) {
        console.warn(
          "[IBClient] Tickle failed:",
          err instanceof Error ? err.message : err,
        );
      }
    }, 60_000);
    this.keepaliveTimer.unref();
  }

  stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  async checkAuth(): Promise<void> {
    const resp = await this.http.get("/v1/api/iserver/auth/status");
    const data = resp.data as { authenticated: boolean; connected: boolean };
    if (!data.authenticated) {
      throw new Error(
        "IB gateway is not authenticated. Log in via the gateway UI.",
      );
    }
  }

  async getAccountId(): Promise<string> {
    if (this.accountId) return this.accountId;
    const resp = await this.http.get("/v1/api/iserver/accounts");
    const accounts = resp.data.accounts as string[];
    if (!accounts.length) throw new Error("No IB accounts found");
    this.accountId = accounts[0];
    return this.accountId;
  }

  async resolveConid(symbol: string): Promise<string> {
    const cached = this.conidCache.get(symbol);
    if (cached) return cached;

    const resp = await this.http.get("/v1/api/iserver/secdef/search", {
      params: { symbol, secType: "STK", name: false },
    });

    const contracts = resp.data as Array<{
      conid: string;
      companyName: string;
    }>;
    if (!contracts.length)
      throw new Error(`No contracts found for symbol: ${symbol}`);

    const conid = contracts[0].conid;
    this.conidCache.set(symbol, conid);
    return conid;
  }

  async getHistoricalBars(
    conid: string,
    period = "5d",
  ): Promise<
    Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>
  > {
    const resp = await this.http.get("/v1/api/iserver/marketdata/history", {
      params: { conid, period, bar: "1h", outsideRth: false },
    });
    return (resp.data.data || []) as Array<{
      t: number;
      o: number;
      h: number;
      l: number;
      c: number;
      v: number;
    }>;
  }

  async getPositions(accountId: string): Promise<IBPosition[]> {
    const resp = await this.http.get(
      `/v1/api/portfolio/${accountId}/positions/0`,
    );
    return resp.data as IBPosition[];
  }

  async getCashBalance(accountId: string): Promise<number> {
    const resp = await this.http.get(`/v1/api/portfolio/${accountId}/summary`);
    const summary = resp.data as Record<string, any>;

    const cashField = summary["cashbalance"] as any;
    if (cashField?.USD?.amount !== undefined) return cashField.USD.amount;
    if (cashField?.amount !== undefined) return cashField.amount;
    if (typeof cashField === "object") {
      for (const key of Object.keys(cashField)) {
        const entry = cashField[key];
        if (entry && typeof entry.amount === "number") return entry.amount;
      }
    }
    throw new Error("Could not parse cash balance from account summary");
  }

  async placeOrder(params: {
    accountId: string;
    conid: string;
    side: "BUY" | "SELL";
    quantity: number;
    orderType?: "MKT" | "LMT";
    price?: number;
    outsideRth?: boolean;
  }): Promise<IBOrderResult> {
    const orderBody = {
      orders: [
        {
          conid: parseInt(params.conid, 10),
          secType: `${params.conid}:STK`,
          orderType: params.orderType || "MKT",
          side: params.side,
          quantity: params.quantity,
          tif: "DAY",
          price: params.price,
          outsideRth: params.outsideRth ?? false,
        },
      ],
    };

    const resp = await this.http.post(
      `/v1/api/iserver/account/${params.accountId}/orders`,
      orderBody,
    );

    const results = resp.data as Array<{
      orderId: string;
      order_status: string;
    }>;
    if (!results.length) throw new Error("No order result returned from IB");

    return {
      orderId: results[0].orderId,
      orderStatus: results[0].order_status,
    };
  }
}
