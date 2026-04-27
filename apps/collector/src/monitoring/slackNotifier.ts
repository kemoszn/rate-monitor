import type { SlackDeliveryStatus, SlackRunSummaryPayload } from '@rate-monitor/shared';

export interface AlertDeliveryResult {
  deliveryStatus: SlackDeliveryStatus;
  deliveryError: string | null;
}

export interface SlackNotifierConfig {
  webhookUrl: string | undefined;
  timeoutMs: number;
}

export class SlackNotifier {
  constructor(private readonly config: SlackNotifierConfig) {}

  async send(payload: SlackRunSummaryPayload): Promise<AlertDeliveryResult> {
    if (!this.config.webhookUrl) {
      return { deliveryStatus: 'SKIPPED', deliveryError: 'webhook URL not configured' };
    }

    try {
      const response = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.config.timeoutMs),
        body: JSON.stringify(toSlackMessage(payload))
      });

      if (!response.ok) {
        return { deliveryStatus: 'FAILED', deliveryError: `Slack returned HTTP ${response.status}` };
      }

      return { deliveryStatus: 'SENT', deliveryError: null };
    } catch (error) {
      return {
        deliveryStatus: 'FAILED',
        deliveryError: error instanceof Error ? error.message : 'Unknown Slack error'
      };
    }
  }
}

export function toSlackMessage(payload: SlackRunSummaryPayload) {
  const completedAt = payload.completed_at;
  const summaryLine = `Run #${payload.run_id} | ${payload.status} | Completed ${completedAt}`;
  const totalsLine = `Success to failure [Success:${payload.success_count}, failure:${payload.failure_count}]`;

  return {
    text: `${summaryLine} | ${totalsLine}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: 'Rate Monitor Run Summary' }
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: summaryLine }
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: totalsLine }
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `\`\`\`\n${formatRunSummaryTable(payload)}\n\`\`\`` }
      }
    ]
  };
}

export function formatRunSummaryTable(payload: SlackRunSummaryPayload): string {
  const rankings = rankCellsByCurrency(payload);
  const header = ['Provider', ...payload.currencies];
  const rows = payload.rows.map((row, rowIndex) => [
    row.provider_name,
    ...row.cells.map((cell, currencyIndex) => {
      const rank = rankings[currencyIndex]?.get(rowIndex) ?? null;
      return rank === null ? formatRate(cell.rate) : `${formatRate(cell.rate)} (${rank})`;
    })
  ]);
  const widths = header.map((label, index) =>
    Math.max(label.length, ...rows.map((row) => row[index]?.length ?? 0))
  );

  return [header, ...rows]
    .map((row) => row.map((cell, index) => cell.padEnd(widths[index], ' ')).join(' | '))
    .join('\n');
}

function rankCellsByCurrency(payload: SlackRunSummaryPayload): Array<Map<number, string>> {
  return payload.currencies.map((_, currencyIndex) => {
    const ranked = payload.rows
      .map((row, rowIndex) => ({ rowIndex, rate: row.cells[currencyIndex]?.rate ?? null }))
      .filter((entry): entry is { rowIndex: number; rate: number } => entry.rate !== null)
      .sort((left, right) => right.rate - left.rate || left.rowIndex - right.rowIndex);

    return new Map(ranked.map((entry, rankIndex) => [entry.rowIndex, labelRank(rankIndex, ranked.length)]));
  });
}

function labelRank(rankIndex: number, total: number): string {
  if (rankIndex === 0) return 'BEST';
  if (rankIndex === total - 1) return 'Worst';
  return `#${rankIndex + 1}`;
}

function formatRate(rate: number | null): string {
  return rate === null ? 'n/a' : String(rate);
}
