import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { API_VERSION } from '@rate-monitor/shared';
import { collectorConfig } from './config.js';
import type { ExchangeRateExtractor } from './contracts.js';
import { ExchangeRateExtractorRouter } from './extractorRouter.js';
import { buildExtractResponse, extractRequestSchema } from './extractor.js';

export function buildServer(extractor?: ExchangeRateExtractor): FastifyInstance {
  const app = Fastify({
    logger: {
      level: collectorConfig.logLevel
    }
  });

  const activeExtractor = extractor ?? new ExchangeRateExtractorRouter(app.log);

  app.get('/health', async () => ({
    status: 'ok',
    service: 'rate-monitor-collector',
    api_version: API_VERSION
  }));

  app.post('/extract', async (request, reply) => {
    const parsed = extractRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return {
        error: 'Invalid request body',
        details: parsed.error.flatten()
      };
    }

    const response = await activeExtractor.extract(parsed.data);
    return buildExtractResponse(parsed.data, response);
  });

  return app;
}

async function start(): Promise<void> {
  const app = buildServer();
  try {
    await app.listen({ host: collectorConfig.host, port: collectorConfig.port });
  } catch (error) {
    app.log.error(error, 'Failed to start collector');
    process.exitCode = 1;
  }
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  void start();
}
