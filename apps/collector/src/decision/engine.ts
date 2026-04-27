import {
  EXCHANGE_HOUSE_PROVIDER_KEYS,
  type CampaignDeliveryStatus,
  type CampaignRecommendation,
  type CampaignRecommendationRecord,
  type ProviderKey,
  type RateSnapshotRecord,
  type SlackDeliveryStatus,
  type SupportedCurrency
} from '@rate-monitor/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { MonitoringRepository } from '../persistence/tursoClient.js';
import {
  isSalaryCycleDay,
  runCascade,
  type CompetitorRate,
  type DetectedSignal,
  type SignalEvaluationInput
} from './signals.js';

const COMPETITOR_PROVIDER_KEYS: readonly ProviderKey[] = [...EXCHANGE_HOUSE_PROVIDER_KEYS, 'google'];

export interface EngineConfig {
  newHighHistoryDays: number;
  newHighMinHistoryDays: number;
  dedupWindowHours: number;
}

export interface EvaluateRunArgs {
  repo: MonitoringRepository;
  runId: number;
  currencies: readonly SupportedCurrency[];
  timezoneId: string | null;
  config: EngineConfig;
  log: FastifyBaseLogger;
  evaluatedAt?: Date;
}

export interface EvaluationPlan {
  freshRecommendations: CampaignRecommendation[];
  finalize: (deliveryStatus: SlackDeliveryStatus) => Promise<void>;
}

type PendingRecord = Omit<CampaignRecommendationRecord, 'id'>;

export async function evaluateRun(args: EvaluateRunArgs): Promise<EvaluationPlan> {
  const evaluatedAt = args.evaluatedAt ?? new Date();
  const evaluatedAtIso = evaluatedAt.toISOString();
  const inSalaryCycle = isSalaryCycleDay(evaluatedAt, args.timezoneId);
  const historySince = new Date(evaluatedAt.getTime() - args.config.newHighHistoryDays * 24 * 60 * 60 * 1000).toISOString();
  const dedupSince = new Date(evaluatedAt.getTime() - args.config.dedupWindowHours * 60 * 60 * 1000).toISOString();

  const auditRecords: PendingRecord[] = [];
  const freshRecommendations: CampaignRecommendation[] = [];
  const freshRecordTemplates: PendingRecord[] = [];

  for (const currency of args.currencies) {
    const snapshots = await args.repo.getSnapshotsForRun(args.runId, currency);
    const flatSnapshot = pickSuccess(snapshots, 'now-flat');
    if (!flatSnapshot || flatSnapshot.rate === null) {
      args.log.info({ currency, runId: args.runId }, 'decision: no flat rate this run, skipping currency');
      continue;
    }
    const flatRate = flatSnapshot.rate;
    const competitors = collectCompetitors(snapshots);
    const googleRate = pickSuccess(snapshots, 'google')?.rate ?? null;
    const history = await args.repo.getNowFlatHistorySince(currency, historySince, args.runId);
    const historyMax = history.rates.length > 0 ? Math.max(...history.rates) : null;

    const input: SignalEvaluationInput = {
      currency,
      flatRate,
      competitors,
      googleRate,
      historyMax,
      historyDaysAvailable: history.distinctDays,
      inSalaryCycle,
      newHighMinHistoryDays: args.config.newHighMinHistoryDays
    };

    const cascade = runCascade(input);

    const baseRecord = {
      run_id: args.runId,
      currency,
      flat_rate: flatRate,
      best_competitor_rate: bestCompetitorRate(competitors),
      best_competitor_key: bestCompetitorKey(competitors),
      google_rate: googleRate,
      history_max: historyMax,
      history_days_available: history.distinctDays,
      in_salary_cycle: inSalaryCycle ? 1 : 0,
      evaluated_at: evaluatedAtIso
    };

    if (cascade.newHighColdStart) {
      auditRecords.push({
        ...baseRecord,
        signal_type: 'NEW_HIGH',
        delivery_status: 'SUPPRESSED_COLD_START',
        recommended_margin: 0,
        rationale: `Cold-start: ${history.distinctDays} days < ${args.config.newHighMinHistoryDays} required`
      });
    }

    for (const signal of cascade.signals) {
      const recent = await args.repo.getRecentEmittedRecommendation(currency, signal.signalType, dedupSince);
      if (recent) {
        auditRecords.push({
          ...baseRecord,
          signal_type: signal.signalType,
          delivery_status: 'SUPPRESSED_DUPLICATE',
          recommended_margin: signal.recommendedMargin,
          rationale: signal.rationale
        });
        args.log.info(
          { runId: args.runId, currency, signalType: signal.signalType },
          'decision: dedup suppressed'
        );
      } else {
        const template: PendingRecord = {
          ...baseRecord,
          signal_type: signal.signalType,
          delivery_status: 'EMITTED',
          recommended_margin: signal.recommendedMargin,
          rationale: signal.rationale
        };
        freshRecordTemplates.push(template);
        freshRecommendations.push(buildRecommendation(currency, signal, input, evaluatedAtIso));
      }
    }
  }

  const finalize = async (deliveryStatus: SlackDeliveryStatus): Promise<void> => {
    for (const record of auditRecords) {
      await args.repo.insertCampaignRecommendation(record);
    }
    const finalStatus = mapDeliveryToFinalStatus(deliveryStatus);
    for (const template of freshRecordTemplates) {
      await args.repo.insertCampaignRecommendation({ ...template, delivery_status: finalStatus });
    }
  };

  return { freshRecommendations, finalize };
}

