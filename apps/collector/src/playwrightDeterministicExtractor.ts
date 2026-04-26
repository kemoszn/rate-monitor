import fs from 'node:fs/promises';
import path from 'node:path';
import {
  isSupportedCurrency,
  type CollectorExtractionMode,
  type ExchangeHouseProviderDefinition,
  type ExtractError,
  type ExtractRequest,
  type ExtractResponse,
  type ExtractResult,
  type FailureReasonCode,
  type SupportedCurrency
} from '@rate-monitor/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { BrowserContext, Page } from 'playwright';
import { collectorConfig } from './config.js';
import type { ExchangeRateExtractor } from './contracts.js';
import { resolveProviderParser } from './parser/registry.js';
import { createPlaywrightBrowser, createPlaywrightContext, humanDelay } from './playwrightFactory.js';
import { withRetry } from './retry.js';

const EXTRACTION_MODE = 'playwright_deterministic' as const satisfies CollectorExtractionMode;

export class PlaywrightDeterministicExtractor implements ExchangeRateExtractor {
  constructor(
    private readonly logger: FastifyBaseLogger,
    private readonly provider: ExchangeHouseProviderDefinition
  ) {}

  async extract(request: ExtractRequest, externalContext?: BrowserContext): Promise<ExtractResponse> {
    const fetchedAt = new Date().toISOString();
    const errors: ExtractError[] = [];
    const results: ExtractResult[] = [];

    if (request.base_currency.toUpperCase() !== this.provider.supportedBaseCurrency) {
      return {
        provider: this.provider.key,
        provider_name: this.provider.displayName,
        extraction_mode: EXTRACTION_MODE,
        results,
        errors: request.currencies.map((currency) =>
          this.buildError(
            currency.toUpperCase(),
            'UNSUPPORTED_BASE_CURRENCY',
            `${this.provider.displayName} currently supports ${this.provider.supportedBaseCurrency} only.`,
            request.source_url,
            fetchedAt
          )
        )
      };
    }

    const normalizedCurrencies = request.currencies.map((currency) => currency.toUpperCase());
    const globallySupportedCurrencies = normalizedCurrencies.filter(isSupportedCurrency);
    const unsupportedCurrencies = normalizedCurrencies.filter((currency) => !isSupportedCurrency(currency));
    const providerUnsupportedCurrencies = globallySupportedCurrencies.filter(
      (currency) => !this.provider.supportedQuoteCurrencies.includes(currency)
    );
    const supportedCurrencies = globallySupportedCurrencies.filter((currency) => this.provider.supportedQuoteCurrencies.includes(currency));

    errors.push(
      ...unsupportedCurrencies.map((currency) =>
        this.buildError(currency, 'UNSUPPORTED_QUOTE_CURRENCY', `Unsupported quote currency: ${currency}.`, request.source_url, fetchedAt)
      ),
      ...providerUnsupportedCurrencies.map((currency) =>
        this.buildError(
          currency,
          'UNSUPPORTED_QUOTE_CURRENCY',
          `${this.provider.displayName} does not currently support quote currency ${currency}.`,
          request.source_url,
          fetchedAt
        )
      )
    );

    if (supportedCurrencies.length === 0) {
      return {
        provider: this.provider.key,
        provider_name: this.provider.displayName,
        extraction_mode: EXTRACTION_MODE,
        results,
        errors
      };
    }

    const ownedBrowser = externalContext ? undefined : await createPlaywrightBrowser(collectorConfig);
    const context = externalContext ?? await createPlaywrightContext(ownedBrowser!);
    const page = await context.newPage();

    try {
      await this.openProviderPage(page, request.source_url);

      for (const quoteCurrency of supportedCurrencies) {
        const attemptLogger = this.logger.child({
          provider: this.provider.key,
          quoteCurrency,
          sourceUrl: request.source_url
        });

        try {
          const result = await this.extractSingleCurrency(page, quoteCurrency, request.source_url, attemptLogger);
          results.push(result);
        } catch (error) {
          const normalized = normalizeError(error);
          attemptLogger.error({ reasonCode: normalized.reasonCode, err: normalized.message }, 'Currency extraction failed');
          errors.push(this.buildError(quoteCurrency, normalized.reasonCode, normalized.message, request.source_url, new Date().toISOString()));
        }
      }
    } finally {
      await page.close().catch(() => undefined);
      if (!externalContext) {
        await context.close().catch(() => undefined);
        await ownedBrowser?.close().catch(() => undefined);
      }
    }

    return {
      provider: this.provider.key,
      provider_name: this.provider.displayName,
      extraction_mode: EXTRACTION_MODE,
      results,
      errors
    };
  }

