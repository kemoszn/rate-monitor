import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type Client, type InValue } from '@libsql/client';
import {
  SUPPORTED_CURRENCIES,
  type CampaignDeliveryStatus,
  type CampaignRecommendationRecord,
  type CampaignSignalType,
  type CollectedRateResult,
  type CollectionRunRecord,
  type NowMarginRecord,
  type NowMode,
  type ProviderKey,
  type RateSnapshotRecord,
  type RunStatus,
  type SnapshotStatus,
  type SupportedCurrency
} from '@rate-monitor/shared';

const SCHEMA_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');

export interface MonitoringRepositoryConfig {
  url: string;
  authToken?: string;
}

function bigintToNumber(value: bigint | number | null | undefined): number {
  if (value === null || value === undefined) {
    throw new Error('Expected numeric id, got null/undefined');
  }
  return typeof value === 'bigint' ? Number(value) : value;
}

function rowToCollectionRun(row: Record<string, unknown>): CollectionRunRecord {
  return {
    id: Number(row.id),
    triggered_by: row.triggered_by as string,
    trigger_reason: (row.trigger_reason as string | null) ?? null,
    status: row.status as RunStatus,
    started_at: row.started_at as string,
    completed_at: (row.completed_at as string | null) ?? null,
    success_count: Number(row.success_count),
    failure_count: Number(row.failure_count),
    total_sources: Number(row.total_sources),
    error_summary: (row.error_summary as string | null) ?? null,
    created_at: row.created_at as string
  };
}

function rowToRateSnapshot(row: Record<string, unknown>): RateSnapshotRecord {
  return {
    id: Number(row.id),
    run_id: Number(row.run_id),
    currency: row.currency as SupportedCurrency,
    provider_key: row.provider_key as ProviderKey,
    provider_name: row.provider_name as string,
    source_url: (row.source_url as string | null) ?? null,
    now_mode: (row.now_mode as NowMode | null) ?? null,
    rate: row.rate === null ? null : Number(row.rate),
    status: row.status as SnapshotStatus,
    failure_code: (row.failure_code as string | null) ?? null,
    failure_message: (row.failure_message as string | null) ?? null,
    evidence_text: (row.evidence_text as string | null) ?? null,
    evidence_value: (row.evidence_value as string | null) ?? null,
    extraction_mode: (row.extraction_mode as string | null) ?? null,
    fetched_at: row.fetched_at as string,
    derived_from_provider_key: (row.derived_from_provider_key as ProviderKey | null) ?? null,
    created_at: row.created_at as string
  };
}

function rowToCampaignRecord(row: Record<string, unknown>): CampaignRecommendationRecord {
  return {
    id: Number(row.id),
    run_id: Number(row.run_id),
    currency: row.currency as SupportedCurrency,
    signal_type: row.signal_type as CampaignSignalType,
    delivery_status: row.delivery_status as CampaignDeliveryStatus,
    flat_rate: Number(row.flat_rate),
    best_competitor_rate: row.best_competitor_rate === null ? null : Number(row.best_competitor_rate),
    best_competitor_key: (row.best_competitor_key as ProviderKey | null) ?? null,
    google_rate: row.google_rate === null ? null : Number(row.google_rate),
    history_max: row.history_max === null ? null : Number(row.history_max),
    history_days_available: Number(row.history_days_available),
    recommended_margin: Number(row.recommended_margin),
    in_salary_cycle: Number(row.in_salary_cycle),
    rationale: row.rationale as string,
    evaluated_at: row.evaluated_at as string
  };
}

function rowToMarginRecord(row: Record<string, unknown>): NowMarginRecord {
  return {
    currency: row.currency as SupportedCurrency,
    margin_percentage: Number(row.margin_percentage),
    updated_at: row.updated_at as string
  };
}

export class MonitoringRepository {
  private constructor(readonly db: Client) {}

  static async connect(config: MonitoringRepositoryConfig): Promise<MonitoringRepository> {
    const client = createClient({ url: config.url, authToken: config.authToken });
    const repo = new MonitoringRepository(client);
    await repo.bootstrap();
    return repo;
  }

