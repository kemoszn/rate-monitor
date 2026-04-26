import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const configDir = path.dirname(fileURLToPath(import.meta.url));
const collectorRoot = path.resolve(configDir, '..');

dotenv.config({ path: path.join(collectorRoot, '.env') });

const envBoolean = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === 'boolean') {
      return value;
    }

    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) {
      return true;
    }

    if (['false', '0', 'no', 'off', ''].includes(normalized)) {
      return false;
    }

    throw new Error(`Invalid boolean value: ${value}`);
  });

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('127.0.0.1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  PLAYWRIGHT_HEADLESS: envBoolean.default(true),
  OPENAI_API_KEY: z.string().optional(),
  STAGEHAND_MODEL_NAME: z.string().default('openai/gpt-4.1-mini'),
  STAGEHAND_HEADLESS: envBoolean.default(true),
  STAGEHAND_VERBOSE: z.coerce.number().int().min(0).max(2).default(0),
  EXTRACT_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  NAVIGATION_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  RETRY_ATTEMPTS: z.coerce.number().int().min(0).max(5).default(2),
  RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().default(750),
  DEBUG_MODE: envBoolean.default(false),
  DEBUG_ARTIFACTS_DIR: z.string().default('./debug-artifacts'),
  DISCOVERY_ARTIFACTS_DIR: z.string().default('./discovery-artifacts'),
  DEFAULT_SOURCE_URL: z.string().url().default('https://example.com')
});

const parsed = envSchema.parse(process.env);

export const collectorConfig = {
  port: parsed.PORT,
  host: parsed.HOST,
  logLevel: parsed.LOG_LEVEL,
  playwright: {
    headless: parsed.PLAYWRIGHT_HEADLESS
  },
  openAiApiKey: parsed.OPENAI_API_KEY,
  stagehand: {
    modelName: parsed.STAGEHAND_MODEL_NAME,
    headless: parsed.STAGEHAND_HEADLESS,
    verbose: parsed.STAGEHAND_VERBOSE,
    discoveryArtifactsDir: parsed.DISCOVERY_ARTIFACTS_DIR
  },
  extraction: {
    timeoutMs: parsed.EXTRACT_TIMEOUT_MS,
    navigationTimeoutMs: parsed.NAVIGATION_TIMEOUT_MS,
    retryAttempts: parsed.RETRY_ATTEMPTS,
    retryBaseDelayMs: parsed.RETRY_BASE_DELAY_MS,
    debugMode: parsed.DEBUG_MODE,
    debugArtifactsDir: parsed.DEBUG_ARTIFACTS_DIR,
    defaultSourceUrl: parsed.DEFAULT_SOURCE_URL
  }
};

export type CollectorConfig = typeof collectorConfig;
