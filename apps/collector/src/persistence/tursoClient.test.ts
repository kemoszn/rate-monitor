import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { MonitoringRepository } from './tursoClient.js';

async function freshRepo(): Promise<MonitoringRepository> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'turso-test-'));
  const dbPath = path.join(dir, 'test.db');
  const repo = await MonitoringRepository.connect({ url: `file:${dbPath}` });
  process.on('exit', () => {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
  });
  return repo;
}

test('bootstrap seeds margin_config rows for all currencies', async () => {
  const repo = await freshRepo();
  const margins = await repo.getAllMargins();
  assert.equal(margins.length, 3);
  assert.deepEqual(
    margins.map((m) => m.currency).sort(),
    ['INR', 'NPR', 'PKR']
  );
  for (const margin of margins) {
    assert.equal(margin.margin_percentage, 0);
  }
});

test('createCollectionRun → updateCollectionRun → getRunById round-trip', async () => {
  const repo = await freshRepo();
  const run = await repo.createCollectionRun({
    triggered_by: 'test',
    trigger_reason: 'unit',
    status: 'RUNNING',
    started_at: '2026-04-26T10:00:00.000Z'
  });
  assert.equal(run.status, 'RUNNING');
  assert.equal(run.triggered_by, 'test');
  assert.equal(typeof run.id, 'number');

  const updated = await repo.updateCollectionRun({
    id: run.id,
    status: 'SUCCESS',
    completed_at: '2026-04-26T10:05:00.000Z',
    success_count: 15,
    failure_count: 0,
    total_sources: 17,
    error_summary: null
  });
  assert.equal(updated.status, 'SUCCESS');
  assert.equal(updated.success_count, 15);

  const refetched = await repo.getRunById(run.id);
  assert.equal(refetched?.completed_at, '2026-04-26T10:05:00.000Z');
});