  private async bootstrap(): Promise<void> {
    const schema = readFileSync(SCHEMA_PATH, 'utf8');
    await this.db.executeMultiple(schema);
    const now = new Date().toISOString();
    for (const currency of SUPPORTED_CURRENCIES) {
      await this.db.execute({
        sql: `INSERT INTO margin_config (currency, margin_percentage, updated_at)
              VALUES (?, 0, ?)
              ON CONFLICT(currency) DO NOTHING`,
        args: [currency, now]
      });
    }
  }

  close(): void {
    this.db.close();
  }

  async createCollectionRun(input: {
    triggered_by: string;
    trigger_reason: string | null;
    status: RunStatus;
    started_at: string;
  }): Promise<CollectionRunRecord> {
    const createdAt = new Date().toISOString();
    const result = await this.db.execute({
      sql: `INSERT INTO collection_runs (
              triggered_by, trigger_reason, status, started_at, completed_at,
              success_count, failure_count, total_sources, error_summary, created_at
            ) VALUES (?, ?, ?, ?, NULL, 0, 0, 0, NULL, ?)`,
      args: [input.triggered_by, input.trigger_reason, input.status, input.started_at, createdAt]
    });
    const id = bigintToNumber(result.lastInsertRowid);
    const run = await this.getRunById(id);
    if (!run) throw new Error(`Collection run ${id} disappeared after insert`);
    return run;
  }

  async updateCollectionRun(input: {
    id: number;
    status: RunStatus;
    completed_at: string;
    success_count: number;
    failure_count: number;
    total_sources: number;
    error_summary: string | null;
  }): Promise<CollectionRunRecord> {
    await this.db.execute({
      sql: `UPDATE collection_runs
            SET status = ?, completed_at = ?, success_count = ?, failure_count = ?,
                total_sources = ?, error_summary = ?
            WHERE id = ?`,
      args: [
        input.status,
        input.completed_at,
        input.success_count,
        input.failure_count,
        input.total_sources,
        input.error_summary,
        input.id
      ]
    });
    const run = await this.getRunById(input.id);
    if (!run) throw new Error(`Collection run ${input.id} disappeared after update`);
    return run;
  }

  async getRunById(id: number): Promise<CollectionRunRecord | null> {
    const result = await this.db.execute({
      sql: 'SELECT * FROM collection_runs WHERE id = ?',
      args: [id]
    });
    const row = result.rows[0];
    return row ? rowToCollectionRun(row as unknown as Record<string, unknown>) : null;
  }

