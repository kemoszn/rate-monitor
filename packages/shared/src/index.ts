export const API_VERSION = 'v1' as const;

export const SUPPORTED_CURRENCIES = ['INR', 'PKR', 'NPR'] as const;
export const NOW_MODES = ['FLAT', 'SUBSIDIZED'] as const;
export const ALERT_TYPES = [
  'BEST_IN_MARKET',
  'ABOVE_GOOGLE',
  'BEST_AND_ABOVE_GOOGLE',
  'HIGHEST_IN_LOOKBACK',
  'HIGHEST_ALL_TIME'
] as const;
export const RUN_STATUSES = ['RUNNING', 'SUCCESS', 'PARTIAL_SUCCESS', 'FAILED'] as const;
export const SNAPSHOT_STATUSES = ['SUCCESS', 'FAILED'] as const;
export const ALERT_DELIVERY_STATUSES = ['SENT', 'FAILED', 'SKIPPED'] as const;
export const EXCHANGE_HOUSE_PROVIDER_KEYS = ['provider-a', 'provider-b', 'provider-c', 'provider-d', 'provider-e'] as const;
export const BENCHMARK_PROVIDER_KEYS = ['google'] as const;
export const NOW_PROVIDER_KEYS = ['now-flat', 'now-subsidized'] as const;
export const COLLECTOR_EXTRACTION_MODES = ['playwright_deterministic', 'stagehand_discovery', 'stagehand_repair'] as const;
export const SYSTEM_EXTRACTION_MODES = [
  ...COLLECTOR_EXTRACTION_MODES,
  'google_finance_fetch',
  'derived_now_flat',
  'derived_now_subsidized'
] as const;
export const PROVIDER_PARSER_KEYS = ['provider-a-rate', 'provider-b-rate', 'provider-c-rate', 'provider-d-rate', 'provider-e-rate'] as const;
export const DEFAULT_LOOKBACK_DAYS = 30 as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];
export type NowMode = (typeof NOW_MODES)[number];
export type AlertType = (typeof ALERT_TYPES)[number];
export type RunStatus = (typeof RUN_STATUSES)[number];
export type SnapshotStatus = (typeof SNAPSHOT_STATUSES)[number];
export type AlertDeliveryStatus = (typeof ALERT_DELIVERY_STATUSES)[number];
export type ExchangeHouseProviderKey = (typeof EXCHANGE_HOUSE_PROVIDER_KEYS)[number];
export type BenchmarkProviderKey = (typeof BENCHMARK_PROVIDER_KEYS)[number];
export type NowProviderKey = (typeof NOW_PROVIDER_KEYS)[number];
export type ProviderKey = ExchangeHouseProviderKey | BenchmarkProviderKey | NowProviderKey;
export type CollectorExtractionMode = (typeof COLLECTOR_EXTRACTION_MODES)[number];
export type SystemExtractionMode = (typeof SYSTEM_EXTRACTION_MODES)[number];
export type ProviderParserKey = (typeof PROVIDER_PARSER_KEYS)[number];

export type FailureReasonCode =
  | 'UNSUPPORTED_BASE_CURRENCY'
  | 'UNSUPPORTED_QUOTE_CURRENCY'
  | 'NAVIGATION_FAILED'
  | 'CURRENCY_SELECTION_FAILED'
  | 'PARSE_FAILED'
  | 'VALIDATION_FAILED'
  | 'TIMEOUT'
  | 'UNKNOWN';

export interface RateBounds {
  min: number;
  max: number;
}

export interface ProviderInteractionPlaybook {
  actSteps: readonly string[];
}

export interface DeterministicDomPlaybook {
  customDropdownOptionSelectorTemplate: string;
  customDropdownTriggerSelectors: readonly string[];
  selectedCurrencySelectors: readonly string[];
  rateContainerSelectors: readonly string[];
  selectionMatchAliasesByCurrency?: Partial<Record<SupportedCurrency, readonly string[]>>;
  sendAmountInputSelectors?: readonly string[];
  sendAmountLabelPatterns?: readonly string[];
  receiveFieldLabelPatterns?: readonly string[];
  selectionSettleDelayMs?: number;
}

export interface DeterministicRateTextPlaybook {
  fromSelector: string;
  rateSelector: string;
  toSelector: string;
  labelSelector?: string;
}

export interface ProviderStagehandPlaybook {
  discoverySteps: readonly string[];
  repairSteps: readonly string[];
}

export interface ProviderDeterministicPlaybook {
  dom: DeterministicDomPlaybook;
  rateText: DeterministicRateTextPlaybook;
}

export interface ExchangeHouseProviderDefinition {
  key: ExchangeHouseProviderKey;
  name: string;
  displayName: string;
  sourceUrl: string;
  hostnames: readonly string[];
  supportedBaseCurrency: 'AED';
  supportedQuoteCurrencies: readonly SupportedCurrency[];
  parserKey: ProviderParserKey;
  bounds: Record<SupportedCurrency, RateBounds>;
  interaction: ProviderInteractionPlaybook;
  deterministic: ProviderDeterministicPlaybook;
  stagehand: ProviderStagehandPlaybook;
}

export interface ExtractRequest {
  source_url: string;
  base_currency: string;
  currencies: string[];
}

export interface ExtractResult {
  provider: ExchangeHouseProviderKey;
  provider_name: string;
  quote_currency: SupportedCurrency;
  rate: number;
  evidence: string;
  evidence_text: string;
  evidence_value: string | number | null;
  fetched_at: string;
  source_url: string;
  parser_path?: 'primary' | 'fallback';
  extraction_mode: CollectorExtractionMode;
}

