/**
 * Cookie consent rules, kept free of React and the DOM so they can be tested.
 *
 * Necessary cookies (guest id, login session, this choice itself) need no consent.
 * Everything else is off until the visitor says yes, and "no" is the default.
 */

export const CONSENT_COOKIE = 'an_consent';
/** Raise this when the categories change, so people are asked again. */
export const CONSENT_VERSION = 1;
const SIX_MONTHS_SECONDS = 60 * 60 * 24 * 183;

export type Consent = { analytics: boolean; ads: boolean };
export type StoredConsent = Consent & { v: number; at: number };

export const REJECT_ALL: Consent = { analytics: false, ads: false };
export const ACCEPT_ALL: Consent = { analytics: true, ads: true };

export function serializeConsent(consent: Consent, now: number = Date.now()): string {
  const stored: StoredConsent = { analytics: consent.analytics === true, ads: consent.ads === true, v: CONSENT_VERSION, at: now };
  return encodeURIComponent(JSON.stringify(stored));
}

/** The saved choice, or null if there is none, it is malformed, or it is from an older version. */
export function parseConsent(raw: string | null | undefined): StoredConsent | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(decodeURIComponent(raw));
    if (!value || typeof value !== 'object') return null;
    if (value.v !== CONSENT_VERSION) return null;
    if (typeof value.analytics !== 'boolean' || typeof value.ads !== 'boolean') return null;
    return { analytics: value.analytics, ads: value.ads, v: value.v, at: Number(value.at) || 0 };
  } catch {
    return null;
  }
}

/** Read our cookie out of a `document.cookie` / `Cookie` header string. */
export function readConsent(cookieHeader: string | null | undefined): StoredConsent | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const i = part.indexOf('=');
    if (i !== -1 && part.slice(0, i).trim() === CONSENT_COOKIE) return parseConsent(part.slice(i + 1).trim());
  }
  return null;
}

/** The `Set-Cookie`-style string that remembers a choice for six months. */
export function consentCookie(consent: Consent, secure: boolean, now: number = Date.now()): string {
  return [
    `${CONSENT_COOKIE}=${serializeConsent(consent, now)}`,
    `Max-Age=${SIX_MONTHS_SECONDS}`,
    'Path=/',
    'SameSite=Lax',
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

/**
 * What applies right now. With no saved choice everything optional is off, and a browser
 * that sends Global Privacy Control is treated as having said no.
 */
export function effectiveConsent(stored: StoredConsent | null, globalPrivacyControl: boolean): Consent {
  if (globalPrivacyControl) return REJECT_ALL;
  return stored ? { analytics: stored.analytics, ads: stored.ads } : REJECT_ALL;
}

/** Has the visitor made a choice (or told the browser to decline for them)? */
export function isDecided(stored: StoredConsent | null, globalPrivacyControl: boolean): boolean {
  return globalPrivacyControl || stored !== null;
}

/** Cookies set by Google Analytics and AdSense, which must be removed when consent is withdrawn. */
const OPTIONAL_COOKIE_PATTERNS = [/^_ga($|_)/, /^_gid$/, /^_gat/, /^__gads$/, /^__gpi$/, /^__eoi$/, /^IDE$/, /^test_cookie$/, /^_gcl_/];

export function optionalCookieNames(names: string[]): string[] {
  return names.filter((n) => OPTIONAL_COOKIE_PATTERNS.some((p) => p.test(n)));
}

/** "a.b.example.com" -> ["a.b.example.com", ".a.b.example.com", ".b.example.com", ".example.com"] */
export function cookieDomains(hostname: string): string[] {
  if (!hostname || /^[\d.]+$/.test(hostname) || hostname === 'localhost') return [hostname];
  const parts = hostname.split('.');
  const out = [hostname];
  for (let i = 0; i < parts.length - 1; i++) out.push(`.${parts.slice(i).join('.')}`);
  return out;
}
