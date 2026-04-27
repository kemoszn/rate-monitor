import assert from 'node:assert/strict';
import test from 'node:test';
import type { CollectedRateResult, CollectionRunRecord } from '@rate-monitor/shared';
import { buildRunSnapshotSets, buildRunSummaryPayload, summarizeSnapshots } from './collectAll.js';

test('buildRunSnapshotSets excludes derived NOW rows from the summary scope but keeps them for persistence', () => {
  const exchangeSnapshots: CollectedRateResult[] = [
    {
      currency: 'INR',
      providerKey: 'provider-a',
      providerName: 'Al Ansari Exchange',
      sourceUrl: 'https://example.com/a',
      fetchedAt: '2026-04-26T10:00:00.000Z',
      extractionMode: 'playwright_deterministic',
      nowMode: null,
      derivedFromProviderKey: null,
      status: 'SUCCESS',
      rate: 25.5102,
      evidenceText: 'AED 1 = INR 25.5102',
      evidenceValue: 25.5102,
      failureCode: null,
      failureMessage: null
    },
    {
      currency: 'NPR',
      providerKey: 'provider-a',
      providerName: 'Al Ansari Exchange',
      sourceUrl: 'https://example.com/a',
      fetchedAt: '2026-04-26T10:00:00.000Z',
      extractionMode: 'playwright_deterministic',
      nowMode: null,
      derivedFromProviderKey: null,
      status: 'FAILED',
      rate: null,
      evidenceText: null,
      evidenceValue: null,
      failureCode: 'NAVIGATION_FAILED',
      failureMessage: 'timeout'
    }
  ];
  const googleSnapshots: CollectedRateResult[] = [
    {
      currency: 'INR',
      providerKey: 'google',
      providerName: 'Google Finance',
      sourceUrl: 'https://google.com',
      fetchedAt: '2026-04-26T10:01:00.000Z',
      extractionMode: 'google_finance_fetch',
      nowMode: null,
      derivedFromProviderKey: null,
      status: 'SUCCESS',
      rate: 25.6638,
      evidenceText: 'AED/INR',
      evidenceValue: 25.6638,
      failureCode: null,
      failureMessage: null
    }
  ];
  const derivedSnapshots: CollectedRateResult[] = [
    {
      currency: 'INR',
      providerKey: 'now-flat',
      providerName: 'NOW Flat',
      sourceUrl: null,
      fetchedAt: '2026-04-26T10:01:30.000Z',
      extractionMode: 'derived_now_flat',
      nowMode: 'FLAT',
      derivedFromProviderKey: 'provider-a',
      status: 'SUCCESS',
      rate: 25.5102,
      evidenceText: 'derived',
      evidenceValue: null,
      failureCode: null,
      failureMessage: null
    }
  ];

  const { summarySnapshots, allSnapshots } = buildRunSnapshotSets(exchangeSnapshots, googleSnapshots, derivedSnapshots);
  const metrics = summarizeSnapshots(summarySnapshots);

  assert.equal(summarySnapshots.length, 3);
  assert.equal(allSnapshots.length, 4);
  assert.equal(summarySnapshots.some((snapshot) => snapshot.providerKey === 'now-flat'), false);
  assert.equal(allSnapshots.some((snapshot) => snapshot.providerKey === 'now-flat'), true);
  assert.deepEqual(metrics, {
    status: 'PARTIAL_SUCCESS',
    successCount: 2,
    failureCount: 1,
    totalSources: 3,
    errorSummary: 'NPR:provider-a:NAVIGATION_FAILED'
  });
});

test('buildRunSummaryPayload lays out provider rows and fills missing currency cells as n/a', () => {
  const run: CollectionRunRecord = {
    id: 123,
    triggered_by: 'manual',
    trigger_reason: null,
    status: 'PARTIAL_SUCCESS',
    started_at: '2026-04-26T10:00:00.000Z',
    completed_at: '2026-04-26T10:05:00.000Z',
    success_count: 2,
    failure_count: 1,
    total_sources: 3,
    error_summary: 'NPR:provider-a:NAVIGATION_FAILED',
    created_at: '2026-04-26T10:00:00.000Z'
  };
  const payload = buildRunSummaryPayload(
    run,
    ['INR', 'NPR'],
    [
      { key: 'provider-a', name: 'Al Ansari Exchange' },
      { key: 'google', name: 'Google Finance' }
    ],
    [
      {
        currency: 'INR',
        providerKey: 'provider-a',
        providerName: 'Al Ansari Exchange',
        sourceUrl: 'https://example.com/a',
        fetchedAt: '2026-04-26T10:00:00.000Z',
        extractionMode: 'playwright_deterministic',
        nowMode: null,
        derivedFromProviderKey: null,
        status: 'SUCCESS',
        rate: 25.5102,
        evidenceText: 'AED 1 = INR 25.5102',
        evidenceValue: 25.5102,
        failureCode: null,
        failureMessage: null
      },
      {
        currency: 'INR',
        providerKey: 'google',
        providerName: 'Google Finance',
        sourceUrl: 'https://google.com',
        fetchedAt: '2026-04-26T10:01:00.000Z',
        extractionMode: 'google_finance_fetch',
        nowMode: null,
        derivedFromProviderKey: null,
        status: 'SUCCESS',
        rate: 25.6638,
        evidenceText: 'AED/INR',
        evidenceValue: 25.6638,
        failureCode: null,
        failureMessage: null
      }
    ]
  );

  assert.deepEqual(payload.currencies, ['INR', 'NPR']);
  assert.equal(payload.rows[0].provider_name, 'Al Ansari Exchange');
  assert.equal(payload.rows[0].cells[0].rate, 25.5102);
  assert.equal(payload.rows[0].cells[1].rate, null);
  assert.equal(payload.rows[0].cells[1].status, 'FAILED');
  assert.equal(payload.rows[1].provider_name, 'Google Finance');
  assert.equal(payload.rows[1].cells[0].rate, 25.6638);
});
