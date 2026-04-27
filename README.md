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

## Decision engine

After every collection run, the engine in `apps/collector/src/decision/` reads
the just-persisted snapshots, applies four signal types per currency, and
posts actionable Slack alerts to `SLACK_CAMPAIGN_WEBHOOK_URL` (separate from
the rate/ops webhooks so the marketing audience can subscribe independently).

Signals:

- **LIVE_RATE** — `now-flat` is in the top 50% of competitor rates (top 60%
  during salary-cycle windows). Margin = 0; publish flat as-is. Acts as a
  fallback when neither competitive signal below is reachable.
- **BEST_IN_MARKET** — there's a margin in `(0, 0.3]` that lets us beat every
  competitor by a 5bps buffer. Recommended margin = the smallest such value.
- **BEAT_GOOGLE** — same logic but against Google Finance specifically.
  Independent of BEST_IN_MARKET; both can fire if both apply.
- **NEW_HIGH** — `now-flat` ties or beats the rolling 30-day max
  (`NEW_HIGH_HISTORY_DAYS`). A cold-start gate (`NEW_HIGH_MIN_HISTORY_DAYS`,
  default 21 distinct days) suppresses this signal until enough history exists,
  preventing the false-positive flood on a fresh database.

Competitors include `provider-a` through `provider-e` and Google Finance —
Al Fardan (`provider-a`) is NOW Money's rate partner *and* a market-share
competitor, so it counts on both sides. Salary-cycle windows are the last 7
days of the month plus the first 7 days of the next, evaluated in the resolved
geo timezone; they loosen the LIVE_RATE threshold and tag other signals as
`[salary-cycle]` for prioritization.

A `(currency, signal_type)` pair won't re-emit within `CAMPAIGN_DEDUP_WINDOW_HOURS`
(default 6). All evaluations — emitted, deduped, and cold-start-suppressed —
are persisted to the `campaign_recommendations` table for audit. Engine errors
never fail the cron run; they're logged and the workflow continues.

## Tests

```bash
npm test
```

The persistence layer is covered by file-backed libSQL tests; parsers have
fixture-based unit tests; the extractor router exercises hostname routing.
