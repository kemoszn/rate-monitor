export interface GeoContext {
  /** Source of the values: 'detected' if from IP lookup, 'fallback' otherwise. */
  source: 'detected' | 'fallback';
  countryCode: string;
  timezoneId: string;
  locale: string;
  latitude: number;
  longitude: number;
  publicIp: string | null;
}

const FALLBACK: GeoContext = {
  source: 'fallback',
  countryCode: 'US',
  timezoneId: 'America/New_York',
  locale: 'en-US',
  latitude: 40.7128,
  longitude: -74.006,
  publicIp: null
};

const COUNTRY_LOCALE: Record<string, string> = {
  US: 'en-US',
  GB: 'en-GB',
  CA: 'en-CA',
  AU: 'en-AU',
  IE: 'en-IE',
  DE: 'en-US',
  FR: 'en-US',
  NL: 'en-US',
  SG: 'en-SG',
  IN: 'en-IN'
};

interface IpapiResponse {
  ip?: string;
  country_code?: string;
  timezone?: string;
  languages?: string;
  latitude?: number;
  longitude?: number;
  error?: boolean;
  reason?: string;
}

export interface ResolveGeoOptions {
  /** Override URL for testing or self-hosting. */
  endpoint?: string;
  /** Hard cap on the lookup; fallback returned on timeout. */
  timeoutMs?: number;
  /** Optional fetch implementation override (for tests). */
  fetchImpl?: typeof fetch;
}

export async function resolveGeoContext(options: ResolveGeoOptions = {}): Promise<GeoContext> {
  const endpoint = options.endpoint ?? 'https://ipapi.co/json/';
  const timeoutMs = options.timeoutMs ?? 4_000;
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(endpoint, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) {
      return FALLBACK;
    }
    const body = (await response.json()) as IpapiResponse;
    if (body.error) {
      return FALLBACK;
    }
    if (!body.country_code || !body.timezone || body.latitude === undefined || body.longitude === undefined) {
      return FALLBACK;
    }
    return {
      source: 'detected',
      countryCode: body.country_code,
      timezoneId: body.timezone,
      locale: pickLocale(body.country_code, body.languages),
      latitude: body.latitude,
      longitude: body.longitude,
      publicIp: body.ip ?? null
    };
  } catch {
    return FALLBACK;
  }
}

function pickLocale(countryCode: string, languagesCsv: string | undefined): string {
  if (languagesCsv) {
    const first = languagesCsv.split(',')[0]?.trim();
    if (first && /^[a-zA-Z-]+$/.test(first)) {
      return first;
    }
  }
  return COUNTRY_LOCALE[countryCode] ?? 'en-US';
}

export const FALLBACK_GEO_CONTEXT = FALLBACK;
