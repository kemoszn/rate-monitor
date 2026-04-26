import {
  GOOGLE_PROVIDER,
  type CollectedRateResult,
  type FailedRateCollection,
  type SuccessfulRateCollection,
  type SupportedCurrency
} from '@rate-monitor/shared';

const EXTRACTION_MODE = 'google_finance_fetch';

export interface GoogleRateCollectorConfig {
  baseUrl: string;
  timeoutMs: number;
  baseCurrency: string;
  userAgent: string;
}

export class GoogleRateCollector {
  constructor(private readonly config: GoogleRateCollectorConfig) {}

  async fetchRate(currency: SupportedCurrency): Promise<CollectedRateResult> {
    const baseUrl = this.config.baseUrl.replace(/\/$/, '');
    const sourceUrl = `${baseUrl}/${this.config.baseCurrency}-${currency}?hl=en&ucbcb=1`;
    const fetchedAt = new Date().toISOString();

    try {
      const response = await fetch(sourceUrl, {
        headers: {
          'accept-language': 'en-US,en;q=0.9',
          'user-agent': this.config.userAgent
        },
        signal: AbortSignal.timeout(this.config.timeoutMs)
      });

      if (!response.ok) {
        return buildFailure(currency, sourceUrl, fetchedAt, 'GOOGLE_HTTP_ERROR', `Google Finance returned HTTP ${response.status}`);
      }

      const parsed = parseGoogleFinanceRate(await response.text(), this.config.baseCurrency, currency);
      return buildSuccess(currency, sourceUrl, fetchedAt, parsed.rate, parsed.evidenceText);
    } catch (error) {
      return buildFailure(
        currency,
        sourceUrl,
        fetchedAt,
        'GOOGLE_FETCH_FAILED',
        error instanceof Error ? error.message : 'Unknown Google Finance error'
      );
    }
  }
}

export function parseGoogleFinanceRate(
  html: string,
  baseCurrency: string,
  currency: SupportedCurrency
): { rate: number; evidenceText: string } {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const directPair = new RegExp(`${baseCurrency}\\s*\\/\\s*${currency}\\b[^0-9]{0,120}([0-9]+(?:\\.[0-9]+)?)`, 'i');
  const equality = new RegExp(`1\\s*${baseCurrency}[^0-9]{0,40}([0-9]+(?:\\.[0-9]+)?)\\s*${currency}\\b`, 'i');
  const match = text.match(directPair) ?? text.match(equality);

  if (!match) {
    throw new Error(`Unable to parse Google Finance ${baseCurrency}/${currency} rate.`);
  }

  const rate = Number.parseFloat(match[1]);
  if (!Number.isFinite(rate)) {
    throw new Error(`Google Finance returned a non-numeric ${baseCurrency}/${currency} rate.`);
  }

  return { rate, evidenceText: match[0] };
}

function buildSuccess(
  currency: SupportedCurrency,
  sourceUrl: string,
  fetchedAt: string,
  rate: number,
  evidenceText: string
): SuccessfulRateCollection {
  return {
    currency,
    providerKey: GOOGLE_PROVIDER.key,
    providerName: GOOGLE_PROVIDER.displayName,
    sourceUrl,
    fetchedAt,
    extractionMode: EXTRACTION_MODE,
    nowMode: null,
    derivedFromProviderKey: null,
    status: 'SUCCESS',
    rate,
    evidenceText,
    evidenceValue: rate,
    failureCode: null,
    failureMessage: null
  };
}

function buildFailure(
  currency: SupportedCurrency,
  sourceUrl: string,
  fetchedAt: string,
  failureCode: string,
  failureMessage: string
): FailedRateCollection {
  return {
    currency,
    providerKey: GOOGLE_PROVIDER.key,
    providerName: GOOGLE_PROVIDER.displayName,
    sourceUrl,
    fetchedAt,
    extractionMode: EXTRACTION_MODE,
    nowMode: null,
    derivedFromProviderKey: null,
    status: 'FAILED',
    rate: null,
    evidenceText: null,
    evidenceValue: null,
    failureCode,
    failureMessage
  };
}
