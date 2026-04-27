import type { CampaignRecommendation, CampaignSignalType, SlackDeliveryStatus } from '@rate-monitor/shared';

export interface CampaignNotifierConfig {
  webhookUrl: string | undefined;
  timeoutMs: number;
}

export interface CampaignDeliveryResult {
  deliveryStatus: SlackDeliveryStatus;
  deliveryError: string | null;
}

export class CampaignNotifier {
  constructor(private readonly config: CampaignNotifierConfig) {}

  async send(runId: number, recommendations: CampaignRecommendation[]): Promise<CampaignDeliveryResult> {
    if (recommendations.length === 0) {
      return { deliveryStatus: 'SKIPPED', deliveryError: 'no recommendations to send' };
    }
    if (!this.config.webhookUrl) {
      return { deliveryStatus: 'SKIPPED', deliveryError: 'webhook URL not configured' };
    }
    try {
      const response = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.config.timeoutMs),
        body: JSON.stringify(toCampaignSlackMessage(runId, recommendations))
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

const SIGNAL_EMOJI: Record<CampaignSignalType, string> = {
  LIVE_RATE: ':zap:',
  BEST_IN_MARKET: ':money_with_wings:',
  BEAT_GOOGLE: ':globe_with_meridians:',
  NEW_HIGH: ':rocket:'
};

export function toCampaignSlackMessage(runId: number, recs: CampaignRecommendation[]) {
  const lines = recs.map((rec) => formatRecommendationLines(rec)).join('\n\n');
  const text = `Campaign Opportunities — Run #${runId}: ${recs.length} signal(s)`;
  return {
    text,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: 'Campaign Opportunities' }
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*Run #${runId}* — ${recs.length} signal${recs.length === 1 ? '' : 's'}` }
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: lines }
      }
    ]
  };
}

function formatRecommendationLines(rec: CampaignRecommendation): string {
  const emoji = SIGNAL_EMOJI[rec.signalType];
  const cycleTag = rec.inSalaryCycle ? ' [salary-cycle]' : '';
  const header = `${emoji} *${rec.currency}* — ${rec.signalType}${cycleTag}`;
  const detail = formatDetailLine(rec);
  const recommendation = `   Recommended margin: ${rec.recommendedMargin}%  →  effective ${roundRate(rec.effectiveRate)}`;
  return `${header}\n   ${detail}\n${recommendation}`;
}

function formatDetailLine(rec: CampaignRecommendation): string {
  const parts: string[] = [`Flat ${roundRate(rec.flatRate)}`];
  switch (rec.signalType) {
    case 'BEST_IN_MARKET':
      if (rec.bestCompetitorRate !== null) {
        parts.push(`Best competitor ${roundRate(rec.bestCompetitorRate)} (${rec.bestCompetitorKey})`);
      }
      break;
    case 'BEAT_GOOGLE':
      if (rec.googleRate !== null) {
        parts.push(`Google ${roundRate(rec.googleRate)}`);
      }
      break;
    case 'NEW_HIGH':
      if (rec.historyMax !== null) {
        parts.push(`30d max ${roundRate(rec.historyMax)}`);
      }
      break;
    case 'LIVE_RATE':
      parts.push(rec.rationale);
      break;
  }
  return parts.join('  •  ');
}

function roundRate(value: number): string {
  return Number(value.toFixed(4)).toString();
}
