import assert from 'node:assert/strict';
import test from 'node:test';
import type { SlackRunSummaryPayload } from '@rate-monitor/shared';
import { formatRunSummaryTable, toSlackMessage } from './slackNotifier.js';

function buildPayload(): SlackRunSummaryPayload {
  return {
    run_id: 123,
    status: 'PARTIAL_SUCCESS',
    completed_at: '2026-04-26T14:31:08.457Z',
    success_count: 6,
    failure_count: 2,
    currencies: ['INR', 'NPR'],
    rows: [
      {
        provider_key: 'provider-a',
        provider_name: 'Al Ansari Exchange',
        cells: [
          { currency: 'INR', rate: 25.5102, status: 'SUCCESS' },
          { currency: 'NPR', rate: 40.9836, status: 'SUCCESS' }
        ]
      },
      {
        provider_key: 'provider-b',
        provider_name: 'Al Fardan Exchange',
        cells: [
          { currency: 'INR', rate: 25.52, status: 'SUCCESS' },
          { currency: 'NPR', rate: 40.92, status: 'SUCCESS' }
        ]
      },
      {
        provider_key: 'provider-c',
        provider_name: 'LuLu Exchange',
        cells: [
          { currency: 'INR', rate: null, status: 'FAILED' },
          { currency: 'NPR', rate: null, status: 'FAILED' }
        ]
      },
      {
        provider_key: 'google',
        provider_name: 'Google Finance',
        cells: [
          { currency: 'INR', rate: 25.6638, status: 'SUCCESS' },
          { currency: 'NPR', rate: 40.9711, status: 'SUCCESS' }
        ]
      }
    ]
  };
}

test('formatRunSummaryTable renders provider rows, currency columns, and ranks without a legend', () => {
  const table = formatRunSummaryTable(buildPayload());
  const lines = table.split('\n');

  assert.match(lines[0], /^Provider +\| INR +\| NPR *$/);
  assert.match(table, /Al Ansari Exchange +\| 25\.5102 \(Worst\) +\| 40\.9836 \(BEST\)/);
  assert.match(table, /Al Fardan Exchange +\| 25\.52 \(#2\) +\| 40\.92 \(Worst\)/);
  assert.match(table, /LuLu Exchange +\| n\/a +\| n\/a/);
  assert.match(table, /Google Finance +\| 25\.6638 \(BEST\) +\| 40\.9711 \(#2\)/);
  assert.doesNotMatch(table, /Legend/i);
});

test('toSlackMessage embeds the summary header, totals, and formatted table', () => {
  const message = toSlackMessage(buildPayload());
  const tableBlock = message.blocks[3];

  assert.equal(message.text, 'Run #123 | PARTIAL_SUCCESS | Completed 2026-04-26T14:31:08.457Z | Success to failure [Success:6, failure:2]');
  assert.equal(message.blocks[0].type, 'header');
  assert.equal(tableBlock.type, 'section');
  assert.match((tableBlock as { text: { text: string } }).text.text, /Provider +\| INR +\| NPR/);
  assert.doesNotMatch((tableBlock as { text: { text: string } }).text.text, /Legend/i);
});
