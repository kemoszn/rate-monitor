import assert from 'node:assert/strict';
import test from 'node:test';
import { parseProviderD } from './parserD.js';

test('parseProviderD divides received amount by send amount from explicit evidence', () => {
  const parsed = parseProviderD({
    text: '1000 AED = 25,617.09 INR',
    baseCurrency: 'AED',
    quoteCurrency: 'INR',
    bounds: { min: 10, max: 40 }
  });

  assert.deepEqual(parsed, {
    rate: 25.61709,
    evidence: '1000 AED = 25,617.09 INR',
    parserPath: 'primary'
  });
});

test('parseProviderD falls back to nearby send and received fields', () => {
  const parsed = parseProviderD({
    text: ['send', '1,000', 'received', 'INR', '25,617.09'].join('\n'),
    baseCurrency: 'AED',
    quoteCurrency: 'INR',
    bounds: { min: 10, max: 40 }
  });

  assert.deepEqual(parsed, {
    rate: 25.61709,
    evidence: 'send 1,000 received INR 25,617.09',
    parserPath: 'fallback'
  });
});

test('parseProviderD rejects out-of-range ratios', () => {
  const parsed = parseProviderD({
    text: '1000 AED = 6,000 INR',
    baseCurrency: 'AED',
    quoteCurrency: 'INR',
    bounds: { min: 10, max: 40 }
  });

  assert.equal(parsed, null);
});
