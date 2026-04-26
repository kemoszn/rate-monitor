import { z } from 'zod';
import {
  EXCHANGE_HOUSE_PROVIDER_KEYS,
  EXCHANGE_HOUSE_PROVIDERS,
  PROVIDER_PARSER_KEYS,
  SUPPORTED_CURRENCIES,
  type ExchangeHouseProviderDefinition,
  type ExchangeHouseProviderKey
} from '@rate-monitor/shared';

const rateBoundsSchema = z.object({
  min: z.number(),
  max: z.number()
});

const interactionSchema = z.object({
  actSteps: z.array(z.string()).readonly()
});

const domSchema = z.object({
  customDropdownOptionSelectorTemplate: z.string(),
  customDropdownTriggerSelectors: z.array(z.string()).readonly(),
  selectedCurrencySelectors: z.array(z.string()).readonly(),
  rateContainerSelectors: z.array(z.string()).readonly(),
  selectionMatchAliasesByCurrency: z
    .record(z.enum(SUPPORTED_CURRENCIES), z.array(z.string()).readonly())
    .optional(),
  sendAmountInputSelectors: z.array(z.string()).readonly().optional(),
  sendAmountLabelPatterns: z.array(z.string()).readonly().optional(),
  receiveFieldLabelPatterns: z.array(z.string()).readonly().optional(),
  selectionSettleDelayMs: z.number().int().positive().optional()
});

const rateTextSchema = z.object({
  fromSelector: z.string(),
  rateSelector: z.string(),
  toSelector: z.string(),
  labelSelector: z.string().optional()
});

const stagehandSchema = z.object({
  discoverySteps: z.array(z.string()).readonly(),
  repairSteps: z.array(z.string()).readonly()
});

const providerSchema = z.object({
  key: z.enum(EXCHANGE_HOUSE_PROVIDER_KEYS),
  name: z.string(),
  displayName: z.string(),
  sourceUrl: z.string().url(),
  hostnames: z.array(z.string()).readonly(),
  supportedBaseCurrency: z.literal('AED'),
  supportedQuoteCurrencies: z.array(z.enum(SUPPORTED_CURRENCIES)).readonly(),
  parserKey: z.enum(PROVIDER_PARSER_KEYS),
  bounds: z.record(z.enum(SUPPORTED_CURRENCIES), rateBoundsSchema),
  interaction: interactionSchema,
  deterministic: z.object({ dom: domSchema, rateText: rateTextSchema }),
  stagehand: stagehandSchema
});

const providersSchema = z.array(providerSchema);

let cached: readonly ExchangeHouseProviderDefinition[] | null = null;

function loadProviders(): readonly ExchangeHouseProviderDefinition[] {
  if (cached) return cached;

  const raw = process.env.PROVIDER_CONFIG_JSON;
  if (!raw || raw.trim().length === 0) {
    cached = EXCHANGE_HOUSE_PROVIDERS;
    return cached;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `PROVIDER_CONFIG_JSON is not valid JSON: ${error instanceof Error ? error.message : 'unknown error'}`
    );
  }

  const result = providersSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`PROVIDER_CONFIG_JSON failed validation: ${result.error.message}`);
  }

  cached = result.data as readonly ExchangeHouseProviderDefinition[];
  return cached;
}

export function getProviders(): readonly ExchangeHouseProviderDefinition[] {
  return loadProviders();
}

export function findProviderByKey(key: string): ExchangeHouseProviderDefinition | undefined {
  return loadProviders().find((provider) => provider.key === key);
}

export function findProviderByHostname(hostname: string): ExchangeHouseProviderDefinition | undefined {
  return loadProviders().find((provider) => provider.hostnames.includes(hostname));
}

export function getProviderKeys(): readonly ExchangeHouseProviderKey[] {
  return loadProviders().map((provider) => provider.key);
}

export function resetProviderCacheForTests(): void {
  cached = null;
}
