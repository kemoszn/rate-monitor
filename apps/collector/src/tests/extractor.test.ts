import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import type { ExtractResponse } from '@rate-monitor/shared';
import Fastify from 'fastify';
import { ExchangeRateExtractorRouter } from '../extractorRouter.js';

test('collector runtime defaults to deterministic Playwright instead of Stagehand extraction', () => {
  const source = fs.readFileSync(new URL('../playwrightDeterministicExtractor.ts', import.meta.url), 'utf8');
  assert.match(source, /createPlaywrightBrowser/);
  assert.equal(source.includes('createStagehand'), false);
  assert.equal(source.includes('stagehand.act'), false);
});

test('router returns per-currency unknown-provider errors for unsupported hosts', async () => {
  const app = Fastify({ logger: false });
  const router = new ExchangeRateExtractorRouter(app.log);

  const response = (await router.extract({
    source_url: 'https://example.com/rates',
    base_currency: 'AED',
    currencies: ['INR', 'PKR']
  })) as ExtractResponse;

  assert.equal(response.extraction_mode, 'playwright_deterministic');
  assert.deepEqual(response.results, []);
  assert.equal(response.errors.length, 2);
  assert.equal(response.errors[0].reason_code, 'UNKNOWN');

  await app.close();
});
