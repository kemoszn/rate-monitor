import type { SupportedCurrency } from '@rate-monitor/shared';
import { validateRate } from './validation.js';
import type { ParserInput, ParserResult } from './types.js';

const CURRENCY_ALIASES: Record<SupportedCurrency, string[]> = {
  INR: ['INR', 'Indian Rupee', 'Rs', 'Rupee'],
  PKR: ['PKR', 'Pakistani Rupee', 'Rs', 'Rupee'],
  NPR: ['NPR', 'Nepalese Rupee', 'Nepali Rupee', 'Rs', 'Rupee']
};

const NUMBER_PATTERN = /\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/g;

export function parseProviderC(input: ParserInput): ParserResult | null {
  const normalized = normalizeWhitespace(input.text);
  const primary = parsePrimary(normalized, input.baseCurrency, input.quoteCurrency, input.bounds);
  if (primary) {
    return primary;
  }

  return parseFallback(normalized, input.quoteCurrency, input.bounds);
}

function parsePrimary(
  text: string,
  baseCurrency: string,
  quoteCurrency: SupportedCurrency,
  bounds: ParserInput['bounds']
): ParserResult | null {
  const patterns = [
    new RegExp(`(?:1\\s*)?${baseCurrency}\\s*(?:=|to|->|:)?\\s*([0-9]+(?:\\.[0-9]+)?)\\s*${quoteCurrency}`, 'i'),
    new RegExp(`${quoteCurrency}\\s*([0-9]+(?:\\.[0-9]+)?)\\s*(?:for|per)?\\s*(?:1\\s*)?${baseCurrency}`, 'i'),
    new RegExp(`rate[^0-9]{0,20}([0-9]+(?:\\.[0-9]+)?)\\s*${quoteCurrency}`, 'i'),
    ...CURRENCY_ALIASES[quoteCurrency].map(
      (alias) => new RegExp(`${escapeRegex(alias)}\\s*([0-9]+(?:\\.[0-9]+)?)\\s*${quoteCurrency}`, 'i')
    )
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }

    const rate = toNumber(match[1]);
    if (!validateRate(rate, bounds)) {
      continue;
    }

    return {
      rate,
      evidence: extractEvidence(text, match[0]),
      parserPath: 'primary'
    };
  }

  return null;
}

function parseFallback(text: string, quoteCurrency: SupportedCurrency, bounds: ParserInput['bounds']): ParserResult | null {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const aliases = CURRENCY_ALIASES[quoteCurrency].map((alias) => alias.toLowerCase());
  const candidateLines = lines.flatMap((line, index) => {
    const lower = line.toLowerCase();
    if (!aliases.some((alias) => lower.includes(alias))) {
      return [] as string[];
    }

    return [line, lines[index - 1] ?? '', lines[index + 1] ?? ''].filter(Boolean);
  });

  const uniqueCandidates = [...new Set(candidateLines)];
  const scored = uniqueCandidates
    .flatMap((line) =>
      extractNumericCandidates(line)
        .filter((rate) => validateRate(rate, bounds))
        .map((rate) => ({ rate, evidence: line, score: scoreCandidate(line, quoteCurrency, rate) }))
    )
    .sort((left, right) => right.score - left.score);

  if (scored.length === 0) {
    return null;
  }

  return {
    rate: scored[0].rate,
    evidence: scored[0].evidence,
    parserPath: 'fallback'
  };
}

function scoreCandidate(line: string, quoteCurrency: SupportedCurrency, rate: number): number {
  let score = 0;
  const lower = line.toLowerCase();

  if (lower.includes(quoteCurrency.toLowerCase())) {
    score += 10;
  }
  if (lower.includes('aed')) {
    score += 6;
  }
  if (line.includes('=')) {
    score += 4;
  }
  if (String(rate).includes('.')) {
    score += 2;
  }

  return score;
}

function extractNumericCandidates(line: string): number[] {
  return [...line.matchAll(NUMBER_PATTERN)]
    .map((match) => toNumber(match[0]))
    .filter((value) => Number.isFinite(value));
}

function toNumber(raw: string): number {
  return Number.parseFloat(raw.replaceAll(',', ''));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\r/g, '').trim();
}

function extractEvidence(text: string, matchText: string): string {
  const index = text.indexOf(matchText);
  if (index === -1) {
    return matchText;
  }

  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + matchText.length + 40);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}
