import { API_VERSION, SUPPORTED_CURRENCIES, type ExtractRequest, type ExtractResponse } from '@rate-monitor/shared';
import { z } from 'zod';
import { collectorConfig } from './config.js';

export const extractRequestSchema = z.object({
  source_url: z.string().url().default(collectorConfig.extraction.defaultSourceUrl),
  base_currency: z.literal('AED').default('AED'),
  currencies: z.array(z.enum(SUPPORTED_CURRENCIES)).nonempty().default([...SUPPORTED_CURRENCIES])
});

export function buildExtractResponse(request: ExtractRequest, response: ExtractResponse) {
  return {
    api_version: API_VERSION,
    request,
    ...response
  };
}
