import fs from 'node:fs/promises';
import path from 'node:path';
import {
  type CollectorExtractionMode,
  type ExchangeHouseProviderDefinition,
  type SupportedCurrency
} from '@rate-monitor/shared';
import type { Action, Page, Stagehand } from '@browserbasehq/stagehand';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import { collectorConfig } from './config.js';
import { createStagehand } from './stagehandFactory.js';
import { withRetry } from './retry.js';
import { findProviderByKey } from './providers/registry.js';

const selectorExtractionSchema = z.object({
  customDropdownOptionSelectorTemplate: z.string().trim().min(1),
  customDropdownTriggerSelectors: z.array(z.string().trim().min(1)).min(1),
  selectedCurrencySelectors: z.array(z.string().trim().min(1)).min(1),
  rateContainerSelectors: z.array(z.string().trim().min(1)).min(1),
  fromSelector: z.string().trim().min(1),
  rateSelector: z.string().trim().min(1),
  toSelector: z.string().trim().min(1),
  labelSelector: z.string().trim().optional().nullable(),
  notes: z.array(z.string().trim().min(1)).default([])
});

export interface StagehandDiscoveryReport {
  mode: CollectorExtractionMode;
  provider: string;
  provider_name: string;
  source_url: string;
  sample_quote_currency: SupportedCurrency;
  generated_at: string;
  observed_actions: string[];
  prompt_steps: string[];
  proposed_patch: {
    deterministic: {
      dom: {
        customDropdownOptionSelectorTemplate: string;
        customDropdownTriggerSelectors: string[];
        selectedCurrencySelectors: string[];
        rateContainerSelectors: string[];
      };
      rateText: {
        fromSelector: string;
        rateSelector: string;
        toSelector: string;
        labelSelector?: string;
      };
    };
  };
  notes: string[];
  output_path?: string;
}

export class StagehandDiscoveryService {
  constructor(private readonly logger: FastifyBaseLogger) {}

  async run(input: {
    providerKey: string;
    mode: 'stagehand_discovery' | 'stagehand_repair';
    sourceUrl?: string;
    sampleQuoteCurrency?: SupportedCurrency;
    write?: boolean;
  }): Promise<StagehandDiscoveryReport> {
    const provider = findProviderByKey(input.providerKey);
    if (!provider) {
      throw new Error(`Unknown provider key: ${input.providerKey}`);
    }

    const quoteCurrency = input.sampleQuoteCurrency ?? provider.supportedQuoteCurrencies[0];
    const stagehand = await createStagehand(collectorConfig);

    try {
      const page = await this.openPage(stagehand, input.sourceUrl ?? provider.sourceUrl);
      const observedActions = await this.observe(stagehand, page, provider, quoteCurrency, input.mode);
      const selectors = await stagehand.extract(
        buildSelectorPrompt(provider, input.mode, quoteCurrency),
        selectorExtractionSchema,
        {
          page,
          timeout: collectorConfig.extraction.timeoutMs
        }
      );

      const report: StagehandDiscoveryReport = {
        mode: input.mode,
        provider: provider.key,
        provider_name: provider.displayName,
        source_url: input.sourceUrl ?? provider.sourceUrl,
        sample_quote_currency: quoteCurrency,
        generated_at: new Date().toISOString(),
        observed_actions: summarizeActions(observedActions),
        prompt_steps: [...(input.mode === 'stagehand_repair' ? provider.stagehand.repairSteps : provider.stagehand.discoverySteps)],
        proposed_patch: {
          deterministic: {
            dom: {
              customDropdownOptionSelectorTemplate: selectors.customDropdownOptionSelectorTemplate,
              customDropdownTriggerSelectors: selectors.customDropdownTriggerSelectors,
              selectedCurrencySelectors: selectors.selectedCurrencySelectors,
              rateContainerSelectors: selectors.rateContainerSelectors
            },
            rateText: {
              fromSelector: selectors.fromSelector,
              rateSelector: selectors.rateSelector,
              toSelector: selectors.toSelector,
              ...(selectors.labelSelector ? { labelSelector: selectors.labelSelector } : {})
            }
          }
        },
        notes: selectors.notes
      };

      if (input.write) {
        report.output_path = await this.writeReport(report, input.mode);
      }

      return report;
    } finally {
      await stagehand.close().catch(() => undefined);
    }
  }

  private async openPage(stagehand: Stagehand, sourceUrl: string): Promise<Page> {
    const page = (stagehand.context.activePage() ?? (await stagehand.context.newPage())) as Page;
    await withRetry(async () => {
      await page.goto(sourceUrl, {
        waitUntil: 'domcontentloaded',
        timeoutMs: collectorConfig.extraction.navigationTimeoutMs
      });
      await page.waitForLoadState('networkidle', collectorConfig.extraction.navigationTimeoutMs).catch(() => undefined);
    }, collectorConfig.extraction.retryAttempts, collectorConfig.extraction.retryBaseDelayMs);
    return page;
  }

  private async observe(
    stagehand: Stagehand,
    page: Page,
    provider: ExchangeHouseProviderDefinition,
    quoteCurrency: SupportedCurrency,
    mode: 'stagehand_discovery' | 'stagehand_repair'
  ): Promise<Action[]> {
    const steps = buildPromptSteps(provider, mode, quoteCurrency);
    try {
      return await stagehand.observe(steps.join(' '), {
        page,
        timeout: Math.min(collectorConfig.extraction.timeoutMs, 15_000)
      });
    } catch (error) {
      this.logger.warn({ provider: provider.key, err: normalizeUnknownError(error) }, 'Stagehand discovery observe failed');
      return [];
    }
  }

  private async writeReport(report: StagehandDiscoveryReport, mode: 'stagehand_discovery' | 'stagehand_repair'): Promise<string> {
    const directory = path.resolve(collectorConfig.stagehand.discoveryArtifactsDir);
    await fs.mkdir(directory, { recursive: true });
    const stamp = report.generated_at.replace(/[:.]/g, '-');
    const filePath = path.join(directory, `${report.provider}-${mode}-${stamp}.json`);
    await fs.writeFile(filePath, JSON.stringify(report, null, 2), 'utf8');
    return filePath;
  }
}

function buildPromptSteps(
  provider: ExchangeHouseProviderDefinition,
  mode: 'stagehand_discovery' | 'stagehand_repair',
  quoteCurrency: SupportedCurrency
): string[] {
  const steps = mode === 'stagehand_repair' ? provider.stagehand.repairSteps : provider.stagehand.discoverySteps;
  return steps.map((step) => step.replaceAll('{{quoteCurrency}}', quoteCurrency));
}

function buildSelectorPrompt(
  provider: ExchangeHouseProviderDefinition,
  mode: 'stagehand_discovery' | 'stagehand_repair',
  quoteCurrency: SupportedCurrency
): string {
  return [
    ...buildPromptSteps(provider, mode, quoteCurrency),
    `Generate deterministic CSS selectors for the ${provider.displayName} Playwright extractor.`,
    'Return selectors only for the live converter used to calculate the AED remittance rate.',
    'Use {{quoteCurrency}} as the placeholder in the destination option selector template.',
    'Prefer ids, data attributes, and semantic classes over nth-child selectors.',
    'Fill the schema fields with CSS selectors that exist on the page right now.'
  ].join(' ');
}

function summarizeActions(actions: Action[]): string[] {
  return actions.slice(0, 10).map((action) => [action.method, action.selector, action.description].filter(Boolean).join(' | '));
}

function normalizeUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === 'string' ? error : 'Unknown error';
}
