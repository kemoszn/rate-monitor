import assert from 'node:assert/strict';
import test from 'node:test';
import { parseProviderBRate } from './parserB.js';

test('parseProviderBRate parses 1 AED style evidence', () => {
  const parsed = parseProviderBRate({
    text: '1 AED = 25.48 INR',
    baseCurrency: 'AED',
    quoteCurrency: 'INR',
    bounds: { min: 10, max: 40 }
  });

  assert.deepEqual(parsed, {
    rate: 25.48,
    evidence: '1 AED = 25.48 INR',
    parserPath: 'primary'
  });
});

test('parseProviderBRate parses receiver field output after setting amount to 1', () => {
  const parsed = parseProviderBRate({
    text: 'AMOUNT YOU WILL SEND\n1 AED\nRECEIVER WILL GET\n25.48 INR',
    baseCurrency: 'AED',
    quoteCurrency: 'INR',
    bounds: { min: 10, max: 40 }
  });

  assert.deepEqual(parsed, {
    rate: 25.48,
    evidence: '1 AED\nRECEIVER WILL GET\n25.48 INR',
    parserPath: 'primary'
  });
});

test('parseProviderBRate derives a per-dirham rate from send and receive totals', () => {
  const parsed = parseProviderBRate({
    text: 'AMOUNT YOU WILL SEND\n1000 AED\nRECIEVER WILL GET\n74,500 PKR',
    baseCurrency: 'AED',
    quoteCurrency: 'PKR',
    bounds: { min: 40, max: 120 }
  });

  assert.deepEqual(parsed, {
    rate: 74.5,
    evidence: '1000 AED\nRECIEVER WILL GET\n74,500 PKR',
    parserPath: 'primary'
  });
});

test('parseProviderBRate derives a per-dirham rate when amount and currency are split across nearby lines', () => {
  const parsed = parseProviderBRate({
    text: 'AMOUNT YOU WILL SEND\n1000 AED\nRECIEVER WILL GET\n27200\nNPR',
    baseCurrency: 'AED',
    quoteCurrency: 'NPR',
    bounds: { min: 20, max: 60 }
  });

  assert.deepEqual(parsed, {
    rate: 27.2,
    evidence: '1000 AED\nRECIEVER WILL GET\n27200\nNPR',
    parserPath: 'primary'
  });
});
