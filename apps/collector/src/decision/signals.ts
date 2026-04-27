import type { CampaignSignalType, ProviderKey, SupportedCurrency } from '@rate-monitor/shared';

export const MAX_MARGIN_PERCENT = 0.3;
export const BEAT_BUFFER_BPS = 0.0005;
export const LIVE_RATE_TOP_FRACTION = 0.5;
export const LIVE_RATE_SALARY_TOP_FRACTION = 0.6;

export interface CompetitorRate {
  providerKey: ProviderKey;
  rate: number;
}

export interface SignalEvaluationInput {
  currency: SupportedCurrency;
  flatRate: number;
  competitors: CompetitorRate[];
  googleRate: number | null;
  historyMax: number | null;
  historyDaysAvailable: number;
  inSalaryCycle: boolean;
  newHighMinHistoryDays: number;
}

export interface DetectedSignal {
  signalType: CampaignSignalType;
  recommendedMargin: number;
  effectiveRate: number;
  rationale: string;
}

export function recommendMargin(flat: number, target: number | null): number | null {
  if (target === null) return 0;
  if (flat >= target) return 0;
  const needed = ((target * (1 + BEAT_BUFFER_BPS)) / flat - 1) * 100;
  if (needed > MAX_MARGIN_PERCENT) return null;
  const ceiled = Math.ceil(needed * 100) / 100;
  return Math.min(ceiled, MAX_MARGIN_PERCENT);
}

export function applyMargin(flat: number, marginPercent: number): number {
  return flat + flat * (marginPercent / 100);
}

export function isSalaryCycleDay(date: Date, timezoneId: string | null | undefined): boolean {
  const tz = timezoneId ?? 'UTC';
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = fmt.formatToParts(date);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const day = Number(parts.find((p) => p.type === 'day')?.value);
  if (!year || !month || !day) return false;
  const daysInMonth = new Date(year, month, 0).getDate();
  return day <= 7 || day > daysInMonth - 7;
}

export function liveRateThresholdRank(competitorCount: number, inSalaryCycle: boolean): number {
  const fraction = inSalaryCycle ? LIVE_RATE_SALARY_TOP_FRACTION : LIVE_RATE_TOP_FRACTION;
  return Math.max(1, Math.ceil((competitorCount + 1) * fraction));
}

export function rankFlatAmongCompetitors(flat: number, competitors: CompetitorRate[]): number {
  const allRates = [...competitors.map((c) => c.rate), flat].sort((a, b) => b - a);
  return allRates.findIndex((r) => r === flat) + 1;
}

export function bestCompetitor(competitors: CompetitorRate[]): CompetitorRate | null {
  if (competitors.length === 0) return null;
  return competitors.reduce((acc, c) => (c.rate > acc.rate ? c : acc));
}

export function detectLiveRate(input: SignalEvaluationInput): DetectedSignal | null {
  if (input.competitors.length === 0) return null;
  const totalParticipants = input.competitors.length + 1;
  const rank = rankFlatAmongCompetitors(input.flatRate, input.competitors);
  const threshold = liveRateThresholdRank(input.competitors.length, input.inSalaryCycle);
  if (rank > threshold) return null;
  return {
    signalType: 'LIVE_RATE',
    recommendedMargin: 0,
    effectiveRate: input.flatRate,
    rationale: `Rank #${rank} of ${totalParticipants}${input.inSalaryCycle ? ' (top 60% in salary cycle)' : ' (top 50%)'}`
  };
}

export function detectBestInMarket(input: SignalEvaluationInput): DetectedSignal | null {
  const best = bestCompetitor(input.competitors);
  if (!best) return null;
  const margin = recommendMargin(input.flatRate, best.rate);
  if (margin === null) return null;
  return {
    signalType: 'BEST_IN_MARKET',
    recommendedMargin: margin,
    effectiveRate: applyMargin(input.flatRate, margin),
    rationale: `Best competitor ${best.providerKey} at ${best.rate}, margin ${margin}% beats by 5bps buffer`
  };
}

export function detectBeatGoogle(input: SignalEvaluationInput): DetectedSignal | null {
  if (input.googleRate === null) return null;
  const margin = recommendMargin(input.flatRate, input.googleRate);
  if (margin === null) return null;
  return {
    signalType: 'BEAT_GOOGLE',
    recommendedMargin: margin,
    effectiveRate: applyMargin(input.flatRate, margin),
    rationale: `Google ${input.googleRate}, margin ${margin}% matches/beats with 5bps buffer`
  };
}

export interface NewHighOutcome {
  signal: DetectedSignal | null;
  coldStart: boolean;
}

export function detectNewHigh(input: SignalEvaluationInput): NewHighOutcome {
  if (input.historyDaysAvailable < input.newHighMinHistoryDays) {
    return { signal: null, coldStart: true };
  }
  if (input.historyMax === null) {
    return { signal: null, coldStart: true };
  }
  if (input.flatRate < input.historyMax) {
    return { signal: null, coldStart: false };
  }
  const best = bestCompetitor(input.competitors);
  let margin = 0;
  if (best) {
    const recommended = recommendMargin(input.flatRate, best.rate);
    margin = recommended ?? MAX_MARGIN_PERCENT;
  }
  const pctOverHistory = ((input.flatRate / input.historyMax) - 1) * 100;
  return {
    signal: {
      signalType: 'NEW_HIGH',
      recommendedMargin: margin,
      effectiveRate: applyMargin(input.flatRate, margin),
      rationale: `Flat ${input.flatRate} ≥ 30d max ${input.historyMax} (+${pctOverHistory.toFixed(2)}%)`
    },
    coldStart: false
  };
}

export interface CascadeOutcome {
  signals: DetectedSignal[];
  newHighColdStart: boolean;
}

export function runCascade(input: SignalEvaluationInput): CascadeOutcome {
  const signals: DetectedSignal[] = [];

  const bestInMarket = detectBestInMarket(input);
  const beatGoogle = detectBeatGoogle(input);

  if (bestInMarket) signals.push(bestInMarket);
  if (beatGoogle) signals.push(beatGoogle);

  if (!bestInMarket && !beatGoogle) {
    const liveRate = detectLiveRate(input);
    if (liveRate) signals.push(liveRate);
  }

  const newHigh = detectNewHigh(input);
  if (newHigh.signal) signals.push(newHigh.signal);

  return { signals, newHighColdStart: newHigh.coldStart };
}
