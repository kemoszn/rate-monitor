import {
  NOW_PROVIDER_BY_MODE,
  type CollectedRateResult,
  type FailedRateCollection,
  type NowMode,
  type ProviderKey,
  type SuccessfulRateCollection,
  type SupportedCurrency
} from '@rate-monitor/shared';

export interface UpstreamProviderRef {
  key: ProviderKey;
  displayName: string;
}

export function calculateSubsidizedRate(currentRate: number, marginPercentage: number): number {
  return currentRate + currentRate * (marginPercentage / 100);
}

export function deriveNowFlatRate(
  currency: SupportedCurrency,
  upstreamProvider: UpstreamProviderRef | null,
  upstream: CollectedRateResult | undefined
): CollectedRateResult {
  if (upstreamProvider === null) {
    return buildFailure(
      currency,
      NOW_PROVIDER_BY_MODE.FLAT.key,
      NOW_PROVIDER_BY_MODE.FLAT.displayName,
      'DEPENDENCY_FAILED',
      'NOW flat depends on a configured upstream provider.',
      'derived_now_flat',
      'FLAT',
      null
    );
  }

  if (!upstream || upstream.status === 'FAILED' || upstream.rate === null) {
    return buildFailure(
      currency,
      NOW_PROVIDER_BY_MODE.FLAT.key,
      NOW_PROVIDER_BY_MODE.FLAT.displayName,
      'DEPENDENCY_FAILED',
      `NOW flat depends on a successful ${upstreamProvider.displayName} rate.`,
      'derived_now_flat',
      'FLAT',
      upstreamProvider.key
    );
  }

  return buildSuccess(
    currency,
    NOW_PROVIDER_BY_MODE.FLAT.key,
    NOW_PROVIDER_BY_MODE.FLAT.displayName,
    upstream.fetchedAt,
    upstream.rate,
    `Derived from ${upstreamProvider.displayName} rate ${upstream.rate}.`,
    upstream.rate,
    'derived_now_flat',
    'FLAT',
    upstreamProvider.key
  );
}

export function deriveNowSubsidizedRate(
  currency: SupportedCurrency,
  flatRate: CollectedRateResult,
  marginPercentage: number
): CollectedRateResult {
  if (flatRate.status === 'FAILED' || flatRate.rate === null) {
    return buildFailure(
      currency,
      NOW_PROVIDER_BY_MODE.SUBSIDIZED.key,
      NOW_PROVIDER_BY_MODE.SUBSIDIZED.displayName,
      'DEPENDENCY_FAILED',
      'NOW subsidized depends on a successful NOW flat rate.',
      'derived_now_subsidized',
      'SUBSIDIZED',
      NOW_PROVIDER_BY_MODE.FLAT.key
    );
  }

  const subsidizedRate = calculateSubsidizedRate(flatRate.rate, marginPercentage);
  return buildSuccess(
    currency,
    NOW_PROVIDER_BY_MODE.SUBSIDIZED.key,
    NOW_PROVIDER_BY_MODE.SUBSIDIZED.displayName,
    flatRate.fetchedAt,
    subsidizedRate,
    `Derived from NOW flat ${flatRate.rate} with margin ${marginPercentage}%.`,
    `${flatRate.rate} + (${flatRate.rate} * ${marginPercentage} / 100)`,
    'derived_now_subsidized',
    'SUBSIDIZED',
    NOW_PROVIDER_BY_MODE.FLAT.key
  );
}

function buildSuccess(
  currency: SupportedCurrency,
  providerKey: ProviderKey,
  providerName: string,
  fetchedAt: string,
  rate: number,
  evidenceText: string,
  evidenceValue: string | number | null,
  extractionMode: string,
  nowMode: NowMode,
  derivedFromProviderKey: ProviderKey | null
): SuccessfulRateCollection {
  return {
    currency,
    providerKey,
    providerName,
    sourceUrl: null,
    fetchedAt,
    extractionMode,
    nowMode,
    derivedFromProviderKey,
    status: 'SUCCESS',
    rate,
    evidenceText,
    evidenceValue,
    failureCode: null,
    failureMessage: null
  };
}

function buildFailure(
  currency: SupportedCurrency,
  providerKey: ProviderKey,
  providerName: string,
  failureCode: string,
  failureMessage: string,
  extractionMode: string,
  nowMode: NowMode,
  derivedFromProviderKey: ProviderKey | null
): FailedRateCollection {
  return {
    currency,
    providerKey,
    providerName,
    sourceUrl: null,
    fetchedAt: new Date().toISOString(),
    extractionMode,
    nowMode,
    derivedFromProviderKey,
    status: 'FAILED',
    rate: null,
    evidenceText: null,
    evidenceValue: null,
    failureCode,
    failureMessage
  };
}