function mapDeliveryToFinalStatus(status: SlackDeliveryStatus): CampaignDeliveryStatus {
  switch (status) {
    case 'SENT':
      return 'EMITTED';
    case 'FAILED':
      return 'SUPPRESSED_DELIVERY_FAILED';
    case 'SKIPPED':
    default:
      return 'SUPPRESSED_NO_WEBHOOK';
  }
}

function pickSuccess(snapshots: RateSnapshotRecord[], providerKey: ProviderKey): RateSnapshotRecord | undefined {
  return snapshots.find((s) => s.provider_key === providerKey && s.status === 'SUCCESS' && s.rate !== null);
}

function collectCompetitors(snapshots: RateSnapshotRecord[]): CompetitorRate[] {
  return COMPETITOR_PROVIDER_KEYS.flatMap((key) => {
    const s = pickSuccess(snapshots, key);
    return s && s.rate !== null ? [{ providerKey: s.provider_key, rate: s.rate }] : [];
  });
}

function bestCompetitorRate(competitors: CompetitorRate[]): number | null {
  if (competitors.length === 0) return null;
  return competitors.reduce((max, c) => (c.rate > max ? c.rate : max), competitors[0].rate);
}

function bestCompetitorKey(competitors: CompetitorRate[]): ProviderKey | null {
  if (competitors.length === 0) return null;
  return competitors.reduce((acc, c) => (c.rate > acc.rate ? c : acc)).providerKey;
}

function buildRecommendation(
  currency: SupportedCurrency,
  signal: DetectedSignal,
  input: SignalEvaluationInput,
  evaluatedAtIso: string
): CampaignRecommendation {
  return {
    currency,
    signalType: signal.signalType,
    deliveryStatus: 'EMITTED',
    flatRate: input.flatRate,
    bestCompetitorRate: bestCompetitorRate(input.competitors),
    bestCompetitorKey: bestCompetitorKey(input.competitors),
    googleRate: input.googleRate,
    historyMax: input.historyMax,
    historyDaysAvailable: input.historyDaysAvailable,
    recommendedMargin: signal.recommendedMargin,
    effectiveRate: signal.effectiveRate,
    inSalaryCycle: input.inSalaryCycle,
    rationale: signal.rationale,
    evaluatedAt: evaluatedAtIso
  };
}
