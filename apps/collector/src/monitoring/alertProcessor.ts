import {
  ALERT_TYPES,
  GOOGLE_PROVIDER,
  NOW_MODES,
  NOW_PROVIDER_BY_MODE,
  type AlertConditions,
  type CollectionRunRecord,
  type ExchangeHouseProviderKey,
  type MarketRateSummary,
  type NowMode,
  type RateSnapshotRecord,
  type SlackAlertPayload,
  type SupportedCurrency
} from '@rate-monitor/shared';
import type { MonitoringRepository } from '../persistence/tursoClient.js';
import type { SlackNotifier } from './slackNotifier.js';

export interface AlertProcessorConfig {
  marketProviderKeys: readonly ExchangeHouseProviderKey[];
  marketProviderNames: Record<string, string>;
  lookbackDays: number;
}

export interface AlertProcessorDependencies {
  repository: MonitoringRepository;
  notifier: SlackNotifier;
  config: AlertProcessorConfig;
  logger: { info: (data: unknown, msg: string) => void; warn: (data: unknown, msg: string) => void };
}

export class AlertProcessor {
  constructor(private readonly deps: AlertProcessorDependencies) {}

  async processRun(run: CollectionRunRecord, currencies: readonly SupportedCurrency[], marginByCurrency: Map<SupportedCurrency, number>): Promise<void> {
    for (const currency of currencies) {
      const snapshots = await this.deps.repository.getSnapshotsForRun(run.id, currency);
      const marginPercentage = marginByCurrency.get(currency) ?? 0;

      for (const mode of NOW_MODES) {
        const status = await this.evaluateModeStatus(currency, snapshots, mode, marginPercentage, run.completed_at);

        for (const alertType of ALERT_TYPES) {
          const condition = status.conditions[alertType];
          const previousState = await this.deps.repository.getAlertState(currency, mode, alertType);
          const timestamp = run.completed_at ?? new Date().toISOString();

          if (condition.active && !previousState?.is_active && status.current_rate !== null) {
            const payload: SlackAlertPayload = {
              currency,
              now_mode: mode,
              alert_type: alertType,
              current_now_rate: status.current_rate,
              google_rate: status.google_rate,
              market_rates: status.market_rates,
              lookback_days: condition.lookback_days,
              timestamp
            };
            const delivery = await this.deps.notifier.send(payload);
            await this.deps.repository.insertAlertEvent({
              run_id: run.id,
              currency,
              now_mode: mode,
              alert_type: alertType,
              triggered_at: timestamp,
              lookback_days: condition.lookback_days,
              current_now_rate: status.current_rate,
              google_rate: status.google_rate,
              market_rates: status.market_rates,
              payload,
              delivery_status: delivery.deliveryStatus,
              delivery_error: delivery.deliveryError
            });
            if (delivery.deliveryStatus === 'SENT') {
              this.deps.logger.info({ currency, mode, alertType }, 'Alert delivered');
            } else if (delivery.deliveryStatus === 'FAILED') {
              this.deps.logger.warn(
                { currency, mode, alertType, error: delivery.deliveryError },
                'Alert delivery failed'
              );
            }
            // SKIPPED is intentionally silent — the alert event is still persisted to the DB
            // for audit; we just don't spam the log when no notifier is configured.
          }

          await this.deps.repository.saveAlertState({
            currency,
            now_mode: mode,
            alert_type: alertType,
            is_active: condition.active,
            activated_at: condition.active
              ? previousState?.activated_at ?? timestamp
              : previousState?.activated_at ?? null,
            cleared_at: condition.active
              ? null
              : previousState?.is_active
                ? timestamp
                : previousState?.cleared_at ?? null,
            last_run_id: run.id,
            updated_at: timestamp
          });
        }
      }
    }
  }

  private async evaluateModeStatus(
    currency: SupportedCurrency,
    snapshots: readonly RateSnapshotRecord[],
    mode: NowMode,
    marginPercentage: number,
    completedAt: string | null
  ) {
    const providerKey = NOW_PROVIDER_BY_MODE[mode].key;
    const currentSnapshot = snapshots.find((s) => s.provider_key === providerKey) ?? null;
    const marketRates = this.buildMarketRateSummary(snapshots);
    const googleSnapshot = snapshots.find((s) => s.provider_key === GOOGLE_PROVIDER.key) ?? null;
    const currentRate = currentSnapshot?.status === 'SUCCESS' ? currentSnapshot.rate : null;
    const googleRate = googleSnapshot?.status === 'SUCCESS' ? googleSnapshot.rate : null;
    const fetchedAt = currentSnapshot?.fetched_at ?? completedAt;

    const marketBest = marketRates.reduce<number | null>((best, entry) => {
      if (entry.rate === null) return best;
      if (best === null || entry.rate > best) return entry.rate;
      return best;
    }, null);

    const previousLookbackHigh =
      currentRate === null || fetchedAt === null
        ? null
        : await this.deps.repository.getPreviousMaxRate({
            currency,
            provider_key: providerKey,
            before_fetched_at: fetchedAt,
            since_fetched_at: new Date(
              new Date(fetchedAt).getTime() - this.deps.config.lookbackDays * 24 * 60 * 60 * 1000
            ).toISOString()
          });
    const previousAllTimeHigh =
      currentRate === null || fetchedAt === null
        ? null
        : await this.deps.repository.getPreviousMaxRate({
            currency,
            provider_key: providerKey,
            before_fetched_at: fetchedAt
          });

    const conditions: AlertConditions = {
      BEST_IN_MARKET: {
        active: currentRate !== null && marketBest !== null && currentRate >= marketBest,
        previous_peak_rate: marketBest,
        lookback_days: null
      },
      ABOVE_GOOGLE: {
        active: currentRate !== null && googleRate !== null && currentRate > googleRate,
        previous_peak_rate: googleRate,
        lookback_days: null
      },
      BEST_AND_ABOVE_GOOGLE: {
        active: currentRate !== null && marketBest !== null && googleRate !== null && currentRate >= marketBest && currentRate > googleRate,
        previous_peak_rate: marketBest === null || googleRate === null ? null : Math.max(marketBest, googleRate),
        lookback_days: null
      },
      HIGHEST_IN_LOOKBACK: {
        active: currentRate !== null && (previousLookbackHigh === null || currentRate > previousLookbackHigh),
        previous_peak_rate: previousLookbackHigh,
        lookback_days: this.deps.config.lookbackDays
      },
      HIGHEST_ALL_TIME: {
        active: currentRate !== null && (previousAllTimeHigh === null || currentRate > previousAllTimeHigh),
        previous_peak_rate: previousAllTimeHigh,
        lookback_days: null
      }
    };

    return {
      now_mode: mode,
      provider_key: providerKey,
      current_rate: currentRate,
      fetched_at: fetchedAt,
      margin_percentage: marginPercentage,
      google_rate: googleRate,
      market_rates: marketRates,
      conditions
    };
  }

  private buildMarketRateSummary(snapshots: readonly RateSnapshotRecord[]): MarketRateSummary[] {
    return this.deps.config.marketProviderKeys.map((providerKey) => {
      const snapshot = snapshots.find((entry) => entry.provider_key === providerKey);
      const status = snapshot?.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED';
      const rate = status === 'SUCCESS' && snapshot ? snapshot.rate : null;
      return {
        provider_key: providerKey,
        provider_name: this.deps.config.marketProviderNames[providerKey] ?? providerKey,
        rate,
        status
      };
    });
  }
}
