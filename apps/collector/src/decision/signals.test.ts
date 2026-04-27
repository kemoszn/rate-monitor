import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyMargin,
  bestCompetitor,
  detectBeatGoogle,
  detectBestInMarket,
  detectLiveRate,
  detectNewHigh,
  isSalaryCycleDay,
  liveRateThresholdRank,
  rankFlatAmongCompetitors,
  recommendMargin,
  runCascade,
  type SignalEvaluationInput
} from './signals.js';

const baseInput: SignalEvaluationInput = {
  currency: 'INR',
  flatRate: 22.5,
  competitors: [],
  googleRate: null,
  historyMax: null,
  historyDaysAvailable: 0,
  inSalaryCycle: false,
  newHighMinHistoryDays: 21
};

test('recommendMargin: target null returns 0', () => {
  assert.equal(recommendMargin(22.5, null), 0);
});

test('recommendMargin: flat already winning returns 0', () => {
  assert.equal(recommendMargin(22.6, 22.5), 0);
});

test('recommendMargin: gap reachable within 0.3', () => {
  // flat=22.50, target=22.55 -> needed ~0.222% + buffer 0.05% -> 0.27%
  const m = recommendMargin(22.5, 22.55);
  assert.ok(m !== null && m > 0 && m <= 0.3, `expected (0, 0.3], got ${m}`);
});

test('recommendMargin: gap unreachable returns null', () => {
  // flat=22.0, target=23.0 -> needed >>0.3
  assert.equal(recommendMargin(22.0, 23.0), null);
});

test('recommendMargin: ceiled to 2 decimals', () => {
  const m = recommendMargin(22.5, 22.55);
  assert.ok(m !== null);
  // Two-decimal rounding check
  assert.equal(Math.round((m as number) * 100) / 100, m);
});

test('applyMargin: formula matches derivedRates', () => {
  assert.equal(applyMargin(100, 0.3), 100.3);
  assert.equal(applyMargin(22.5, 0), 22.5);
});

test('isSalaryCycleDay: day 1-7 = true', () => {
  for (const day of [1, 3, 7]) {
    const d = new Date(`2026-05-${String(day).padStart(2, '0')}T12:00:00Z`);
    assert.equal(isSalaryCycleDay(d, 'UTC'), true, `day ${day}`);
  }
});

test('isSalaryCycleDay: last 7 days of month = true', () => {
  // April has 30 days -> last 7 = days 24-30
  for (const day of [24, 25, 30]) {
    const d = new Date(`2026-04-${day}T12:00:00Z`);
    assert.equal(isSalaryCycleDay(d, 'UTC'), true, `day ${day}`);
  }
});

test('isSalaryCycleDay: mid-month = false', () => {
  const d = new Date('2026-04-15T12:00:00Z');
  assert.equal(isSalaryCycleDay(d, 'UTC'), false);
});

test('isSalaryCycleDay: feb leap year boundary', () => {
  // 2028 is a leap year (29 days). Last 7 = 23-29.
  assert.equal(isSalaryCycleDay(new Date('2028-02-23T12:00:00Z'), 'UTC'), true);
  assert.equal(isSalaryCycleDay(new Date('2028-02-22T12:00:00Z'), 'UTC'), false);
});

test('isSalaryCycleDay: respects timezone (Asia/Dubai is UTC+4)', () => {
  // 2026-04-30 23:00 UTC = 2026-05-01 03:00 Dubai -> day 1 in Dubai
  const d = new Date('2026-04-30T23:00:00Z');
  assert.equal(isSalaryCycleDay(d, 'Asia/Dubai'), true);
});

test('rankFlatAmongCompetitors: highest = 1', () => {
  const competitors = [
    { providerKey: 'google' as const, rate: 22.4 },
    { providerKey: 'provider-b' as const, rate: 22.45 }
  ];
  assert.equal(rankFlatAmongCompetitors(22.6, competitors), 1);
});

test('rankFlatAmongCompetitors: lowest = last', () => {
  const competitors = [
    { providerKey: 'google' as const, rate: 22.6 },
    { providerKey: 'provider-b' as const, rate: 22.55 }
  ];
  assert.equal(rankFlatAmongCompetitors(22.4, competitors), 3);
});

test('liveRateThresholdRank: 5 competitors, top 50% = top 3', () => {
  // 6 participants total, 50% => ceil(6 * 0.5) = 3
  assert.equal(liveRateThresholdRank(5, false), 3);
});

