import { fileURLToPath } from 'node:url';
import { MonitoringRepository } from '../persistence/tursoClient.js';

async function main(): Promise<void> {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error('TURSO_DATABASE_URL is required');
  const minExpected = Number.parseInt(process.env.MIN_EXPECTED_RUNS ?? '90', 10);
  const opsWebhook = process.env.SLACK_OPS_WEBHOOK_URL;

  const repo = await MonitoringRepository.connect({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const count = await repo.countRunsSince(sevenDaysAgo);
  repo.close();

  console.log(JSON.stringify({ window: 'last_7_days', since: sevenDaysAgo, runs: count, min_expected: minExpected }));

  if (count < minExpected && opsWebhook) {
    await fetch(opsWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `cron-health: only ${count} collection runs in the last 7 days (expected ≥ ${minExpected})`
      }),
      signal: AbortSignal.timeout(10_000)
    }).catch(() => undefined);
    process.exit(2);
  }
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
