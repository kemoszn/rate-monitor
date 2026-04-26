import type { ProviderParserKey } from '@rate-monitor/shared';
import { parseProviderARate } from './parserA.js';
import { parseProviderBRate } from './parserB.js';
import { parseProviderD } from './parserD.js';
import { parseProviderE } from './parserE.js';
import { parseProviderC } from './parserC.js';
import type { ParserInput, ParserResult } from './types.js';

type ProviderParser = (input: ParserInput) => ParserResult | null;

const parserRegistry: Record<ProviderParserKey, ProviderParser> = {
  'provider-a-rate': parseProviderARate,
  'provider-b-rate': parseProviderBRate,
  'provider-d-rate': parseProviderD,
  'provider-e-rate': parseProviderE,
  'provider-c-rate': parseProviderC
};

export function resolveProviderParser(parserKey: ProviderParserKey): ProviderParser {
  return parserRegistry[parserKey];
}
