import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExtractResponse } from '@rate-monitor/shared';
import type { ExchangeRateExtractor } from '../contracts.js';
import { buildServer } from '../server.js';

class FakeExtractor implements ExchangeRateExtractor {
  async extract(): Promise<ExtractResponse> {
    return {
      provider: 'provider-a',
      provider_name: 'Provider A',
      extraction_mode: 'playwright_deterministic' as const,
      results: [
        {
          provider: 'provider-a',
          provider_name: 'Provider A',
          quote_currency: 'INR' as const,
          rate: 25.11,
          evidence: '1 AED = 25.11 INR',
          evidence_text: '1 AED = 25.11 INR',
          evidence_value: 25.11,
          fetched_at: '2026-04-23T00:00:00.000Z',
          source_url: 'https://example.com/',
          parser_path: 'primary' as const,
          extraction_mode: 'playwright_deterministic' as const
        }
      ],
      errors: [
        {
          provider: 'provider-a',
          provider_name: 'Provider A',
          quote_currency: 'PKR',
          reason_code: 'PARSE_FAILED' as const,
          message: 'Unable to parse PKR rate',
          source_url: 'https://example.com/',
          fetched_at: '2026-04-23T00:00:00.000Z',
          extraction_mode: 'playwright_deterministic' as const
        }
      ]
    };
  }
}

test('collector health endpoint is stable', async () => {
  const app = buildServer(new FakeExtractor());
  const response = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    status: 'ok',
    service: 'rate-monitor-collector',
    api_version: 'v1'
  });
  await app.close();
});

test('collector /extract preserves contract and adds metadata', async () => {
  const app = buildServer(new FakeExtractor());
  const response = await app.inject({
    method: 'POST',
    url: '/extract',
    payload: {
      source_url: 'https://example.com/converter',
      base_currency: 'AED',
      currencies: ['INR', 'PKR']
    }
  });
  assert.equal(response.statusCode, 200);
  const payload = response.json();
  assert.equal(payload.api_version, 'v1');
  assert.equal(payload.provider, 'provider-a');
  assert.equal(payload.results[0].evidence_text, '1 AED = 25.11 INR');
  assert.equal(payload.results[0].parser_path, 'primary');
  assert.equal(payload.errors[0].reason_code, 'PARSE_FAILED');
  await app.close();
});

test('collector rejects invalid request bodies', async () => {
  const app = buildServer(new FakeExtractor());
  const response = await app.inject({
    method: 'POST',
    url: '/extract',
    payload: {
      source_url: 'not-a-url',
      base_currency: 'USD',
      currencies: []
    }
  });
  assert.equal(response.statusCode, 400);
  await app.close();
});
