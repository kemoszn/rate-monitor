import type { RateBounds, SupportedCurrency } from '@rate-monitor/shared';

export interface ParserInput {
  text: string;
  baseCurrency: string;
  quoteCurrency: SupportedCurrency;
  bounds: RateBounds;
}

export interface ParserResult {
  rate: number;
  evidence: string;
  parserPath: 'primary' | 'fallback';
}
