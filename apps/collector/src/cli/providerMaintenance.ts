import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { isSupportedCurrency, type SupportedCurrency } from '@rate-monitor/shared';
import { collectorConfig } from '../config.js';
import { StagehandDiscoveryService } from '../stagehandDiscoveryService.js';

type Command = 'discover' | 'repair';

interface CliOptions {
  command: Command;
  providerKey: string;
  sourceUrl?: string;
  sampleQuoteCurrency?: SupportedCurrency;
  write: boolean;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const app = Fastify({
    logger: {
      level: collectorConfig.logLevel
    }
  });

  try {
    const service = new StagehandDiscoveryService(app.log);
    const report = await service.run({
      providerKey: options.providerKey,
      mode: options.command === 'discover' ? 'stagehand_discovery' : 'stagehand_repair',
      sourceUrl: options.sourceUrl,
      sampleQuoteCurrency: options.sampleQuoteCurrency,
      write: options.write
    });

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await app.close();
  }
}

export function parseArgs(args: string[]): CliOptions {
  const [commandArg, ...rest] = args;
  if (commandArg !== 'discover' && commandArg !== 'repair') {
    throw new Error('Usage: tsx src/cli/providerMaintenance.ts <discover|repair> --provider <provider-key> [--source-url <url>] [--currency <currency>] [--write]');
  }

  const options: Partial<CliOptions> = {
    command: commandArg,
    write: false
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    switch (arg) {
      case '--provider':
        options.providerKey = rest[index + 1];
        index += 1;
        break;
      case '--source-url':
        options.sourceUrl = rest[index + 1];
        index += 1;
        break;
      case '--currency': {
        const nextCurrency = (rest[index + 1] ?? '').toUpperCase();
        if (!isSupportedCurrency(nextCurrency)) {
          throw new Error(`Unsupported currency: ${rest[index + 1] ?? ''}`);
        }
        options.sampleQuoteCurrency = nextCurrency;
        index += 1;
        break;
      }
      case '--write':
        options.write = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.providerKey) {
    throw new Error('Missing required --provider <provider-key> argument.');
  }

  return options as CliOptions;
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