export interface ExtractError {
  provider: ExchangeHouseProviderKey | 'unknown';
  provider_name: string;
  quote_currency: string;
  reason_code: FailureReasonCode;
  message: string;
  source_url: string;
  fetched_at: string;
  extraction_mode: CollectorExtractionMode;
}

export interface ExtractResponse {
  provider?: ExchangeHouseProviderKey;
  provider_name?: string;
  extraction_mode: CollectorExtractionMode;
  results: ExtractResult[];
  errors: ExtractError[];
}

export interface MarketRateSummary {
  provider_key: ExchangeHouseProviderKey;
  provider_name: string;
  rate: number | null;
  status: SnapshotStatus;
}

export interface SlackAlertPayload {
  currency: SupportedCurrency;
  now_mode: NowMode;
  alert_type: AlertType;
  current_now_rate: number;
  google_rate: number | null;
  market_rates: MarketRateSummary[];
  lookback_days: number | null;
  timestamp: string;
}

interface BaseCollectedRateResult {
  currency: SupportedCurrency;
  providerKey: ProviderKey;
  providerName: string;
  sourceUrl: string | null;
  fetchedAt: string;
  extractionMode: SystemExtractionMode | string;
  nowMode: NowMode | null;
  derivedFromProviderKey: ProviderKey | null;
}

export interface SuccessfulRateCollection extends BaseCollectedRateResult {
  status: 'SUCCESS';
  rate: number;
  evidenceText: string;
  evidenceValue: string | number | null;
  failureCode: null;
  failureMessage: null;
}

export interface FailedRateCollection extends BaseCollectedRateResult {
  status: 'FAILED';
  rate: null;
  evidenceText: string | null;
  evidenceValue: string | number | null;
  failureCode: string;
  failureMessage: string;
}

export type CollectedRateResult = SuccessfulRateCollection | FailedRateCollection;

export interface CollectionRunRecord {
  id: number;
  triggered_by: string;
  trigger_reason: string | null;
  status: RunStatus;
  started_at: string;
  completed_at: string | null;
  success_count: number;
  failure_count: number;
  total_sources: number;
  error_summary: string | null;
  created_at: string;
}

export interface RateSnapshotRecord {
  id: number;
  run_id: number;
  currency: SupportedCurrency;
  provider_key: ProviderKey;
  provider_name: string;
  source_url: string | null;
  now_mode: NowMode | null;
  rate: number | null;
  status: SnapshotStatus;
  failure_code: string | null;
  failure_message: string | null;
  evidence_text: string | null;
  evidence_value: string | null;
  extraction_mode: string | null;
  fetched_at: string;
  derived_from_provider_key: ProviderKey | null;
  created_at: string;
}

export interface NowMarginRecord {
  currency: SupportedCurrency;
  margin_percentage: number;
  updated_at: string;
}

export interface AlertStateRecord {
  currency: SupportedCurrency;
  now_mode: NowMode;
  alert_type: AlertType;
  is_active: boolean;
  activated_at: string | null;
  cleared_at: string | null;
  last_run_id: number | null;
  updated_at: string;
}

export interface AlertEventRecord {
  id: number;
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
}

export type AlertConditionStatus = {
  active: boolean;
  previous_peak_rate: number | null;
  lookback_days: number | null;
};

export type AlertConditions = Record<AlertType, AlertConditionStatus>;

export interface NowModeStatus {
  now_mode: NowMode;
  provider_key: NowProviderKey;
  current_rate: number | null;
  fetched_at: string | null;
  margin_percentage: number;
  google_rate: number | null;
  market_rates: MarketRateSummary[];
  conditions: AlertConditions;
}

const STANDARD_RATE_BOUNDS: Record<SupportedCurrency, RateBounds> = {
  INR: { min: 10, max: 40 },
  PKR: { min: 20, max: 120 },
  NPR: { min: 20, max: 80 }
};

export const EXCHANGE_HOUSE_PROVIDERS: readonly ExchangeHouseProviderDefinition[] = [];

export const GOOGLE_PROVIDER = {
  key: 'google' as const,
  displayName: 'Google Finance'
};

export const NOW_PROVIDER_BY_MODE: Record<NowMode, { key: NowProviderKey; displayName: string }> = {
  FLAT: {
    key: 'now-flat',
    displayName: 'NOW Flat'
  },
  SUBSIDIZED: {
    key: 'now-subsidized',
    displayName: 'NOW Subsidized'
  }
};

export const PROVIDER_ORDER: readonly ProviderKey[] = [
  ...EXCHANGE_HOUSE_PROVIDERS.map((provider) => provider.key),
  GOOGLE_PROVIDER.key,
  NOW_PROVIDER_BY_MODE.FLAT.key,
  NOW_PROVIDER_BY_MODE.SUBSIDIZED.key
];

export function findExchangeHouseProviderByHostname(hostname: string): ExchangeHouseProviderDefinition | undefined {
  return EXCHANGE_HOUSE_PROVIDERS.find((provider) => provider.hostnames.includes(hostname));
}

export function findExchangeHouseProviderByKey(providerKey: string): ExchangeHouseProviderDefinition | undefined {
  return EXCHANGE_HOUSE_PROVIDERS.find((provider) => provider.key === providerKey);
}

export function isSupportedCurrency(value: string): value is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}