  async insertRateSnapshots(runId: number, snapshots: CollectedRateResult[]): Promise<void> {
    if (snapshots.length === 0) return;
    const createdAt = new Date().toISOString();
    const sql = `INSERT INTO rate_snapshots (
                   run_id, currency, provider_key, provider_name, source_url, now_mode,
                   rate, status, failure_code, failure_message, evidence_text, evidence_value,
                   extraction_mode, fetched_at, derived_from_provider_key, created_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const stmts = snapshots.map((record) => {
      const args: InValue[] = [
        runId,
        record.currency,
        record.providerKey,
        record.providerName,
        record.sourceUrl,
        record.nowMode,
        record.rate,
        record.status,
        record.failureCode,
        record.failureMessage,
        record.evidenceText,
        record.evidenceValue === null ? null : String(record.evidenceValue),
        record.extractionMode,
        record.fetchedAt,
        record.derivedFromProviderKey,
        createdAt
      ];
      return { sql, args };
    });
    await this.db.batch(stmts, 'write');
  }

  async getSnapshotsForRun(runId: number, currency?: SupportedCurrency): Promise<RateSnapshotRecord[]> {
    const result = currency
      ? await this.db.execute({
          sql: `SELECT * FROM rate_snapshots WHERE run_id = ? AND currency = ? ORDER BY id ASC`,
          args: [runId, currency]
        })
      : await this.db.execute({
          sql: `SELECT * FROM rate_snapshots WHERE run_id = ? ORDER BY currency ASC, id ASC`,
          args: [runId]
        });
    return result.rows.map((row) => rowToRateSnapshot(row as unknown as Record<string, unknown>));
  }

  async getMarginPercentage(currency: SupportedCurrency): Promise<number> {
    const result = await this.db.execute({
      sql: 'SELECT margin_percentage FROM margin_config WHERE currency = ?',
      args: [currency]
    });
    const row = result.rows[0];
    return row ? Number((row as unknown as { margin_percentage: number }).margin_percentage) : 0;
  }

  async getAllMargins(): Promise<NowMarginRecord[]> {
    const result = await this.db.execute('SELECT * FROM margin_config ORDER BY currency ASC');
    return result.rows.map((row) => rowToMarginRecord(row as unknown as Record<string, unknown>));
  }

  async upsertMargin(input: { currency: SupportedCurrency; margin_percentage: number }): Promise<NowMarginRecord> {
    const updatedAt = new Date().toISOString();
    await this.db.execute({
      sql: `INSERT INTO margin_config (currency, margin_percentage, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(currency) DO UPDATE SET
              margin_percentage = excluded.margin_percentage,
              updated_at = excluded.updated_at`,
      args: [input.currency, input.margin_percentage, updatedAt]
    });
    const result = await this.db.execute({
      sql: 'SELECT * FROM margin_config WHERE currency = ?',
      args: [input.currency]
    });
    return rowToMarginRecord(result.rows[0] as unknown as Record<string, unknown>);
  }

  async getNowFlatHistorySince(
    currency: SupportedCurrency,
    sinceIso: string,
    excludeRunId: number
  ): Promise<{ rates: number[]; distinctDays: number }> {
    const result = await this.db.execute({
      sql: `SELECT rate, fetched_at FROM rate_snapshots
            WHERE currency = ?
              AND provider_key = 'now-flat'
              AND status = 'SUCCESS'
              AND rate IS NOT NULL
              AND fetched_at >= ?
              AND run_id != ?
            ORDER BY fetched_at ASC`,
      args: [currency, sinceIso, excludeRunId]
    });
    const rates: number[] = [];
    const days = new Set<string>();
    for (const row of result.rows) {
      const r = (row as unknown as { rate: number; fetched_at: string });
      rates.push(Number(r.rate));
      days.add(r.fetched_at.slice(0, 10));
    }
    return { rates, distinctDays: days.size };
  }

  async insertCampaignRecommendation(input: Omit<CampaignRecommendationRecord, 'id'>): Promise<CampaignRecommendationRecord> {
    const result = await this.db.execute({
      sql: `INSERT INTO campaign_recommendations (
              run_id, currency, signal_type, delivery_status, flat_rate,
              best_competitor_rate, best_competitor_key, google_rate,
              history_max, history_days_available, recommended_margin,
              in_salary_cycle, rationale, evaluated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        input.run_id,
        input.currency,
        input.signal_type,
        input.delivery_status,
        input.flat_rate,
        input.best_competitor_rate,
        input.best_competitor_key,
        input.google_rate,
        input.history_max,
        input.history_days_available,
        input.recommended_margin,
        input.in_salary_cycle,
        input.rationale,
        input.evaluated_at
      ]
    });
    const id = bigintToNumber(result.lastInsertRowid);
    const row = await this.db.execute({
      sql: 'SELECT * FROM campaign_recommendations WHERE id = ?',
      args: [id]
    });
    return rowToCampaignRecord(row.rows[0] as unknown as Record<string, unknown>);
  }

  async getRecentEmittedRecommendation(
    currency: SupportedCurrency,
    signalType: CampaignSignalType,
    sinceIso: string
  ): Promise<CampaignRecommendationRecord | null> {
    const result = await this.db.execute({
      sql: `SELECT * FROM campaign_recommendations
            WHERE currency = ?
              AND signal_type = ?
              AND delivery_status = 'EMITTED'
              AND evaluated_at >= ?
            ORDER BY evaluated_at DESC
            LIMIT 1`,
      args: [currency, signalType, sinceIso]
    });
    const row = result.rows[0];
    return row ? rowToCampaignRecord(row as unknown as Record<string, unknown>) : null;
  }

  async countRunsSince(since: string): Promise<number> {
    const result = await this.db.execute({
      sql: 'SELECT COUNT(*) AS count FROM collection_runs WHERE started_at >= ?',
      args: [since]
    });
    const row = result.rows[0];
    return row ? Number((row as unknown as { count: number }).count) : 0;
  }
}
