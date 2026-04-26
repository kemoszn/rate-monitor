import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import {
  DEFAULT_LOOKBACK_DAYS,
  SUPPORTED_CURRENCIES,
  isSupportedCurrency,
  type CollectedRateResult,
  type ExchangeHouseProviderDefinition,
  type ExtractError,
  type ExtractResponse,
  type ExtractResult,
  type FailedRateCollection,
  type RunStatus,
  type SuccessfulRateCollection,
  type SupportedCurrency
} from '@rate-monitor/shared';
import { collectorConfig } from '../config.js';
import { AlertProcessor } from '../monitoring/alertProcessor.js';
import { GoogleRateCollector } from '../monitoring/googleCollector.js';
import { SlackNotifier } from '../monitoring/slackNotifier.js';
import { deriveNowFlatRate, deriveNowSubsidizedRate } from '../monitoring/derivedRates.js';
import { MonitoringRepository } from '../persistence/tursoClient.js';
import { PlaywrightDeterministicExtractor } from '../playwrightDeterministicExtractor.js';
import { createPlaywrightBrowser, createPlaywrightContext } from '../playwrightFactory.js';
import { pickRandomProfile } from '../playwrightFactory/profiles.js';
import { getProviders } from '../providers/registry.js';
import { withRetry } from '../retry.js';
import { resolveGeoContext } from '../runtime/geoContext.js';

interface CronEnv {
  turso: { url: string; authToken: string | undefined };
  slack: { rateWebhookUrl: string | undefined; opsWebhookUrl: string | undefined; timeoutMs: number };
  google: { baseUrl: string; timeoutMs: number; baseCurrency: string; userAgent: string };
  currencies: readonly SupportedCurrency[];
  failureExitThreshold: number;
  triggeredBy: string;
  triggerReason: string | null;
  geoLookupEnabled: boolean;
}

function parseEnv(): CronEnv {
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  if (!tursoUrl) {
    throw new Error('TURSO_DATABASE_URL is required');
  }
  const baseCurrency = process.env.BASE_CURRENCY ?? 'AED';
  const currenciesEnv = process.env.QUOTE_CURRENCIES;
  const currencies = currenciesEnv
    ? currenciesEnv.split(',').map((value) => value.trim().toUpperCase()).filter((value) => value.length > 0)
    : [...SUPPORTED_CURRENCIES];
  for (const currency of currencies) {
    if (!isSupportedCurrency(currency)) {
      throw new Error(`Unsupported currency in QUOTE_CURRENCIES: ${currency}`);
    }
  }

  return {
    turso: { url: tursoUrl, authToken: process.env.TURSO_AUTH_TOKEN },
    slack: {
      rateWebhookUrl: process.env.SLACK_RATE_WEBHOOK_URL ?? process.env.SLACK_WEBHOOK_URL,
      opsWebhookUrl: process.env.SLACK_OPS_WEBHOOK_URL,
      timeoutMs: Number.parseInt(process.env.SLACK_REQUEST_TIMEOUT_MS ?? '10000', 10)
    },
    google: {
      baseUrl: process.env.GOOGLE_FINANCE_BASE_URL ?? 'https://www.google.com/finance/quote',
      timeoutMs: Number.parseInt(process.env.GOOGLE_FETCH_TIMEOUT_MS ?? '15000', 10),
      baseCurrency,
      userAgent:
        process.env.GOOGLE_USER_AGENT ??
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
    },
    currencies: currencies as SupportedCurrency[],
    failureExitThreshold: Number.parseInt(process.env.FAILURE_EXIT_THRESHOLD ?? '3', 10),
    triggeredBy: process.env.TRIGGERED_BY ?? (process.env.GITHUB_RUN_ID ? 'github_actions' : 'manual'),
    triggerReason: process.env.TRIGGER_REASON ?? (process.env.GITHUB_RUN_ID ? `gha_run_${process.env.GITHUB_RUN_ID}` : null),
    geoLookupEnabled: (process.env.GEO_LOOKUP_ENABLED ?? 'true').toLowerCase() !== 'false'
  };
}

function mapExtractSuccess(provider: ExchangeHouseProviderDefinition, result: ExtractResult): SuccessfulRateCollection {
  return {
    currency: result.quote_currency,
    providerKey: provider.key,
    providerName: result.provider_name,
    sourceUrl: result.source_url,
    fetchedAt: result.fetched_at,
    extractionMode: result.extraction_mode,
    nowMode: null,
    derivedFromProviderKey: null,
    status: 'SUCCESS',
    rate: result.rate,
    evidenceText: result.evidence_text,
    evidenceValue: result.evidence_value,
    failureCode: null,
    failureMessage: null
  };
}