  private async openProviderPage(page: Page, sourceUrl: string): Promise<void> {
    await withRetry(async () => {
      await humanDelay();
      await page.goto(sourceUrl, {
        waitUntil: 'domcontentloaded',
        timeout: collectorConfig.extraction.navigationTimeoutMs
      });
      await page.waitForLoadState('networkidle', { timeout: collectorConfig.extraction.navigationTimeoutMs }).catch(() => undefined);
      await this.prepareProviderPage(page);
    }, collectorConfig.extraction.retryAttempts, collectorConfig.extraction.retryBaseDelayMs);
  }

  private async extractSingleCurrency(
    page: Page,
    quoteCurrency: SupportedCurrency,
    sourceUrl: string,
    logger: FastifyBaseLogger
  ): Promise<ExtractResult> {
    await withTimeout(
      withRetry(async () => {
        await this.prepareProviderPage(page);
        await this.ensureSendAmount(page, logger);
        await this.selectCurrency(page, quoteCurrency, logger);
        await page.waitForTimeout(this.provider.deterministic.dom.selectionSettleDelayMs ?? 1_500);
      }, collectorConfig.extraction.retryAttempts, collectorConfig.extraction.retryBaseDelayMs),
      collectorConfig.extraction.timeoutMs,
      'Timed out while preparing the converter and selecting quote currency.'
    );

    const pageText = await this.collectPageText(page, quoteCurrency);
    const parsed = resolveProviderParser(this.provider.parserKey)({
      text: pageText,
      baseCurrency: this.provider.supportedBaseCurrency,
      quoteCurrency,
      bounds: this.provider.bounds[quoteCurrency]
    });

    if (!parsed) {
      await this.writeDebugArtifacts(page, quoteCurrency, pageText, null, new Date().toISOString()).catch(() => undefined);
      throw createFailure(
        'PARSE_FAILED',
        `Unable to parse ${quoteCurrency} rate from the visible ${this.provider.displayName} converter text.`
      );
    }

    const fetchedAt = new Date().toISOString();
    await this.writeDebugArtifacts(page, quoteCurrency, pageText, parsed, fetchedAt).catch(() => undefined);

    logger.info(
      {
        provider: this.provider.key,
        selectedCurrency: quoteCurrency,
        parserPath: parsed.parserPath
      },
      'Currency extracted'
    );

    return {
      provider: this.provider.key,
      provider_name: this.provider.displayName,
      quote_currency: quoteCurrency,
      rate: parsed.rate,
      evidence: parsed.evidence,
      evidence_text: parsed.evidence,
      evidence_value: parsed.rate,
      fetched_at: fetchedAt,
      source_url: sourceUrl,
      parser_path: parsed.parserPath,
      extraction_mode: EXTRACTION_MODE
    };
  }

