// Form 13F — the institutional register. See institutions.js.
export const INDEX_MANAGERS: string[];
export const MARKET_MAKERS: string[];
export function isIndexManager(name: string | null | undefined): boolean;
export function isMarketMaker(name: string | null | undefined): boolean;
export function isPassiveHolder(name: string | null | undefined): boolean;
export function cleanName(name: string | null | undefined): string;
export function money(v: number | null | undefined): string;
export function shareCount(v: number | null | undefined): string;

export interface Holder {
  manager: string;
  shares: number;
  value: number;
  priorShares?: number | null;
  rank?: number;
  cik?: string | null;
}
export interface Ownership {
  asset?: string;
  period?: string;
  holders: number;
  shares?: number;
  value?: number;
  holdersPrior?: number | null;
  sharesPrior?: number | null;
  valuePrior?: number | null;
  opened?: number | null;
  closed?: number | null;
  added?: number | null;
  reduced?: number | null;
  activeHolders?: number | null;
}
export interface Drift {
  net: number; pct: number; shareNetPct: number | null;
  opened?: number | null; closed?: number | null; added?: number | null; reduced?: number | null;
  direction: 'more' | 'fewer' | 'flat';
}
export function notableHolders(holders: Holder[] | null | undefined, limit?: number): Holder[];
export function ownershipDrift(o: Ownership | null | undefined): Drift | null;
export function ownershipTag(o: Ownership | null | undefined): string | null;
export function ownershipWords(o: Ownership | null | undefined, holders?: Holder[]): string;
