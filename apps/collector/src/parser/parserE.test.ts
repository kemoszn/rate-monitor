import assert from 'node:assert/strict';
import test from 'node:test';
import { parseProviderE } from './parserE.js';

test('parseProviderE parses the visible exchange-rate line', () => {
  const parsed = parseProviderE({
    text: 'AED 1 = INR 25.580 Exchange rate',
    baseCurrency: 'AED',
    quoteCurrency: 'INR',
    bounds: { min: 10, max: 40 }
  });

  assert.deepEqual(parsed, {
    rate: 25.58,
    evidence: 'AED 1 = INR 25.580',
    parserPath: 'primary'
  });
});

test('parseProviderE parses country-name evidence from the dropdown-driven widget', () => {
  const parsed = parseProviderE({
    text: 'AED 1 = Pakistan 76.450 Exchange rate',
    baseCurrency: 'AED',
    quoteCurrency: 'PKR',
    bounds: { min: 20, max: 120 }
  });

  assert.deepEqual(parsed, {
    rate: 76.45,
    evidence: 'AED 1 = Pakistan 76.450',
    parserPath: 'primary'
  });
});

test('parseProviderE falls back to nearby exchange-rate evidence', () => {
  const parsed = parseProviderE({
    text: ['Recipient gets', 'Pakistan', 'Exchange rate', 'AED 1 = 76.450'].join('\n'),
    baseCurrency: 'AED',
    quoteCurrency: 'PKR',
    bounds: { min: 20, max: 120 }
  });

  assert.deepEqual(parsed, {
    rate: 76.45,
    evidence: 'Pakistan Exchange rate AED 1 = 76.450',
    parserPath: 'fallback'
  });
});