test('insertRateSnapshots persists rows transactionally', async () => {
  const repo = await freshRepo();
  const run = await repo.createCollectionRun({
    triggered_by: 'test',
    trigger_reason: null,
    status: 'RUNNING',
    started_at: '2026-04-26T10:00:00.000Z'
  });
  await repo.insertRateSnapshots(run.id, [
    {
      currency: 'INR',
      providerKey: 'provider-a',
      providerName: 'Al Ansari Exchange',
      sourceUrl: 'https://example.com',
      fetchedAt: '2026-04-26T10:01:00.000Z',
      extractionMode: 'playwright_deterministic',
      nowMode: null,
      derivedFromProviderKey: null,
      status: 'SUCCESS',
      rate: 22.85,
      evidenceText: 'AED 1 = INR 22.85',
      evidenceValue: 22.85,
      failureCode: null,
      failureMessage: null
    },
    {
      currency: 'PKR',
      providerKey: 'provider-b',
      providerName: 'Al Fardan Exchange',
      sourceUrl: 'https://example.com',
      fetchedAt: '2026-04-26T10:02:00.000Z',
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
  ]);

  const all = await repo.getSnapshotsForRun(run.id);
  assert.equal(all.length, 2);
  const inr = await repo.getSnapshotsForRun(run.id, 'INR');
  assert.equal(inr.length, 1);
  assert.equal(inr[0].rate, 22.85);
  assert.equal(inr[0].provider_key, 'provider-a');
});

test('getPreviousMaxRate respects fetched_at window', async () => {
  const repo = await freshRepo();
  const run = await repo.createCollectionRun({
    triggered_by: 't',
    trigger_reason: null,
    status: 'RUNNING',
    started_at: '2026-04-20T00:00:00.000Z'
  });
  const baseSnapshot = {
    currency: 'INR' as const,
    providerKey: 'now-flat' as const,
    providerName: 'NOW Flat',
    sourceUrl: null,
    extractionMode: 'derived_now_flat',
    nowMode: 'FLAT' as const,
    derivedFromProviderKey: 'provider-a' as const,
    status: 'SUCCESS' as const,
    evidenceText: 'derived',
    evidenceValue: null,
    failureCode: null,
    failureMessage: null
  };
  await repo.insertRateSnapshots(run.id, [
    { ...baseSnapshot, rate: 22.0, fetchedAt: '2026-04-20T10:00:00.000Z' },
    { ...baseSnapshot, rate: 23.5, fetchedAt: '2026-04-22T10:00:00.000Z' },
    { ...baseSnapshot, rate: 21.0, fetchedAt: '2026-04-25T10:00:00.000Z' }
  ]);

  const peak = await repo.getPreviousMaxRate({
    currency: 'INR',
    provider_key: 'now-flat',
    before_fetched_at: '2026-04-26T00:00:00.000Z'
  });
  assert.equal(peak, 23.5);

  const lookback = await repo.getPreviousMaxRate({
    currency: 'INR',
    provider_key: 'now-flat',
    before_fetched_at: '2026-04-26T00:00:00.000Z',
    since_fetched_at: '2026-04-23T00:00:00.000Z'
  });
  assert.equal(lookback, 21.0);
});

test('alert state hysteresis: save and re-read', async () => {
  const repo = await freshRepo();
  await repo.saveAlertState({
    currency: 'INR',
    now_mode: 'FLAT',
    alert_type: 'BEST_IN_MARKET',
    is_active: true,
    activated_at: '2026-04-26T10:00:00.000Z',
    cleared_at: null,
    last_run_id: 1,
    updated_at: '2026-04-26T10:00:00.000Z'
  });
  const fetched = await repo.getAlertState('INR', 'FLAT', 'BEST_IN_MARKET');
  assert.ok(fetched);
  assert.equal(fetched.is_active, true);
  assert.equal(fetched.activated_at, '2026-04-26T10:00:00.000Z');

  await repo.saveAlertState({
    ...fetched,
    is_active: false,
    cleared_at: '2026-04-26T11:00:00.000Z',
    updated_at: '2026-04-26T11:00:00.000Z'
  });
  const cleared = await repo.getAlertState('INR', 'FLAT', 'BEST_IN_MARKET');
  assert.equal(cleared?.is_active, false);
  assert.equal(cleared?.cleared_at, '2026-04-26T11:00:00.000Z');
  assert.equal(cleared?.activated_at, '2026-04-26T10:00:00.000Z');
});

test('insertAlertEvent stores JSON columns and returns hydrated record', async () => {
  const repo = await freshRepo();
  const run = await repo.createCollectionRun({
    triggered_by: 't',
    trigger_reason: null,
    status: 'RUNNING',
    started_at: '2026-04-26T10:00:00.000Z'
  });
  const event = await repo.insertAlertEvent({
    run_id: run.id,
    currency: 'INR',
    now_mode: 'FLAT',
    alert_type: 'ABOVE_GOOGLE',
    triggered_at: '2026-04-26T10:01:00.000Z',
    lookback_days: null,
    current_now_rate: 23.1,
    google_rate: 22.9,
    market_rates: [{ provider_key: 'provider-a', provider_name: 'Al Ansari', rate: 23.1, status: 'SUCCESS' }],
    payload: {
      currency: 'INR',
      now_mode: 'FLAT',
      alert_type: 'ABOVE_GOOGLE',
      current_now_rate: 23.1,
      google_rate: 22.9,
      market_rates: [{ provider_key: 'provider-a', provider_name: 'Al Ansari', rate: 23.1, status: 'SUCCESS' }],
      lookback_days: null,
      timestamp: '2026-04-26T10:01:00.000Z'
    },
    delivery_status: 'SENT',
    delivery_error: null
  });
  assert.equal(event.alert_type, 'ABOVE_GOOGLE');
  assert.equal(event.market_rates[0].provider_key, 'provider-a');
  assert.equal(event.payload.current_now_rate, 23.1);
});

test('countRunsSince returns count of runs in window', async () => {
  const repo = await freshRepo();
  await repo.createCollectionRun({ triggered_by: 't', trigger_reason: null, status: 'SUCCESS', started_at: '2026-04-25T00:00:00.000Z' });
  await repo.createCollectionRun({ triggered_by: 't', trigger_reason: null, status: 'SUCCESS', started_at: '2026-04-26T00:00:00.000Z' });
  const all = await repo.countRunsSince('2026-04-20T00:00:00.000Z');
  assert.equal(all, 2);
  const recent = await repo.countRunsSince('2026-04-26T00:00:00.000Z');
  assert.equal(recent, 1);
});
