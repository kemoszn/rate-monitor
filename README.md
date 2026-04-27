# rate-monitor

A scheduled web-rate collector. Runs hourly via GitHub Actions, scrapes a
configurable list of provider sites with Playwright, persists results to a
Turso (libSQL) database, and posts per-run rate summaries to Slack.

## Layout

```
apps/collector/   stateless extractor + cron CLI (collect:once)
packages/shared/  type definitions and constants
.github/workflows/collect.yml       hourly cron schedule
.github/workflows/cron-health.yml   weekly missed-run audit
```

## Local development

```bash
npm install
npx playwright install --with-deps chromium
cp apps/collector/.env.example apps/collector/.env   # then fill in values
npm run collect:once
```

Required env vars (see `apps/collector/.env.example` for the full list):

- `TURSO_DATABASE_URL` (and optionally `TURSO_AUTH_TOKEN`)
- `PROVIDER_CONFIG_JSON` — JSON-encoded array of provider definitions
- `SLACK_RATE_WEBHOOK_URL` / `SLACK_OPS_WEBHOOK_URL` (optional)

## Scheduled run

The `collect` workflow fires on a cron schedule and triggers `collect:once`
in a fresh Ubuntu runner. Each run resolves the runner's IP geolocation and
aligns the Playwright browser timezone, locale, and geolocation to it; rotates
through a small pool of UA/viewport profiles per provider; and persists
per-provider success/failure telemetry to Turso for post-hoc auditing.

When `SLACK_RATE_WEBHOOK_URL` is configured, the collector sends one Slack
summary per run with providers as rows and currencies as columns, ranking the
successful rates within each currency. `SLACK_OPS_WEBHOOK_URL` remains reserved
for crash and failure-threshold notifications only.

## Tests

```bash
npm test
```

The persistence layer is covered by file-backed libSQL tests; parsers have
fixture-based unit tests; the extractor router exercises hostname routing.
