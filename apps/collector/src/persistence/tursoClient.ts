import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type Client, type InValue } from '@libsql/client';
import {
  SUPPORTED_CURRENCIES,
  type AlertDeliveryStatus,
  type AlertEventRecord,
  type AlertStateRecord,
  type AlertType,
  type CollectedRateResult,
  type CollectionRunRecord,
  type MarketRateSummary,
  type NowMarginRecord,
  type NowMode,
  type ProviderKey,
  type RateSnapshotRecord,
  type RunStatus,
  type SlackAlertPayload,
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

function rowToAlertState(row: Record<string, unknown>): AlertStateRecord {
  return {
    currency: row.currency as SupportedCurrency,
    now_mode: row.now_mode as NowMode,
    alert_type: row.alert_type as AlertType,
    is_active: row.is_active === 1 || row.is_active === true,
    activated_at: (row.activated_at as string | null) ?? null,
    cleared_at: (row.cleared_at as string | null) ?? null,
    last_run_id: row.last_run_id === null || row.last_run_id === undefined ? null : Number(row.last_run_id),
    updated_at: row.updated_at as string
  };
}

function rowToMarginRecord(row: Record<string, unknown>): NowMarginRecord {
  return {
    currency: row.currency as SupportedCurrency,
    margin_percentage: Number(row.margin_percentage),
    updated_at: row.updated_at as string
  };
}

function rowToAlertEvent(row: Record<string, unknown>): AlertEventRecord {
  return {
    id: Number(row.id),
    run_id: Number(row.run_id),
    currency: row.currency as SupportedCurrency,
    now_mode: row.now_mode as NowMode,
    alert_type: row.alert_type as AlertType,
    triggered_at: row.triggered_at as string,
    lookback_days: row.lookback_days === null || row.lookback_days === undefined ? null : Number(row.lookback_days),
    current_now_rate: Number(row.current_now_rate),
    google_rate: row.google_rate === null || row.google_rate === undefined ? null : Number(row.google_rate),
    market_rates: JSON.parse(row.market_rates_json as string) as MarketRateSummary[],
    payload: JSON.parse(row.payload_json as string) as SlackAlertPayload,
    delivery_status: row.delivery_status as AlertDeliveryStatus,
    delivery_error: (row.delivery_error as string | null) ?? null
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

  async getPreviousMaxRate(input: {
    currency: SupportedCurrency;
    provider_key: ProviderKey;
    before_fetched_at: string;
    since_fetched_at?: string;
  }): Promise<number | null> {
    const result = input.since_fetched_at
      ? await this.db.execute({
          sql: `SELECT MAX(rate) AS rate FROM rate_snapshots
                WHERE currency = ? AND provider_key = ? AND status = 'SUCCESS'
                  AND rate IS NOT NULL AND fetched_at < ? AND fetched_at >= ?`,
          args: [input.currency, input.provider_key, input.before_fetched_at, input.since_fetched_at]
        })
      : await this.db.execute({
          sql: `SELECT MAX(rate) AS rate FROM rate_snapshots
                WHERE currency = ? AND provider_key = ? AND status = 'SUCCESS'
                  AND rate IS NOT NULL AND fetched_at < ?`,
          args: [input.currency, input.provider_key, input.before_fetched_at]
        });
    const row = result.rows[0];
    if (!row) return null;
    const rate = (row as unknown as { rate: number | null }).rate;
    return rate === null || rate === undefined ? null : Number(rate);
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

  async getAlertState(
    currency: SupportedCurrency,
    nowMode: NowMode,
    alertType: AlertType
  ): Promise<AlertStateRecord | null> {
    const result = await this.db.execute({
      sql: `SELECT * FROM alert_state WHERE currency = ? AND now_mode = ? AND alert_type = ?`,
      args: [currency, nowMode, alertType]
    });
    const row = result.rows[0];
    return row ? rowToAlertState(row as unknown as Record<string, unknown>) : null;
  }

  async saveAlertState(input: AlertStateRecord): Promise<void> {
    await this.db.execute({
      sql: `INSERT INTO alert_state (
              currency, now_mode, alert_type, is_active, activated_at,
              cleared_at, last_run_id, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(currency, now_mode, alert_type) DO UPDATE SET
              is_active = excluded.is_active,
              activated_at = excluded.activated_at,
              cleared_at = excluded.cleared_at,
              last_run_id = excluded.last_run_id,
              updated_at = excluded.updated_at`,
      args: [
        input.currency,
        input.now_mode,
        input.alert_type,
        input.is_active ? 1 : 0,
        input.activated_at,
        input.cleared_at,
        input.last_run_id,
        input.updated_at
      ]
    });
  }

  async insertAlertEvent(input: {
    run_id: number;
    currency: SupportedCurrency;
    now_mode: NowMode;
    alert_type: AlertType;
    triggered_at: string;
    lookback_days: number | null;
    current_now_rate: number;
    google_rate: number | null;
    market_rates: MarketRateSummary[];
    payload: SlackAlertPayload;
    delivery_status: AlertDeliveryStatus;
    delivery_error: string | null;
  }): Promise<AlertEventRecord> {
    const result = await this.db.execute({
      sql: `INSERT INTO alert_events (
              run_id, currency, now_mode, alert_type, triggered_at, lookback_days,
              current_now_rate, google_rate, market_rates_json, payload_json,
              delivery_status, delivery_error
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        input.run_id,
        input.currency,
        input.now_mode,
        input.alert_type,
        input.triggered_at,
        input.lookback_days,
        input.current_now_rate,
        input.google_rate,
        JSON.stringify(input.market_rates),
        JSON.stringify(input.payload),
        input.delivery_status,
        input.delivery_error
      ]
    });
    const id = bigintToNumber(result.lastInsertRowid);
    const fetched = await this.db.execute({
      sql: 'SELECT * FROM alert_events WHERE id = ?',
      args: [id]
    });
    return rowToAlertEvent(fetched.rows[0] as unknown as Record<string, unknown>);
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
