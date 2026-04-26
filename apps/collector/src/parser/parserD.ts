import { validateRate } from './validation.js';
import type { ParserInput, ParserResult } from './types.js';

const NUMBER_PATTERN = /\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/g;

export function parseProviderD(input: ParserInput): ParserResult | null {
  const normalized = normalizeWhitespace(input.text);
  const primary = parseExplicitEquation(normalized, input);
  if (primary) {
    return primary;
  }

  return parseFromNearbySendReceiveFields(normalized, input);
}

function parseExplicitEquation(text: string, input: ParserInput): ParserResult | null {
  const patterns = [
    new RegExp(
      `([0-9][0-9,]*(?:\\.[0-9]+)?)\\s*${input.baseCurrency}\\s*=\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)\\s*${input.quoteCurrency}`,
      'i'
    ),
    new RegExp(
      `send\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)\\s*${input.baseCurrency}[^\\n]*received\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)\\s*${input.quoteCurrency}`,
      'i'
    )
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }

    const sendAmount = toNumber(match[1]);
    const receiveAmount = toNumber(match[2]);
    const result = buildResult(sendAmount, receiveAmount, match[0], 'primary', input);
    if (result) {
      return result;
    }
  }

  return null;
}

function parseFromNearbySendReceiveFields(text: string, input: ParserInput): ParserResult | null {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!/received/i.test(line) && !new RegExp(`\\b${input.quoteCurrency}\\b`, 'i').test(line)) {
      continue;
    }

    const nearby = [lines[index - 2], lines[index - 1], line, lines[index + 1], lines[index + 2]].filter(Boolean).join(' ');
    const values = [...nearby.matchAll(NUMBER_PATTERN)].map((match) => toNumber(match[0])).filter((value) => Number.isFinite(value));
    if (values.length < 2) {
      continue;
    }

    const sendAmount = values.find((value) => value >= 1);
    const receiveAmount = [...values].reverse().find((value) => value > (sendAmount ?? 0));
    if (!sendAmount || !receiveAmount) {
      continue;
    }

    const result = buildResult(sendAmount, receiveAmount, nearby, 'fallback', input);
    if (result) {
      return result;
    }
  }

  return null;
}

function buildResult(
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

function toNumber(raw: string): number {
  return Number.parseFloat(raw.replaceAll(',', ''));
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\r/g, '').trim();
}
