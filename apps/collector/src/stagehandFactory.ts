import { Stagehand } from '@browserbasehq/stagehand';
import type { CollectorConfig } from './config.js';

export async function createStagehand(config: CollectorConfig): Promise<Stagehand> {
  const stagehand = new Stagehand({
    env: 'LOCAL',
    verbose: config.stagehand.verbose as 0 | 1 | 2,
    localBrowserLaunchOptions: {
      headless: config.stagehand.headless
    },
    model: config.openAiApiKey
      ? {
          modelName: config.stagehand.modelName,
          apiKey: config.openAiApiKey
        }
      : config.stagehand.modelName
  });

  await stagehand.init();
  return stagehand;
}
