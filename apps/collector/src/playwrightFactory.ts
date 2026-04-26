import { chromium } from 'playwright-extra';
import type { Browser, BrowserContext } from 'playwright';
// @ts-ignore Known type-definition gap for puppeteer-extra-plugin-stealth.
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { CollectorConfig } from './config.js';
import { BROWSER_PROFILES, type BrowserProfile } from './playwrightFactory/profiles.js';
import type { GeoContext } from './runtime/geoContext.js';

const DEFAULT_PROFILE: BrowserProfile = BROWSER_PROFILES[0];

chromium.use(stealthPlugin());

export interface PlaywrightProxyConfig {
  server: string;
  username?: string;
  password?: string;
}

export interface PlaywrightBrowserOptions {
  /** Adds artificial delay between Playwright protocol commands (ms). */
  slowMo?: number;
  proxy?: PlaywrightProxyConfig;
}

export async function createPlaywrightBrowser(
  config: CollectorConfig,
  options: PlaywrightBrowserOptions = {}
): Promise<Browser> {
  return chromium.launch({
    headless: config.playwright.headless,
    slowMo: options.slowMo,
    proxy: options.proxy,
    args: [
      '--headless=new',
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-infobars',
      '--window-size=1920,1080'
    ]
  });
}

export interface PlaywrightContextOptions {
  /** UA / viewport / device pixel ratio profile for fingerprint diversity. */
  profile?: BrowserProfile;
  /** Detected runner geolocation; aligns timezone, locale, and geolocation to one identity. */
  geo?: GeoContext;
}

export async function createPlaywrightContext(
  browser: Browser,
  options: PlaywrightContextOptions = {}
): Promise<BrowserContext> {
  const profile = options.profile ?? DEFAULT_PROFILE;
  const geo = options.geo;

  const context = await browser.newContext({
    viewport: profile.viewport,
    deviceScaleFactor: profile.deviceScaleFactor,
    userAgent: profile.userAgent,
    locale: geo?.locale ?? profile.locale,
    timezoneId: geo?.timezoneId ?? profile.timezoneId,
    geolocation: geo ? { latitude: geo.latitude, longitude: geo.longitude } : undefined,
    permissions: geo ? ['geolocation'] : undefined
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined
    });
  });

  return context;
}

export function humanDelay(): Promise<void> {
  const ms = Math.floor(Math.random() * 1700) + 800;
  return new Promise((resolve) => setTimeout(resolve, ms));
}
