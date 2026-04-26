import type { AlertDeliveryStatus, SlackAlertPayload } from '@rate-monitor/shared';

export interface AlertDeliveryResult {
  deliveryStatus: AlertDeliveryStatus;
  deliveryError: string | null;
}

export interface SlackNotifierConfig {
  webhookUrl: string | undefined;
  timeoutMs: number;
}

export class SlackNotifier {
  constructor(private readonly config: SlackNotifierConfig) {}

  async send(payload: SlackAlertPayload): Promise<AlertDeliveryResult> {
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

function toSlackMessage(payload: SlackAlertPayload) {
  const marketLines = payload.market_rates
    .map((entry) => `${entry.provider_name}: ${entry.rate === null ? 'n/a' : entry.rate}`)
    .join('\n');

  return {
    text: `[${payload.now_mode}] ${payload.currency} ${payload.alert_type} at ${payload.current_now_rate}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${payload.now_mode} ${payload.currency} ${payload.alert_type}` }
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Current rate*\n${payload.current_now_rate}` },
          { type: 'mrkdwn', text: `*Benchmark rate*\n${payload.google_rate ?? 'n/a'}` },
          { type: 'mrkdwn', text: `*Triggered at*\n${payload.timestamp}` },
          { type: 'mrkdwn', text: `*Lookback*\n${payload.lookback_days === null ? 'all time' : `${payload.lookback_days} days`}` }
        ]
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*Market provider rates*\n${marketLines || 'No market rates available'}` }
      }
    ]
  };
}
