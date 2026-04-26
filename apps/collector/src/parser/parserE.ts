import type { SupportedCurrency } from '@rate-monitor/shared';
import { validateRate } from './validation.js';
import type { ParserInput, ParserResult } from './types.js';

const CURRENCY_ALIASES: Record<SupportedCurrency, string[]> = {
  INR: ['INR', 'India'],
  PKR: ['PKR', 'Pakistan'],
  NPR: ['NPR', 'Nepal']
};

const NUMBER_PATTERN = /\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/g;

export function parseProviderE(input: ParserInput): ParserResult | null {
  const normalized = normalizeWhitespace(input.text);
  const primary = parseExchangeRateLine(normalized, input);
  if (primary) {
    return primary;
  }

  return parseFallback(normalized, input);
}

function parseExchangeRateLine(text: string, input: ParserInput): ParserResult | null {
  const aliases = CURRENCY_ALIASES[input.quoteCurrency];
  const patterns = aliases.flatMap((alias) => [
    new RegExp(`AED\\s*1\\s*=\\s*${escapeRegExp(alias)}\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)`, 'i'),
    new RegExp(`AED\\s*1\\s*=\\s*${escapeRegExp(input.quoteCurrency)}\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)`, 'i'),
    new RegExp(`AED\\s*1\\s*=\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)\\s*${escapeRegExp(alias)}`, 'i')
  ]);

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }

    const rate = toNumber(match[1]);
    if (!validateRate(rate, input.bounds)) {
      continue;
    }

    return {
      rate,
      evidence: match[0],
      parserPath: 'primary'
    };
  }

  return null;
}

function parseFallback(text: string, input: ParserInput): ParserResult | null {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const aliases = CURRENCY_ALIASES[input.quoteCurrency].map((alias) => alias.toLowerCase());

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const lower = line.toLowerCase();
    if (!lower.includes('exchange rate') && !aliases.some((alias) => lower.includes(alias))) {
      continue;
    }

    const nearby = [lines[index - 1], line, lines[index + 1]].filter(Boolean).join(' ');
    const values = [...nearby.matchAll(NUMBER_PATTERN)].map((match) => toNumber(match[0]));
    const rate = values.find((value) => validateRate(value, input.bounds));
    if (!rate) {
      continue;
    }

    return {
      rate,
      evidence: nearby,
      parserPath: 'fallback'
    };
  }

  return null;
}

function toNumber(raw: string): number {
  return Number.parseFloat(raw.replaceAll(',', ''));
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\r/g, '').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