function mapExtractError(
  provider: ExchangeHouseProviderDefinition,
  currency: SupportedCurrency,
  error: ExtractError | undefined,
  fallbackFetchedAt: string
): FailedRateCollection {
  return {
    currency,
    providerKey: provider.key,
    providerName: provider.displayName,
    sourceUrl: provider.sourceUrl,
    fetchedAt: error?.fetched_at ?? fallbackFetchedAt,
    extractionMode: error?.extraction_mode ?? 'playwright_deterministic',
    nowMode: null,
    derivedFromProviderKey: null,
    status: 'FAILED',
    rate: null,
    evidenceText: null,
    evidenceValue: null,
    failureCode: error?.reason_code ?? 'MISSING_RATE',
    failureMessage: error?.message ?? 'Extractor did not return a rate for the requested currency'
  };
}

function buildProviderWideFailure(
  provider: ExchangeHouseProviderDefinition,
  currency: SupportedCurrency,
  fetchedAt: string,
  error: unknown
): FailedRateCollection {
  return {
    currency,
    providerKey: provider.key,
    providerName: provider.displayName,
    sourceUrl: provider.sourceUrl,
    fetchedAt,
    extractionMode: 'playwright_deterministic',
    nowMode: null,
    derivedFromProviderKey: null,
    status: 'FAILED',
    rate: null,
    evidenceText: null,
    evidenceValue: null,
    failureCode: 'EXTRACTION_THREW',
    failureMessage: error instanceof Error ? error.message : 'Unknown extractor error'
  };
}

function resolveRunStatus(successCount: number, failureCount: number): RunStatus {
  if (successCount === 0) return 'FAILED';
  if (failureCount > 0) return 'PARTIAL_SUCCESS';
  return 'SUCCESS';
}

function buildErrorSummary(snapshots: readonly CollectedRateResult[]): string | null {
  const failures = snapshots
    .filter((snapshot): snapshot is FailedRateCollection => snapshot.status === 'FAILED')
    .map((snapshot) => `${snapshot.currency}:${snapshot.providerKey}:${snapshot.failureCode}`);
  return failures.length > 0 ? failures.join(', ') : null;
}

async function postOpsAlert(webhookUrl: string | undefined, message: string, timeoutMs: number): Promise<void> {
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    // never let ops Slack failure mask the real error
  }
}