  private async ensureSendAmount(page: Page, logger: FastifyBaseLogger): Promise<void> {
    const sendAmountSelectors = this.provider.deterministic.dom.sendAmountInputSelectors ?? [];
    const amountUpdatedBySelector = await this.setInputValue(page, sendAmountSelectors, '1');
    if (amountUpdatedBySelector) {
      logger.info({ provider: this.provider.key, strategy: 'configured-send-amount' }, 'Send amount set to 1');
      return;
    }

    const sendAmountLabels = this.provider.deterministic.dom.sendAmountLabelPatterns ?? [];
    if (sendAmountLabels.length === 0) {
      return;
    }

    const updatedByHeuristic = await page.evaluate(
      ({ labels }) => {
        const labelSet = labels.map((label) => label.toUpperCase());
        const candidates = Array.from(document.querySelectorAll('body *')).filter((node) =>
          labelSet.includes(((node as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim().toUpperCase())
        );

        for (const candidate of candidates) {
          const element = candidate as HTMLElement;
          const container = [element.closest('label'), element.closest('div'), element.parentElement].filter(Boolean) as HTMLElement[];
          for (const scope of container) {
            const input = scope.querySelector('input:not([type="hidden"]), textarea');
            if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
              const style = window.getComputedStyle(input);
              if (style.visibility === 'hidden' || style.display === 'none') {
                continue;
              }

              input.focus();
              input.value = '';
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.value = '1';
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            }
          }
        }

        return false;
      },
      { labels: sendAmountLabels }
    );

    if (updatedByHeuristic) {
      logger.info({ provider: this.provider.key, strategy: 'labeled-send-amount' }, 'Send amount set to 1');
    }
  }

  private async prepareProviderPage(page: Page): Promise<void> {
    if (this.provider.key === 'provider-c') {
      await this.prepareProviderCPage(page);
      return;
    }

    if (this.provider.key === 'provider-b') {
      await this.prepareProviderBPage(page);
    }
  }

  private async prepareProviderCPage(page: Page): Promise<void> {
    const targetCountry = (process.env.EXTRACTION_TARGET_COUNTRY ?? 'TARGET').toUpperCase();
    const overlayHandled = await page.evaluate((target: string) => {
      const countryWrapper = document.querySelector('.countrDrop.country-wrapper');

      if (countryWrapper instanceof HTMLElement) {
        const rawCurrent = countryWrapper.querySelector('.currentflg p')?.textContent ?? '';
        const currentCountry = rawCurrent.replace(/\s+/g, ' ').trim().toUpperCase();
        if (currentCountry !== target) {
          const options = Array.from(countryWrapper.querySelectorAll('a.dropdown-item, button, li, span, div'));
          for (const option of options) {
            if (!(option instanceof HTMLElement)) {
              continue;
            }

            const text = (option.innerText ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
            const dataCountry = (option.getAttribute('data-country') ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
            if (text === target || dataCountry === target) {
              option.click();
              document.body.setAttribute('data-country', target.toLowerCase());
              return true;
            }
          }
        }
      }

      document.body.setAttribute('data-country', target.toLowerCase());
      return false;
    }, targetCountry);

    if (overlayHandled) {
      await humanDelay();
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
    }
  }

  private async prepareProviderBPage(page: Page): Promise<void> {
    const transferRateEnabled = await page.evaluate(() => {
      const radio = document.querySelector('#test2');
      if (!(radio instanceof HTMLInputElement) || radio.checked) {
        return false;
      }

      radio.click();
      radio.dispatchEvent(new Event('input', { bubbles: true }));
      radio.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    });

    if (transferRateEnabled) {
      await humanDelay();
      await page.waitForTimeout(500);
    }
  }

  private async selectCurrency(page: Page, quoteCurrency: SupportedCurrency, logger: FastifyBaseLogger): Promise<void> {
    if (this.provider.key === 'provider-c') {
      logger.info({ selectedCurrency: quoteCurrency, strategy: 'static-homepage-rates' }, 'Destination currency selection skipped');
      return;
    }

    const selectionTokens = buildSelectionTokens(
      quoteCurrency,
      this.provider.deterministic.dom.selectionMatchAliasesByCurrency?.[quoteCurrency] ?? []
    );

    if (await this.isDestinationCurrencySelected(page, quoteCurrency)) {
      logger.info({ selectedCurrency: quoteCurrency, strategy: 'already-selected' }, 'Destination currency already selected');
      return;
    }

    const changedNative = await page.evaluate(({ selectionTokens: nextSelectionTokens }) => {
      const options = Array.from(document.querySelectorAll('select'));
      for (const select of options) {
        const htmlSelect = select as HTMLSelectElement;
        const option = Array.from(htmlSelect.options).find(
          (entry) =>
            nextSelectionTokens.some((token) => {
              const normalizedToken = token.toUpperCase();
              return (
                entry.textContent?.toUpperCase().includes(normalizedToken) || entry.value.toUpperCase().includes(normalizedToken)
              );
            })
        );
        if (!option) {
          continue;
        }

        htmlSelect.value = option.value;
        htmlSelect.dispatchEvent(new Event('input', { bubbles: true }));
        htmlSelect.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }

      return false;
    }, { selectionTokens });

    if (changedNative) {
      await page.waitForTimeout(750);
      if (await this.isDestinationCurrencySelected(page, quoteCurrency)) {
        logger.info({ selectedCurrency: quoteCurrency, strategy: 'native-select' }, 'Destination currency selected');
        return;
      }
    }

    const changedByLabeledField = await page.evaluate(
      ({
        quoteCurrency: nextQuoteCurrency,
        selectionTokens: nextSelectionTokens,
        receiveFieldLabelPatterns
      }: {
        quoteCurrency: string;
        selectionTokens: string[];
        receiveFieldLabelPatterns: string[];
      }) => {
        const labels = receiveFieldLabelPatterns.map((label) => label.toUpperCase());
        const candidates = Array.from(document.querySelectorAll('body *')).filter((node) =>
          labels.includes(((node as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim().toUpperCase())
        );

        for (const candidate of candidates) {
          const element = candidate as HTMLElement;
          const scopes = [element.closest('label'), element.closest('div'), element.parentElement, document.body].filter(Boolean) as ParentNode[];
          for (const scope of scopes) {
            const select = scope.querySelector('select');
            if (select instanceof HTMLSelectElement) {
              const option = Array.from(select.options).find((entry) => {
                const text = (entry.textContent ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
                const value = (entry.value ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
                return nextSelectionTokens.some((token) => {
                  const normalizedToken = token.toUpperCase();
                  return text.includes(normalizedToken) || value.includes(normalizedToken);
                });
              });
              if (option) {
                select.value = option.value;
                select.dispatchEvent(new Event('input', { bubbles: true }));
                select.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
              }
            }

            const triggers = Array.from(scope.querySelectorAll('[role="combobox"], button[aria-haspopup="listbox"], button, [tabindex]'));
            for (const trigger of triggers) {
              if (!(trigger instanceof HTMLElement)) {
                continue;
              }

              trigger.click();
              const options = Array.from(document.querySelectorAll('[role="option"], option, li, button, [data-value], [data-code]'));
              for (const option of options) {
                const text = (option.textContent ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
                const value = (option.getAttribute('value') ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
                const dataValue = (option.getAttribute('data-value') ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
                const dataCode = (option.getAttribute('data-code') ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
                if (
                  nextSelectionTokens.some((token) => {
                    const normalizedToken = token.toUpperCase();
                    return [text, value, dataValue, dataCode].some((entry) => entry.includes(normalizedToken));
                  })
                ) {
                  if (option instanceof HTMLElement) {
                    option.click();
                    return true;
                  }
                }
              }
            }
          }
        }

        const options = Array.from(document.querySelectorAll('[role="option"], option, li, button, [data-value], [data-code]'));
        for (const option of options) {
          const text = (option.textContent ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
          const value = (option.getAttribute('value') ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
          const dataValue = (option.getAttribute('data-value') ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
          const dataCode = (option.getAttribute('data-code') ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
          if (
            nextSelectionTokens.some((token) => {
              const normalizedToken = token.toUpperCase();
              return [text, value, dataValue, dataCode].some((entry) => entry.includes(normalizedToken));
            })
          ) {
            if (option instanceof HTMLElement) {
              option.click();
              return true;
            }
          }
        }

        return false;
      },
      {
        quoteCurrency,
        selectionTokens,
        receiveFieldLabelPatterns: [...(this.provider.deterministic.dom.receiveFieldLabelPatterns ?? [])]
      }
    );

    if (changedByLabeledField) {
      await page.waitForTimeout(750);
      if (await this.isDestinationCurrencySelected(page, quoteCurrency)) {
        logger.info({ selectedCurrency: quoteCurrency, strategy: 'labeled-field' }, 'Destination currency selected');
        return;
      }
    }

    const triggerClicked = await clickFirstVisible(page, this.provider.deterministic.dom.customDropdownTriggerSelectors);
    if (triggerClicked) {
      await page.waitForTimeout(250);
    }

    const optionSelector = this.provider.deterministic.dom.customDropdownOptionSelectorTemplate.replaceAll('{{quoteCurrency}}', quoteCurrency);
    const aliasOptionSelectors = selectionTokens.map((token) => {
      const escapedToken = escapeSelectorString(token);
      return [
        `.dropdown-container .option:has-text("${escapedToken}")`,
        `[role="option"]:has-text("${escapedToken}")`,
        `li:has-text("${escapedToken}")`,
        `button:has-text("${escapedToken}")`
      ];
    });
    const optionClicked = await clickFirstVisible(page, [optionSelector, ...aliasOptionSelectors.flat()]);
    if (!optionClicked) {
      throw createFailure('CURRENCY_SELECTION_FAILED', `Unable to select destination currency ${quoteCurrency}.`);
    }

    await page.waitForTimeout(750);
    if (!(await this.isDestinationCurrencySelected(page, quoteCurrency))) {
      throw createFailure('CURRENCY_SELECTION_FAILED', `Unable to verify destination currency ${quoteCurrency} after DOM selection.`);
    }

    logger.info({ selectedCurrency: quoteCurrency, strategy: 'custom-dropdown' }, 'Destination currency selected');
  }

  private async isDestinationCurrencySelected(page: Page, quoteCurrency: SupportedCurrency): Promise<boolean> {
    const selectionTokens = buildSelectionTokens(
      quoteCurrency,
      this.provider.deterministic.dom.selectionMatchAliasesByCurrency?.[quoteCurrency] ?? []
    );

    return page.evaluate(
      ({
        selectionTokens: nextSelectionTokens,
        selectedCurrencySelectors
      }: {
        selectionTokens: string[];
        selectedCurrencySelectors: string[];
      }) => {
        const selectedMatches = selectedCurrencySelectors.some((selector) => {
          const element = document.querySelector(selector);
          if (!element) {
            return false;
          }

          if (element instanceof HTMLSelectElement) {
            const value = element.value.trim().toUpperCase();
            const selectedText = element.selectedOptions[0]?.textContent?.trim().toUpperCase() ?? '';
            return nextSelectionTokens.some((token) => {
              const normalizedToken = token.toUpperCase();
              return (
                value === normalizedToken ||
                selectedText === normalizedToken ||
                new RegExp(`\\b${normalizedToken}\\b`, 'i').test(selectedText)
              );
            });
          }

          if (element instanceof HTMLInputElement) {
            return nextSelectionTokens.some((token) => element.value.trim().toUpperCase() === token.toUpperCase());
          }

          const text = element.textContent?.trim().toUpperCase() ?? '';
          if (
            nextSelectionTokens.some((token) => {
              const normalizedToken = token.toUpperCase();
              return text === normalizedToken || new RegExp(`\\b${normalizedToken}\\b`, 'i').test(text);
            })
          ) {
            return true;
          }

          return false;
        });

        return selectedMatches;
      },
      {
        selectionTokens,
        selectedCurrencySelectors: [...this.provider.deterministic.dom.selectedCurrencySelectors]
      }
    );
  }

  private async setInputValue(page: Page, selectors: readonly string[], value: string): Promise<boolean> {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      try {
        if ((await locator.count()) === 0) {
          continue;
        }

        await humanDelay();
        await locator.fill(value, { timeout: 2_000 });
        await locator.dispatchEvent('change');
        return true;
      } catch {
        continue;
      }
    }

    return false;
  }

  private async collectPageText(page: Page, quoteCurrency: SupportedCurrency): Promise<string> {
    if (this.provider.key === 'provider-c') {
      return this.collectProviderCPageText(page, quoteCurrency);
    }

    return page.evaluate(
      ({
        baseCurrency,
        quoteCurrency: nextQuoteCurrency,
        fromSelector,
        rateSelector,
        toSelector,
        labelSelector,
        rateContainerSelectors,
        sendAmountLabelPatterns,
        receiveFieldLabelPatterns,
        selectedCurrencySelectors
      }: {
        baseCurrency: string;
        quoteCurrency: string;
        fromSelector: string;
        rateSelector: string;
        toSelector: string;
        labelSelector?: string;
        rateContainerSelectors: string[];
        sendAmountLabelPatterns: string[];
        receiveFieldLabelPatterns: string[];
        selectedCurrencySelectors: string[];
      }) => {
        const parts = [document.body?.innerText ?? ''];
        const fromNode = document.querySelector(fromSelector);
        const rateNode = document.querySelector(rateSelector);
        const toNode = document.querySelector(toSelector);
        const fromCurrency =
          fromNode instanceof HTMLInputElement || fromNode instanceof HTMLSelectElement || fromNode instanceof HTMLTextAreaElement
            ? fromNode.value.trim()
            : fromNode?.textContent?.trim();
        const rate =
          rateNode instanceof HTMLInputElement || rateNode instanceof HTMLSelectElement || rateNode instanceof HTMLTextAreaElement
            ? rateNode.value.trim()
            : rateNode?.textContent?.trim();
        const toCurrency =
          toNode instanceof HTMLSelectElement
            ? (toNode.selectedOptions[0]?.textContent?.trim() ?? toNode.value.trim())
            : toNode instanceof HTMLInputElement || toNode instanceof HTMLTextAreaElement
              ? toNode.value.trim()
              : toNode?.textContent?.trim();
        const rateLabel = labelSelector ? document.querySelector(labelSelector)?.textContent?.trim() : undefined;
        const fromValue =
          fromNode instanceof HTMLInputElement || fromNode instanceof HTMLSelectElement || fromNode instanceof HTMLTextAreaElement
            ? fromNode.value.trim()
            : '';
        const rateValue =
          rateNode instanceof HTMLInputElement || rateNode instanceof HTMLSelectElement || rateNode instanceof HTMLTextAreaElement
            ? rateNode.value.trim()
            : '';

        if (fromCurrency && rate && toCurrency) {
          parts.unshift(`1 ${fromCurrency} ${rate} ${toCurrency} ${rateLabel ?? ''}`.trim());
        }

        if (fromValue && rateValue && toCurrency) {
          parts.unshift(`${fromValue} ${baseCurrency} = ${rateValue} ${toCurrency}`);
        }

        if (sendAmountLabelPatterns.length > 0 && receiveFieldLabelPatterns.length > 0) {
          const sendLabels = sendAmountLabelPatterns.map((label) => label.toUpperCase());
          const receiveLabels = receiveFieldLabelPatterns.map((label) => label.toUpperCase());
          const allNodes = Array.from(document.querySelectorAll('body *'));
          const sendLabel = allNodes.find((node) =>
            sendLabels.includes(((node as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim().toUpperCase())
          );
          const receiveLabel = allNodes.find((node) =>
            receiveLabels.includes(((node as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim().toUpperCase())
          );

          if (sendLabel && receiveLabel) {
            const sendScopes = [(sendLabel as HTMLElement).closest('label'), (sendLabel as HTMLElement).closest('div'), sendLabel.parentElement].filter(
              Boolean
            ) as HTMLElement[];
            const receiveScopes = [
              (receiveLabel as HTMLElement).closest('label'),
              (receiveLabel as HTMLElement).closest('div'),
              receiveLabel.parentElement
            ].filter(Boolean) as HTMLElement[];
            const sendInput = sendScopes
              .map((scope) => scope.querySelector('input:not([type="hidden"]), textarea'))
              .find((node) => node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement);
            const receiveInput = receiveScopes
              .map((scope) => scope.querySelector('input[type="number"], input:not([type="hidden"]), textarea'))
              .find((node) => node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement);
            const receiveSelect = receiveScopes.map((scope) => scope.querySelector('select')).find((node) => node instanceof HTMLSelectElement);

            const sendValue = sendInput instanceof HTMLInputElement || sendInput instanceof HTMLTextAreaElement ? sendInput.value.trim() : '';
            const receiveValue =
              receiveInput instanceof HTMLInputElement || receiveInput instanceof HTMLTextAreaElement ? receiveInput.value.trim() : '';
            const receiveCurrency =
              receiveSelect instanceof HTMLSelectElement
                ? (receiveSelect.selectedOptions[0]?.textContent?.trim() ?? receiveSelect.value.trim())
                : selectedCurrencySelectors
                    .map((selector) => document.querySelector(selector))
                    .map((node) => {
                      if (node instanceof HTMLSelectElement) {
                        return node.selectedOptions[0]?.textContent?.trim() ?? node.value.trim();
                      }

                      if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
                        return node.value.trim();
                      }

                      if (node instanceof HTMLElement) {
                        return node.textContent?.trim() ?? '';
                      }

                      return '';
                    })
                    .find(Boolean) ?? nextQuoteCurrency;

            if (sendValue && receiveValue && receiveCurrency) {
              parts.unshift(`${sendValue} ${baseCurrency} = ${receiveValue} ${receiveCurrency}`);
            }
          }
        }

        const candidateNodes = Array.from(document.querySelectorAll(rateContainerSelectors.join(', ')));
        for (const node of candidateNodes) {
          const text = node.textContent?.trim();
          if (text) {
            parts.push(text);
          }
        }

        const currencyNodes = Array.from(document.querySelectorAll('body *'))
          .map((node) => node as HTMLElement)
          .filter((node) => {
            const text = node.innerText?.trim();
            return Boolean(text && text.toUpperCase().includes(nextQuoteCurrency));
          })
          .slice(0, 8);

        for (const node of currencyNodes) {
          const parentText = node.parentElement?.innerText?.trim();
          if (parentText) {
            parts.push(parentText);
          }
        }

        return parts.join('\n');
      },
      {
        baseCurrency: this.provider.supportedBaseCurrency,
        quoteCurrency,
        fromSelector: this.provider.deterministic.rateText.fromSelector,
        rateSelector: this.provider.deterministic.rateText.rateSelector,
        toSelector: this.provider.deterministic.rateText.toSelector,
        labelSelector: this.provider.deterministic.rateText.labelSelector,
        rateContainerSelectors: [...this.provider.deterministic.dom.rateContainerSelectors],
        sendAmountLabelPatterns: [...(this.provider.deterministic.dom.sendAmountLabelPatterns ?? [])],
        receiveFieldLabelPatterns: [...(this.provider.deterministic.dom.receiveFieldLabelPatterns ?? [])],
        selectedCurrencySelectors: [...this.provider.deterministic.dom.selectedCurrencySelectors]
      }
    );
  }

  private async collectProviderCPageText(page: Page, quoteCurrency: SupportedCurrency): Promise<string> {
    return page.evaluate(({ quoteCurrency: nextQuoteCurrency }) => {
      const container =
        document.querySelector('.ll-rateToday-convert') ??
        document.querySelector('.ll-rate-today-wrap') ??
        document.querySelector('.tmtr-wrap');
      const sectionText = container?.textContent?.replace(/\s+/g, ' ').trim() ?? document.body?.innerText ?? '';
      const aliasesByCurrency: Record<string, string[]> = {
        INR: ['INDIAN RUPEE'],
        PKR: ['PAKISTANI RUPEE'],
        NPR: ['NEPALESE RUPEE', 'NEPALI RUPEE']
      };
      const aliases = aliasesByCurrency[nextQuoteCurrency] ?? [nextQuoteCurrency];
      const snippets: string[] = [];

      for (const alias of aliases) {
        const compactPattern = new RegExp(`${alias}\\s*([0-9]+(?:\\.[0-9]+)?)\\s*${nextQuoteCurrency}`, 'i');
        const compactMatch = sectionText.match(compactPattern);
        if (compactMatch) {
          snippets.push(`1 AED = ${compactMatch[1]} ${nextQuoteCurrency}`);
          snippets.push(`${alias} ${compactMatch[1]} ${nextQuoteCurrency}`);
        }
      }

      return [...snippets, sectionText].join('\n');
    }, { quoteCurrency });
  }

  private async writeDebugArtifacts(
    page: Page,
    quoteCurrency: SupportedCurrency,
    pageText: string,
    parsed: { rate: number; evidence: string; parserPath: 'primary' | 'fallback' } | null,
    fetchedAt: string
  ): Promise<void> {
    if (!collectorConfig.extraction.debugMode) {
      return;
    }

    const baseDir = path.resolve(collectorConfig.extraction.debugArtifactsDir);
    await fs.mkdir(baseDir, { recursive: true });

    const stamp = fetchedAt.replace(/[:.]/g, '-');
    const textPath = path.join(baseDir, `${this.provider.key}-${quoteCurrency}-${stamp}.txt`);
    const jsonPath = path.join(baseDir, `${this.provider.key}-${quoteCurrency}-${stamp}.json`);
    const screenshotPath = path.join(baseDir, `${this.provider.key}-${quoteCurrency}-${stamp}.png`);

    await fs.writeFile(textPath, pageText, 'utf8');
    await fs.writeFile(
      jsonPath,
      JSON.stringify(
        {
          provider: this.provider.key,
          quote_currency: quoteCurrency,
          parsed,
          fetched_at: fetchedAt
        },
        null,
        2
      ),
      'utf8'
    );
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
  }

  private buildError(
    quoteCurrency: string,
    reasonCode: FailureReasonCode,
    message: string,
    sourceUrl: string,
    fetchedAt: string
  ): ExtractError {
    return {
      provider: this.provider.key,
      provider_name: this.provider.displayName,
      quote_currency: quoteCurrency,
      reason_code: reasonCode,
      message,
      source_url: sourceUrl,
      fetched_at: fetchedAt,
      extraction_mode: EXTRACTION_MODE
    };
  }
}

async function clickFirstVisible(page: Page, selectors: readonly string[]): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    try {
      const count = await locator.count();
      if (count === 0) {
        continue;
      }

      for (let index = 0; index < count; index += 1) {
        const candidate = locator.nth(index);
        try {
          await candidate.waitFor({ state: 'visible', timeout: 500 });
          await humanDelay();
          await candidate.click({ timeout: 2_000 });
          return true;
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }

  return false;
}

function createFailure(reasonCode: FailureReasonCode, message: string): Error & { reasonCode: FailureReasonCode } {
  const error = new Error(message) as Error & { reasonCode: FailureReasonCode };
  error.reasonCode = reasonCode;
  return error;
}

function normalizeError(error: unknown): { reasonCode: FailureReasonCode; message: string } {
  if (error instanceof Error && 'reasonCode' in error && typeof error.reasonCode === 'string') {
    return { reasonCode: error.reasonCode as FailureReasonCode, message: error.message };
  }

  if (error instanceof Error && /timed out/i.test(error.message)) {
    return { reasonCode: 'TIMEOUT', message: error.message };
  }

  if (error instanceof Error && /net::|navigation/i.test(error.message)) {
    return { reasonCode: 'NAVIGATION_FAILED', message: error.message };
  }

  return { reasonCode: 'UNKNOWN', message: normalizeUnknownError(error) };
}

function normalizeUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === 'string' ? error : 'Unknown error';
}

function buildSelectionTokens(quoteCurrency: SupportedCurrency, aliases: readonly string[]): string[] {
  return [quoteCurrency, ...aliases];
}

function escapeSelectorString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;

  return Promise.race([
    promise.finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }),
    new Promise<T>((_, reject) => {
      timeoutId = setTimeout(() => reject(createFailure('TIMEOUT', timeoutMessage)), timeoutMs);
    })
  ]);
}
