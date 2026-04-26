import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArgs } from './providerMaintenance.js';

test('parseArgs parses discovery command options', () => {
  assert.deepEqual(parseArgs(['discover', '--provider', 'provider-a', '--currency', 'INR', '--write']), {
    command: 'discover',
    providerKey: 'provider-a',
    sampleQuoteCurrency: 'INR',
    write: true
  });
});

test('parseArgs rejects unknown commands', () => {
  assert.throws(() => parseArgs(['unknown', '--provider', 'provider-a']), /Usage:/);
});
