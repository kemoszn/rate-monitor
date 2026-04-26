import type { SupportedCurrency } from '@rate-monitor/shared';
import { validateRate } from './validation.js';
import type { ParserInput, ParserResult } from './types.js';

const NUMBER_PATTERN = /\b(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\b/g;

const CURRENCY_ALIASES: Record<SupportedCurrency, string[]> = {
  INR: ['INR', 'Indian Rupee'],
  PKR: ['PKR', 'Pakistani Rupee'],
  NPR: ['NPR', 'Nepalese Rupee', 'Nepali Rupee']
};

export function parseProviderBRate(input: ParserInput): ParserResult | null {
  const normalized = normalizeWhitespace(input.text);
  const primary = parsePrimary(normalized, input);
  if (primary) {
    return primary;
  }

  const explicitAmounts = parseExplicitAmounts(normalized, input);
  if (explicitAmounts) {
    return explicitAmounts;
  }

  return parseReceiverField(normalized, input);
}

function parsePrimary(text: string, input: ParserInput): ParserResult | null {
  const aliases = CURRENCY_ALIASES[input.quoteCurrency];
  const patterns = aliases.flatMap((alias) => [
    new RegExp(`1\\s*${input.baseCurrency}[^0-9]{0,20}([0-9]+(?:\\.[0-9]+)?)\\s*${escapeRegExp(alias)}`, 'i'),
    new RegExp(`([0-9]+(?:\\.[0-9]+)?)\\s*${escapeRegExp(alias)}[^0-9]{0,20}1\\s*${input.baseCurrency}`, 'i')
  ]);

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }

    const rate = Number.parseFloat(match[1]);
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

function parseReceiverField(text: string, input: ParserInput): ParserResult | null {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const aliases = CURRENCY_ALIASES[input.quoteCurrency].map((alias) => alias.toLowerCase());

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const lower = line.toLowerCase();
    if (!aliases.some((alias) => lower.includes(alias))) {
      continue;
    }

    const nearbyLines = [lines[index - 2], lines[index - 1], line, lines[index + 1], lines[index + 2]].filter(Boolean);
    const nearby = nearbyLines.join(' ');
    const ratioResult = parseRatioFromNearbyContext(nearby, input);
    if (ratioResult) {
      return ratioResult;
    }

    const matches = [...nearby.matchAll(NUMBER_PATTERN)];
    for (const match of matches) {
      const rate = toNumber(match[0]);
      if (validateRate(rate, input.bounds)) {
        return {
          rate,
          evidence: nearby,
          parserPath: 'fallback'
        };
      }
    }
  }

  return null;
}

function parseExplicitAmounts(text: string, input: ParserInput): ParserResult | null {
  const aliases = CURRENCY_ALIASES[input.quoteCurrency];
  const patterns = aliases.flatMap((alias) => [
    new RegExp(
      `([0-9][0-9,]*(?:\\.[0-9]+)?)\\s*${input.baseCurrency}[\\s\\S]{0,80}?([0-9][0-9,]*(?:\\.[0-9]+)?)\\s*${escapeRegExp(alias)}`,
      'i'
    ),
    new RegExp(
      `amount\\s*you\\s*will\\s*send[\\s\\S]{0,80}?([0-9][0-9,]*(?:\\.[0-9]+)?)\\s*${input.baseCurrency}[\\s\\S]{0,120}?rec(?:ie)?ver\\s*will\\s*get[\\s\\S]{0,80}?([0-9][0-9,]*(?:\\.[0-9]+)?)\\s*${escapeRegExp(alias)}`,
      'i'
    )
  ]);

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }

    const result = buildRatioResult(toNumber(match[1]), toNumber(match[2]), match[0], 'primary', input);
    if (result) {
      return result;
    }
  }

  return null;
}

function parseRatioFromNearbyContext(text: string, input: ParserInput): ParserResult | null {
  const values = [...text.matchAll(NUMBER_PATTERN)].map((match) => toNumber(match[0])).filter((value) => Number.isFinite(value));
  if (values.length < 2) {
    return null;
  }

  for (let index = 0; index < values.length - 1; index += 1) {
    const sendAmount = values[index]!;
    const receiveAmount = values[index + 1]!;
    const result = buildRatioResult(sendAmount, receiveAmount, text, 'fallback', input);
    if (result) {
      return result;
    }
  }

  return null;
}

function buildRatioResult(
  sendAmount: number,
  receiveAmount: number,
  evidence: string,
  parserPath: ParserResult['parserPath'],
  input: ParserInput
): ParserResult | null {
  if (!(sendAmount > 0) || !(receiveAmount > 0)) {
    return null;
  }

  const rate = receiveAmount / sendAmount;
  if (!validateRate(rate, input.bounds)) {
    return null;
  }

  return {
    rate: Number.parseFloat(rate.toFixed(6)),
    evidence,
    parserPath
  };
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\r/g, '').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toNumber(raw: string): number {
  return Number.parseFloat(raw.replaceAll(',', ''));
}
