import assert from 'node:assert/strict';
import test from 'node:test';
import { parseProviderC } from './parserC.js';
import { validateRate } from './validation.js';

const BOUNDS = {
  INR: { min: 10, max: 40 },
  PKR: { min: 20, max: 120 },
  NPR: { min: 20, max: 80 }
} as const;

test('parseProviderC parses a primary AED to INR pattern', () => {
  const parsed = parseProviderC({
    text: "Today's rate 1 AED = 22.71 INR on Exchange Provider C",
    baseCurrency: 'AED',
    quoteCurrency: 'INR',
    bounds: BOUNDS.INR
  });

  assert.equal(parsed?.rate, 22.71);
  assert.equal(parsed?.parserPath, 'primary');
  assert.match(parsed?.evidence ?? '', /1 AED = 22\.71 INR/);
});

test('parseProviderC parses homepage carousel text for compact currency rows', () => {
  const parsed = parseProviderC({
    text: 'Today’s Money Transfer Rate 1.00AED INDIAN RUPEE25.53INR NEPALESE RUPEE41.03NPR PAKISTANI RUPEE76.20PKR',
    baseCurrency: 'AED',
    quoteCurrency: 'INR',
    bounds: BOUNDS.INR
  });

  assert.equal(parsed?.rate, 25.53);
  assert.equal(parsed?.parserPath, 'primary');
  assert.match(parsed?.evidence ?? '', /INDIAN RUPEE25\.53INR/);
});

test('parseProviderC falls back to a line-based parse when strict pattern is absent', () => {
  const parsed = parseProviderC({
    text: ['Send money abroad', 'Destination Currency: Pakistani Rupee PKR', 'Exchange rate available now 76.45', 'Charges may apply'].join(
      '\n'
    ),
    baseCurrency: 'AED',
    quoteCurrency: 'PKR',
    bounds: BOUNDS.PKR
  });

  assert.deepEqual(parsed, {
    rate: 76.45,
    evidence: 'Exchange rate available now 76.45',
    parserPath: 'fallback'
  });
});

test('parseProviderC rejects tiny false positives through configured min/max guards', () => {
  const parsed = parseProviderC({
    text: '1 AED = 0.76 PKR promotional badge',
    baseCurrency: 'AED',
    quoteCurrency: 'PKR',
    bounds: BOUNDS.PKR
  });

  assert.equal(parsed, null);
});

test('parseProviderC parses NPR fallback evidence when rate is near the currency label', () => {
  const parsed = parseProviderC({
    text: ['Exchange Provider C', 'NPR', '36.10', 'Indicative only'].join('\n'),
    baseCurrency: 'AED',
    quoteCurrency: 'NPR',
    bounds: BOUNDS.NPR
  });

  assert.deepEqual(parsed, {
    rate: 36.1,
    evidence: '36.10',
    parserPath: 'fallback'
  });
});

test('validateRate accepts and rejects values using configured bounds', () => {
  assert.equal(validateRate(22.9, BOUNDS.INR), true);
  assert.equal(validateRate(8, BOUNDS.INR), false);
  assert.equal(validateRate(180, BOUNDS.PKR), false);
});
