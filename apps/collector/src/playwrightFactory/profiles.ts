export interface BrowserProfile {
  userAgent: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  /** Acts as a default if no GeoContext overrides locale at context-creation time. */
  locale: string;
  /** Acts as a default if no GeoContext overrides timezone at context-creation time. */
  timezoneId: string;
}

export const BROWSER_PROFILES: readonly BrowserProfile[] = [
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'America/New_York'
  },
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    viewport: { width: 1536, height: 864 },
    deviceScaleFactor: 1.25,
    locale: 'en-US',
    timezoneId: 'America/Chicago'
  },
  {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    viewport: { width: 1680, height: 1050 },
    deviceScaleFactor: 2,
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles'
  },
  {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 Edg/135.0.0.0',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    locale: 'en-GB',
    timezoneId: 'Europe/London'
  },
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 Edg/135.0.0.0',
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
    locale: 'en-GB',
    timezoneId: 'Europe/London'
  },
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'America/Denver'
  }
];

export function pickRandomProfile(seed?: number): BrowserProfile {
  const index =
    typeof seed === 'number'
      ? Math.abs(seed) % BROWSER_PROFILES.length
      : Math.floor(Math.random() * BROWSER_PROFILES.length);
  return BROWSER_PROFILES[index];
}