async function main(): Promise<void> {
  const env = parseEnv();
  const app = Fastify({ logger: { level: collectorConfig.logLevel } });
  const log = app.log;

  const geo = env.geoLookupEnabled ? await resolveGeoContext() : undefined;
  if (geo) {
    process.env.TZ = geo.timezoneId;
    log.info({ source: geo.source, country: geo.countryCode, tz: geo.timezoneId, locale: geo.locale }, 'Resolved runtime geo');
  } else {
    log.info('Geo lookup disabled');
  }

  const repo = await MonitoringRepository.connect({ url: env.turso.url, authToken: env.turso.authToken });
  const slackNotifier = new SlackNotifier({ webhookUrl: env.slack.rateWebhookUrl, timeoutMs: env.slack.timeoutMs });
  const googleCollector = new GoogleRateCollector(env.google);

  const providers = getProviders();
  if (providers.length === 0) {
    throw new Error('No providers configured. Set PROVIDER_CONFIG_JSON or rely on the shared default.');
  }

  const slowMo = 50 + Math.floor(Math.random() * 100);
  const browser = await createPlaywrightBrowser(collectorConfig, { slowMo });
  const startedAt = new Date().toISOString();

  const run = await repo.createCollectionRun({
    triggered_by: env.triggeredBy,
    trigger_reason: env.triggerReason,
    status: 'RUNNING',
    started_at: startedAt
  });
  log.info({ runId: run.id, slowMo, providerCount: providers.length, currencyCount: env.currencies.length }, 'Collection run started');

  const exchangeSnapshots: CollectedRateResult[] = [];

  try {
    for (const provider of providers) {
      const profile = pickRandomProfile();
      const context = await createPlaywrightContext(browser, { profile, geo });
      const fallbackFetchedAt = new Date().toISOString();
      const eligibleCurrencies = env.currencies.filter((currency) => provider.supportedQuoteCurrencies.includes(currency));

      try {
        const extractor = new PlaywrightDeterministicExtractor(log, provider);
        const response: ExtractResponse = await withRetry(
          () =>
            extractor.extract(
              {
                source_url: provider.sourceUrl,
                base_currency: provider.supportedBaseCurrency,
                currencies: eligibleCurrencies
              },
              context
            ),
          collectorConfig.extraction.retryAttempts,
          collectorConfig.extraction.retryBaseDelayMs
        );

        for (const currency of eligibleCurrencies) {
          const success = response.results.find((entry) => entry.quote_currency === currency);
          if (success) {
            exchangeSnapshots.push(mapExtractSuccess(provider, success));
            continue;
          }
          const error = response.errors.find((entry) => entry.quote_currency === currency);
          exchangeSnapshots.push(mapExtractError(provider, currency, error, fallbackFetchedAt));
        }
      } catch (error) {
        log.error({ providerKey: provider.key, err: error instanceof Error ? error.message : 'unknown' }, 'Provider extraction threw');
        for (const currency of eligibleCurrencies) {
          exchangeSnapshots.push(buildProviderWideFailure(provider, currency, fallbackFetchedAt, error));
        }
      } finally {
        await context.close().catch(() => undefined);
      }
    }
  } catch (error) {
    log.error({ err: error instanceof Error ? error.message : 'unknown' }, 'Collection loop crashed');
    await browser.close().catch(() => undefined);
    await repo.updateCollectionRun({
      id: run.id,
      status: 'FAILED',
      completed_at: new Date().toISOString(),
      success_count: 0,
      failure_count: 0,
      total_sources: 0,
      error_summary: error instanceof Error ? error.message : 'Unknown collection loop error'
    });
    repo.close();
    await postOpsAlert(env.slack.opsWebhookUrl, `collect run ${run.id} crashed: ${error instanceof Error ? error.message : 'unknown'}`, env.slack.timeoutMs);
    process.exit(1);
  }

  await browser.close().catch(() => undefined);

  const googleSnapshots: CollectedRateResult[] = [];
  for (const currency of env.currencies) {
    googleSnapshots.push(await googleCollector.fetchRate(currency));
  }

  const marginRecords = await repo.getAllMargins();
  const margins = new Map(marginRecords.map((entry) => [entry.currency, entry.margin_percentage]));
  const upstreamProvider = providers[0] ?? null;
  const upstreamRef = upstreamProvider ? { key: upstreamProvider.key, displayName: upstreamProvider.displayName } : null;

  const derivedSnapshots: CollectedRateResult[] = [];
  for (const currency of env.currencies) {
    const upstream = exchangeSnapshots.find(
      (snapshot) => snapshot.currency === currency && snapshot.providerKey === upstreamProvider?.key
    );
    const flat = deriveNowFlatRate(currency, upstreamRef, upstream);
    const subsidized = deriveNowSubsidizedRate(currency, flat, margins.get(currency) ?? 0);
    derivedSnapshots.push(flat, subsidized);
  }

  const allSnapshots: CollectedRateResult[] = [...exchangeSnapshots, ...googleSnapshots, ...derivedSnapshots];
  await repo.insertRateSnapshots(run.id, allSnapshots);

  const successCount = allSnapshots.filter((snapshot) => snapshot.status === 'SUCCESS').length;
  const failureCount = allSnapshots.length - successCount;
  const completedRun = await repo.updateCollectionRun({
    id: run.id,
    status: resolveRunStatus(successCount, failureCount),
    completed_at: new Date().toISOString(),
    success_count: successCount,
    failure_count: failureCount,
    total_sources: allSnapshots.length,
    error_summary: buildErrorSummary(allSnapshots)
  });

  const alertProcessor = new AlertProcessor({
    repository: repo,
    notifier: slackNotifier,
    config: {
      marketProviderKeys: providers.map((provider) => provider.key),
      marketProviderNames: Object.fromEntries(providers.map((provider) => [provider.key, provider.displayName])),
      lookbackDays: DEFAULT_LOOKBACK_DAYS
    },
    logger: log
  });
  await alertProcessor.processRun(completedRun, env.currencies, margins);

  log.info({ runId: completedRun.id, status: completedRun.status, successCount, failureCount }, 'Collection run completed');

  repo.close();
  await app.close();

  const providerFailures = exchangeSnapshots.filter((snapshot) => snapshot.status === 'FAILED').length;
  if (providerFailures >= env.failureExitThreshold) {
    process.exit(1);
  }
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  main().catch(async (error) => {
    console.error('collect:once failed:', error);
    const opsWebhook = process.env.SLACK_OPS_WEBHOOK_URL;
    if (opsWebhook) {
      try {
        await fetch(opsWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: `collect:once crashed: ${error instanceof Error ? error.message : 'unknown'}` }),
          signal: AbortSignal.timeout(10_000)
        });
      } catch {
        /* noop */
      }
    }
    process.exit(1);
  });
}