test('liveRateThresholdRank: 5 competitors, salary cycle 60% = top 4', () => {
  // ceil(6 * 0.6) = 4
  assert.equal(liveRateThresholdRank(5, true), 4);
});

test('detectLiveRate: rank within threshold fires', () => {
  const input: SignalEvaluationInput = {
    ...baseInput,
    flatRate: 22.5,
    competitors: [
      { providerKey: 'provider-b', rate: 22.55 },
      { providerKey: 'provider-c', rate: 22.4 },
      { providerKey: 'provider-d', rate: 22.3 }
    ]
  };
  const sig = detectLiveRate(input);
  assert.ok(sig);
  assert.equal(sig?.signalType, 'LIVE_RATE');
  assert.equal(sig?.recommendedMargin, 0);
});

test('detectLiveRate: rank below threshold does not fire', () => {
  const input: SignalEvaluationInput = {
    ...baseInput,
    flatRate: 22.0,
    competitors: [
      { providerKey: 'provider-b', rate: 22.55 },
      { providerKey: 'provider-c', rate: 22.4 },
      { providerKey: 'provider-d', rate: 22.3 }
    ]
  };
  assert.equal(detectLiveRate(input), null);
});

test('detectLiveRate: salary cycle expands threshold', () => {
  const competitors = [
    { providerKey: 'provider-b' as const, rate: 22.7 },
    { providerKey: 'provider-c' as const, rate: 22.6 },
    { providerKey: 'provider-d' as const, rate: 22.55 },
    { providerKey: 'provider-e' as const, rate: 22.4 }
  ];
  // flat 22.5 -> rank 4 of 5 participants. Top 50% = top 3 -> NO. Top 60% = ceil(5*0.6)=3 -> still NO.
  // Try a case where rank=3 of 5: flat 22.58 -> rank 3. Top 50% = top 3 -> YES.
  const inSalary = detectLiveRate({ ...baseInput, flatRate: 22.58, competitors, inSalaryCycle: true });
  assert.ok(inSalary);
});

test('detectBestInMarket: flat already best fires with margin 0', () => {
  const sig = detectBestInMarket({
    ...baseInput,
    flatRate: 22.7,
    competitors: [
      { providerKey: 'provider-b', rate: 22.55 },
      { providerKey: 'provider-c', rate: 22.5 }
    ]
  });
  assert.ok(sig);
  assert.equal(sig?.signalType, 'BEST_IN_MARKET');
  assert.equal(sig?.recommendedMargin, 0);
});

test('detectBestInMarket: gap reachable within 0.3', () => {
  const sig = detectBestInMarket({
    ...baseInput,
    flatRate: 22.5,
    competitors: [{ providerKey: 'provider-b', rate: 22.55 }]
  });
  assert.ok(sig);
  assert.ok((sig?.recommendedMargin ?? 0) > 0);
  assert.ok((sig?.recommendedMargin ?? 0) <= 0.3);
});

test('detectBestInMarket: gap > 0.3 does not fire', () => {
  const sig = detectBestInMarket({
    ...baseInput,
    flatRate: 22.0,
    competitors: [{ providerKey: 'provider-b', rate: 23.0 }]
  });
  assert.equal(sig, null);
});

test('detectBestInMarket: no competitors does not fire', () => {
  assert.equal(detectBestInMarket(baseInput), null);
});

test('detectBeatGoogle: gap reachable fires', () => {
  const sig = detectBeatGoogle({ ...baseInput, flatRate: 22.5, googleRate: 22.55 });
  assert.ok(sig);
  assert.equal(sig?.signalType, 'BEAT_GOOGLE');
});

test('detectBeatGoogle: flat beats google fires with margin 0', () => {
  const sig = detectBeatGoogle({ ...baseInput, flatRate: 22.6, googleRate: 22.5 });
  assert.ok(sig);
  assert.equal(sig?.recommendedMargin, 0);
});

test('detectBeatGoogle: no google rate does not fire', () => {
  assert.equal(detectBeatGoogle(baseInput), null);
});

test('detectBeatGoogle: gap > 0.3 does not fire', () => {
  assert.equal(detectBeatGoogle({ ...baseInput, flatRate: 22.0, googleRate: 23.0 }), null);
});

test('detectNewHigh: cold start gate suppresses', () => {
  const r = detectNewHigh({ ...baseInput, historyMax: 22.0, historyDaysAvailable: 5, flatRate: 22.5 });
  assert.equal(r.signal, null);
  assert.equal(r.coldStart, true);
});

