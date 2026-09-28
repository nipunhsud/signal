// Form 4 — insider and 10% owner transactions. See insider.js.
export interface InsiderTransaction {
  date: string | null;
  code: string;
  shares: number | null;
  price: number | null;
  ad: string | null;
  planned: boolean;
}
export interface Form4 {
  symbol: string | null;
  issuerCik: string | null;
  periodOfReport: string | null;
  owner: string | null;
  isDirector: boolean;
  isOfficer: boolean;
  isTenPercent: boolean;
  officerTitle: string | null;
  role: string | null;
  transactions: InsiderTransaction[];
  filedAt?: string;
  link?: string;
}
export interface InsiderLatest {
  date: string | null;
  kind: 'buy' | 'sell' | string;
  owner: string | null;
  role: string | null;
  shares: number | null;
  price: number | null;
  planned: boolean;
  link: string | null;
}
export interface InsiderSummary {
  windowDays: number;
  buys: number; sells: number; realSells: number;
  plannedSells: number; exerciseSells: number;
  buyers: number; sellers: number;
  buyShares: number; sellShares: number;
  buyValue: number; sellValue: number; netValue?: number;
  tone: 'buying' | 'selling' | 'mixed' | 'quiet' | string;
  cluster: boolean;
  latest: InsiderLatest | null;
  lastFiledAt: string | null;
  filings: number;
}
export function parseForm4(xml: string | null | undefined): Form4 | null;
export function roleWords(f: { officerTitle?: string | null; isTenPercent?: boolean; isOfficer?: boolean; isDirector?: boolean } | null | undefined): string | null;
export function summarizeInsider(filings: Form4[] | null | undefined, opts?: { asOf?: Date; windowDays?: number }): InsiderSummary;
export function insiderTag(s: InsiderSummary | null | undefined): string | null;
export function insiderWords(s: InsiderSummary | null | undefined, opts?: { asOf?: Date }): string;
