import { validateRate } from './validation.js';
import type { ParserInput, ParserResult } from './types.js';

export function parseProviderARate(input: ParserInput): ParserResult | null {
  const normalized = input.text.replace(/\s+/g, ' ').trim();
  const patterns = [
    new RegExp(`1\\s*${input.baseCurrency}\\s*=\\s*([0-9]+(?:\\.[0-9]+)?)\\s*${input.quoteCurrency}`, 'i'),
    new RegExp(`1\\s*${input.baseCurrency}\\s+([0-9]+(?:\\.[0-9]+)?)\\s*${input.quoteCurrency}`, 'i')
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
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

  const line = normalized
    .split(/\n+/)
    .map((entry) => entry.trim())
    .find((entry) => entry.toUpperCase().includes(input.quoteCurrency) && entry.toUpperCase().includes(input.baseCurrency));

  if (!line) {
    return null;
  }

  const fallbackMatch = line.match(/([0-9]+(?:\.[0-9]+)?)/);
  if (!fallbackMatch) {
    return null;
  }

  const rate = Number.parseFloat(fallbackMatch[1]);
  if (!validateRate(rate, input.bounds)) {
    return null;
  }

  return {
    rate,
    evidence: line,
    parserPath: 'fallback'
  };
}