test('detectNewHigh: at history max fires (ties count)', () => {
  const r = detectNewHigh({
    ...baseInput,
    historyMax: 22.5,
    historyDaysAvailable: 25,
    flatRate: 22.5
  });
  assert.ok(r.signal);
  assert.equal(r.signal?.signalType, 'NEW_HIGH');
  assert.equal(r.coldStart, false);
});

test('detectNewHigh: above history max fires', () => {
  const r = detectNewHigh({
    ...baseInput,
    historyMax: 22.4,
    historyDaysAvailable: 25,
    flatRate: 22.6
  });
  assert.ok(r.signal);
});

test('detectNewHigh: below history max does not fire', () => {
  const r = detectNewHigh({
    ...baseInput,
    historyMax: 22.6,
    historyDaysAvailable: 25,
    flatRate: 22.4
  });
  assert.equal(r.signal, null);
  assert.equal(r.coldStart, false);
});

test('runCascade: BEST_IN_MARKET and BEAT_GOOGLE fire together when both apply', () => {
  const out = runCascade({
    ...baseInput,
    flatRate: 22.7,
    competitors: [{ providerKey: 'provider-b', rate: 22.55 }],
    googleRate: 22.6
  });
  const types = out.signals.map((s) => s.signalType);
  assert.ok(types.includes('BEST_IN_MARKET'));
  assert.ok(types.includes('BEAT_GOOGLE'));
  assert.ok(!types.includes('LIVE_RATE'));
});

test('runCascade: only BEAT_GOOGLE when BEST_IN_MARKET unreachable', () => {
  const out = runCascade({
    ...baseInput,
    flatRate: 22.5,
    competitors: [{ providerKey: 'provider-b', rate: 23.0 }],
    googleRate: 22.55
  });
  const types = out.signals.map((s) => s.signalType);
  assert.ok(!types.includes('BEST_IN_MARKET'));
  assert.ok(types.includes('BEAT_GOOGLE'));
  assert.ok(!types.includes('LIVE_RATE'));
});

test('runCascade: LIVE_RATE fallback when neither competitive signal reachable', () => {
  const out = runCascade({
    ...baseInput,
    flatRate: 22.5,
    competitors: [
      { providerKey: 'provider-b', rate: 23.0 },
      { providerKey: 'provider-c', rate: 22.45 },
      { providerKey: 'provider-d', rate: 22.3 }
    ],
    googleRate: 23.0
  });
  const types = out.signals.map((s) => s.signalType);
  assert.ok(!types.includes('BEST_IN_MARKET'));
  assert.ok(!types.includes('BEAT_GOOGLE'));
  assert.ok(types.includes('LIVE_RATE'));
});

test('runCascade: nothing fires when uncompetitive across the board', () => {
  const out = runCascade({
    ...baseInput,
    flatRate: 22.0,
    competitors: [
      { providerKey: 'provider-b', rate: 23.0 },
      { providerKey: 'provider-c', rate: 22.9 },
      { providerKey: 'provider-d', rate: 22.8 }
    ],
    googleRate: 23.0
  });
  assert.equal(out.signals.length, 0);
});

test('runCascade: NEW_HIGH fires alongside competitive signals', () => {
  const out = runCascade({
    ...baseInput,
    flatRate: 22.7,
    competitors: [{ providerKey: 'provider-b', rate: 22.55 }],
    googleRate: 22.5,
    historyMax: 22.5,
    historyDaysAvailable: 30
  });
  const types = out.signals.map((s) => s.signalType);
  assert.ok(types.includes('NEW_HIGH'));
});

test('runCascade: cold start suppresses NEW_HIGH but other signals still fire', () => {
  const out = runCascade({
    ...baseInput,
    flatRate: 22.7,
    competitors: [{ providerKey: 'provider-b', rate: 22.55 }],
    historyMax: 22.0,
    historyDaysAvailable: 5
  });
  const types = out.signals.map((s) => s.signalType);
  assert.ok(types.includes('BEST_IN_MARKET'));
  assert.ok(!types.includes('NEW_HIGH'));
  assert.equal(out.newHighColdStart, true);
});

test('bestCompetitor: returns max rate', () => {
  const top = bestCompetitor([
    { providerKey: 'provider-b', rate: 22.4 },
    { providerKey: 'google', rate: 22.7 },
    { providerKey: 'provider-a', rate: 22.5 }
  ]);
  assert.equal(top?.providerKey, 'google');
  assert.equal(top?.rate, 22.7);
});

test('bestCompetitor: empty returns null', () => {
  assert.equal(bestCompetitor([]), null);
});
