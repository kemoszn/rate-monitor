export const API_VERSION = 'v1' as const;

export const SUPPORTED_CURRENCIES = ['INR', 'PKR', 'NPR'] as const;
export const NOW_MODES = ['FLAT', 'SUBSIDIZED'] as const;
export const RUN_STATUSES = ['RUNNING', 'SUCCESS', 'PARTIAL_SUCCESS', 'FAILED'] as const;
export const SNAPSHOT_STATUSES = ['SUCCESS', 'FAILED'] as const;
export const SLACK_DELIVERY_STATUSES = ['SENT', 'FAILED', 'SKIPPED'] as const;
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

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];
export type NowMode = (typeof NOW_MODES)[number];
export type RunStatus = (typeof RUN_STATUSES)[number];
export type SnapshotStatus = (typeof SNAPSHOT_STATUSES)[number];
export type SlackDeliveryStatus = (typeof SLACK_DELIVERY_STATUSES)[number];
export type ExchangeHouseProviderKey = (typeof EXCHANGE_HOUSE_PROVIDER_KEYS)[number];
export type BenchmarkProviderKey = (typeof BENCHMARK_PROVIDER_KEYS)[number];
export type NowProviderKey = (typeof NOW_PROVIDER_KEYS)[number];
export type ProviderKey = ExchangeHouseProviderKey | BenchmarkProviderKey | NowProviderKey;
export type SummaryProviderKey = ExchangeHouseProviderKey | BenchmarkProviderKey;
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

export interface SlackRunSummaryCell {
  currency: SupportedCurrency;
  rate: number | null;
  status: SnapshotStatus;
}

export interface SlackRunSummaryProviderRow {
  provider_key: SummaryProviderKey;
  provider_name: string;
  cells: SlackRunSummaryCell[];
}

export interface SlackRunSummaryPayload {
  run_id: number;
  status: RunStatus;
  completed_at: string;
  success_count: number;
  failure_count: number;
  currencies: SupportedCurrency[];
  rows: SlackRunSummaryProviderRow[];
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

export const CAMPAIGN_SIGNAL_TYPES = ['LIVE_RATE', 'BEST_IN_MARKET', 'BEAT_GOOGLE', 'NEW_HIGH'] as const;
export type CampaignSignalType = (typeof CAMPAIGN_SIGNAL_TYPES)[number];

export const CAMPAIGN_DELIVERY_STATUSES = ['EMITTED', 'SUPPRESSED_DUPLICATE', 'SUPPRESSED_COLD_START'] as const;
export type CampaignDeliveryStatus = (typeof CAMPAIGN_DELIVERY_STATUSES)[number];

export interface CampaignRecommendation {
  currency: SupportedCurrency;
  signalType: CampaignSignalType;
  deliveryStatus: CampaignDeliveryStatus;
  flatRate: number;
  bestCompetitorRate: number | null;
  bestCompetitorKey: ProviderKey | null;
  googleRate: number | null;
  historyMax: number | null;
  historyDaysAvailable: number;
  recommendedMargin: number;
  effectiveRate: number;
  inSalaryCycle: boolean;
  rationale: string;
  evaluatedAt: string;
}

export interface CampaignRecommendationRecord {
  id: number;
  run_id: number;
  currency: SupportedCurrency;
  signal_type: CampaignSignalType;
  delivery_status: CampaignDeliveryStatus;
  flat_rate: number;
  best_competitor_rate: number | null;
  best_competitor_key: ProviderKey | null;
  google_rate: number | null;
  history_max: number | null;
  history_days_available: number;
  recommended_margin: number;
  in_salary_cycle: number;
  rationale: string;
  evaluated_at: string;
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
