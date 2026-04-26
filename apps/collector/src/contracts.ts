import type { ExtractRequest, ExtractResponse } from '@rate-monitor/shared';

export interface ExchangeRateExtractor {
  extract(request: ExtractRequest): Promise<ExtractResponse>;
}
