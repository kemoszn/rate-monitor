import {
  type CollectorExtractionMode,
  type ExtractRequest,
  type ExtractResponse
} from '@rate-monitor/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { ExchangeRateExtractor } from './contracts.js';
import { PlaywrightDeterministicExtractor } from './playwrightDeterministicExtractor.js';
import { findProviderByHostname } from './providers/registry.js';

const EXTRACTION_MODE = 'playwright_deterministic' as const satisfies CollectorExtractionMode;

export class ExchangeRateExtractorRouter implements ExchangeRateExtractor {
  constructor(private readonly logger: FastifyBaseLogger) {}

  async extract(request: ExtractRequest): Promise<ExtractResponse> {
    const provider = findProviderByHostname(new URL(request.source_url).hostname);
    if (!provider) {
      const fetchedAt = new Date().toISOString();
      return {
        extraction_mode: EXTRACTION_MODE,
        results: [],
        errors: request.currencies.map((quoteCurrency) => ({
          provider: 'unknown',
          provider_name: 'Unknown provider',
          quote_currency: quoteCurrency.toUpperCase(),
          reason_code: 'UNKNOWN',
          message: `No extractor is registered for host ${new URL(request.source_url).hostname}.`,
          source_url: request.source_url,
          fetched_at: fetchedAt,
          extraction_mode: EXTRACTION_MODE
        }))
      };
    }

    return new PlaywrightDeterministicExtractor(this.logger, provider).extract(request);
  }
}
