import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import {
  isSupportedCurrency,
  type ExchangeHouseProviderDefinition,
  type ExtractResponse,
  type SupportedCurrency
} from '@rate-monitor/shared';
import { collectorConfig } from '../config.js';
import { createPlaywrightBrowser, createPlaywrightContext } from '../playwrightFactory.js';
import { PlaywrightDeterministicExtractor } from '../playwrightDeterministicExtractor.js';
import { findProviderByKey, getProviders } from '../providers/registry.js';

interface CliOptions {
  providerKeys: string[];
  currencies: SupportedCurrency[];
}

interface ProviderBenchmarkResult {
  provider: string;
  provider_name: string;
  source_url: string;
  elapsed_ms: number;
  result_count: number;
  error_count: number;
  results: Array<{ currency: SupportedCurrency; rate: number }>;
  errors: Array<{ currency: string; reason_code: string; message: string }>;
}

interface BenchmarkReport {
  started_at: string;
  finished_at: string;
  total_elapsed_ms: number;
  provider_count: number;
  currency_count: number;
  success_count: number;
  failure_count: number;
  runs: ProviderBenchmarkResult[];
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const app = Fastify({
    logger: {
      level: collectorConfig.logLevel
    }
  });

  try {
    const report = await benchmarkProviders(app.log, options);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await app.close();
  }
}

export function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    providerKeys: [],
    currencies: []
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    switch (arg) {
      case '--provider':
        if (!args[index + 1]) {
          throw new Error('Missing value for --provider <provider-key>.');
        }
        options.providerKeys.push(args[index + 1]);
        index += 1;
        break;
      case '--currency': {
        const nextCurrency = (args[index + 1] ?? '').toUpperCase();
        if (!isSupportedCurrency(nextCurrency)) {
          throw new Error(`Unsupported currency: ${args[index + 1] ?? ''}`);
        }
        options.currencies.push(nextCurrency);
        index += 1;
        break;
      }
      default:
        throw new Error(
          'Usage: tsx src/cli/benchmarkProviders.ts [--provider <provider-key>]... [--currency <currency>]...'
        );
    }
  }

  const providerKeys = options.providerKeys.length > 0 ? dedupe(options.providerKeys) : getProviders().map((provider) => provider.key);
  const currencies = options.currencies.length > 0 ? dedupe(options.currencies) : (['INR', 'NPR', 'PKR'] as SupportedCurrency[]);

  for (const providerKey of providerKeys) {
    if (!findProviderByKey(providerKey)) {
      throw new Error(`Unknown provider: ${providerKey}`);
    }
  }

  return {
    providerKeys,
    currencies
  };
}

async function benchmarkProviders(
  logger: ReturnType<typeof Fastify>['log'],
  options: CliOptions
): Promise<BenchmarkReport> {
  const providers = options.providerKeys.map((providerKey) => findProviderByKey(providerKey) as ExchangeHouseProviderDefinition);
  const startedAt = new Date();
  const suiteStarted = process.hrtime.bigint();
  const runs: ProviderBenchmarkResult[] = [];

  const browser = await createPlaywrightBrowser(collectorConfig);
  const context = await createPlaywrightContext(browser);

  try {
    for (const provider of providers) {
      const extractor = new PlaywrightDeterministicExtractor(logger, provider);
      const runStarted = process.hrtime.bigint();
      const response = await extractor.extract(
        {
          source_url: provider.sourceUrl,
          base_currency: provider.supportedBaseCurrency,
          currencies: options.currencies
        },
        context
      );
      const elapsedMs = Number(process.hrtime.bigint() - runStarted) / 1_000_000;

      runs.push(buildProviderResult(provider, response, elapsedMs));
    }
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }

  const totalElapsedMs = Number(process.hrtime.bigint() - suiteStarted) / 1_000_000;
  const successCount = runs.reduce((total, run) => total + run.result_count, 0);
  const failureCount = runs.reduce((total, run) => total + run.error_count, 0);

  return {
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    total_elapsed_ms: roundMs(totalElapsedMs),
    provider_count: runs.length,
    currency_count: options.currencies.length,
    success_count: successCount,
    failure_count: failureCount,
    runs
  };
}

function buildProviderResult(
  provider: ExchangeHouseProviderDefinition,
  response: ExtractResponse,
  elapsedMs: number
): ProviderBenchmarkResult {
  return {
    provider: provider.key,
    provider_name: provider.displayName,
    source_url: provider.sourceUrl,
    elapsed_ms: roundMs(elapsedMs),
    result_count: response.results.length,
    error_count: response.errors.length,
    results: response.results.map((result) => ({
      currency: result.quote_currency,
      rate: result.rate
    })),
    errors: response.errors.map((error) => ({
      currency: error.quote_currency,
      reason_code: error.reason_code,
      message: error.message
    }))
  };
}

function dedupe<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
