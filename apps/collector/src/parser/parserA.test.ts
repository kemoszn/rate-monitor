import assert from 'node:assert/strict';
import test from 'node:test';
import { parseProviderARate } from './parserA.js';

test('parseProviderARate parses the indicative banner format', () => {
  const parsed = parseProviderARate({
    text: '1 AED = 25.06270000 INR Indicative exchange rate',
    baseCurrency: 'AED',
    quoteCurrency: 'INR',
    bounds: { min: 10, max: 40 }
  });

  assert.deepEqual(parsed, {
    rate: 25.0627,
    evidence: '1 AED = 25.06270000 INR',
    parserPath: 'primary'
  });
});

test('parseProviderARate rejects values outside the configured bounds', () => {
  const parsed = parseProviderARate({
    text: '1 AED = 0.25000000 INR Indicative exchange rate',
    baseCurrency: 'AED',
    quoteCurrency: 'INR',
    bounds: { min: 10, max: 40 }
  });

  assert.equal(parsed, null);
});
