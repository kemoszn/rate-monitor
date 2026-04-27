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

test('upsertMargin persists and updates a currency margin', async () => {
  const repo = await freshRepo();
  const created = await repo.upsertMargin({
    currency: 'INR',
    margin_percentage: 1.25
  });
  assert.equal(created.margin_percentage, 1.25);

  const updated = await repo.upsertMargin({
    currency: 'INR',
    margin_percentage: 2
  });
  assert.equal(updated.margin_percentage, 2);
  assert.equal(await repo.getMarginPercentage('INR'), 2);
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
