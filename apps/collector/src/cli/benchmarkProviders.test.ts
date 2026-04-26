import assert from 'node:assert/strict';
import test from 'node:test';
import { resetProviderCacheForTests } from '../providers/registry.js';
import { parseArgs } from './benchmarkProviders.js';

const STUB_PROVIDER_CONFIG = JSON.stringify(
  ['a', 'b', 'c', 'd', 'e'].map((suffix) => ({
    key: `provider-${suffix}`,
    name: `provider-${suffix}`,
    displayName: `Provider ${suffix.toUpperCase()}`,
    sourceUrl: `https://example.com/${suffix}`,
    hostnames: [`example-${suffix}.test`],
    supportedBaseCurrency: 'AED' as const,
    supportedQuoteCurrencies: ['INR', 'PKR', 'NPR'] as const,
    parserKey: `provider-${suffix}-rate`,
    bounds: {
      INR: { min: 10, max: 40 },
      PKR: { min: 20, max: 120 },
      NPR: { min: 20, max: 80 }
    },
    interaction: { actSteps: ['step'] },
    deterministic: {
      dom: {
        customDropdownOptionSelectorTemplate: '.x',
        customDropdownTriggerSelectors: ['.y'],
        selectedCurrencySelectors: ['.z'],
        rateContainerSelectors: ['.w']
      },
      rateText: { fromSelector: '.f', rateSelector: '.r', toSelector: '.t' }
    },
    stagehand: { discoverySteps: ['s'], repairSteps: ['r'] }
  }))
);

test.beforeEach(() => {
  process.env.PROVIDER_CONFIG_JSON = STUB_PROVIDER_CONFIG;
  resetProviderCacheForTests();
});

test.afterEach(() => {
  delete process.env.PROVIDER_CONFIG_JSON;
  resetProviderCacheForTests();
});

test('parseArgs defaults to all providers and supported benchmark currencies', () => {
  assert.deepEqual(parseArgs([]), {
    providerKeys: ['provider-a', 'provider-b', 'provider-c', 'provider-d', 'provider-e'],
    currencies: ['INR', 'NPR', 'PKR']
  });
});

test('parseArgs accepts repeated provider and currency filters', () => {
  assert.deepEqual(parseArgs(['--provider', 'provider-d', '--provider', 'provider-e', '--currency', 'pkr', '--currency', 'inr']), {
    providerKeys: ['provider-d', 'provider-e'],
    currencies: ['PKR', 'INR']
  });
});

test('parseArgs rejects unsupported currencies', () => {
  assert.throws(() => parseArgs(['--currency', 'USD']), /Unsupported currency/);
});

test('parseArgs rejects unknown providers', () => {
  assert.throws(() => parseArgs(['--provider', 'unknown']), /Unknown provider/);
});
