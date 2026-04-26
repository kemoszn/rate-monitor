import type { RateBounds } from '@rate-monitor/shared';

export function validateRate(rate: number, bounds: RateBounds): boolean {
  return Number.isFinite(rate) && rate >= bounds.min && rate <= bounds.max;
}
