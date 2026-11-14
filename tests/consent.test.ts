import { describe, expect, it } from 'vitest';
import {
  ACCEPT_ALL,
  CONSENT_COOKIE,
  CONSENT_VERSION,
  REJECT_ALL,
  consentCookie,
  cookieDomains,
  effectiveConsent,
  isDecided,
  optionalCookieNames,
  parseConsent,
  readConsent,
  serializeConsent,
} from '@/lib/consent';

describe('cookie consent', () => {
  it('starts with everything optional off and no decision', () => {
    expect(effectiveConsent(null, false)).toEqual(REJECT_ALL);
    expect(isDecided(null, false)).toBe(false);
  });

  it('round-trips a choice through the cookie', () => {
    for (const choice of [ACCEPT_ALL, REJECT_ALL, { analytics: true, ads: false }, { analytics: false, ads: true }]) {
      const header = `theme=dark; ${CONSENT_COOKIE}=${serializeConsent(choice, 1234)}; other=1`;
      expect(readConsent(header)).toEqual({ ...choice, v: CONSENT_VERSION, at: 1234 });
    }
  });

  it('treats a missing, damaged, tampered or outdated cookie as "not decided", never as consent', () => {
    expect(readConsent('')).toBeNull();
    expect(readConsent('a=1')).toBeNull();
    expect(parseConsent('not-json')).toBeNull();
    expect(parseConsent('%7B%7D')).toBeNull();
    expect(parseConsent(encodeURIComponent(JSON.stringify({ v: CONSENT_VERSION, analytics: 'yes', ads: true })))).toBeNull();
    expect(parseConsent(encodeURIComponent(JSON.stringify({ v: CONSENT_VERSION + 1, analytics: true, ads: true })))).toBeNull();
    expect(parseConsent(encodeURIComponent(JSON.stringify({ v: CONSENT_VERSION - 1, analytics: true, ads: true })))).toBeNull();
    expect(effectiveConsent(parseConsent('garbage'), false)).toEqual(REJECT_ALL);
  });

  it('only stores real booleans, so a truthy value cannot switch something on', () => {
    const forged = serializeConsent({ analytics: 1 as unknown as boolean, ads: 'true' as unknown as boolean });
    expect(parseConsent(forged)).toMatchObject({ analytics: false, ads: false });
  });

  it('honours Global Privacy Control over a saved "accept"', () => {
    const accepted = parseConsent(serializeConsent(ACCEPT_ALL));
    expect(effectiveConsent(accepted, true)).toEqual(REJECT_ALL);
    expect(effectiveConsent(accepted, false)).toEqual(ACCEPT_ALL);
    expect(isDecided(null, true)).toBe(true);
  });

  it('builds a six month, same-site cookie, secure on https only', () => {
    const https = consentCookie(REJECT_ALL, true, 1);
    expect(https).toContain(`${CONSENT_COOKIE}=`);
    expect(https).toContain('Max-Age=15811200');
    expect(https).toContain('SameSite=Lax');
    expect(https).toContain('Secure');
    expect(consentCookie(REJECT_ALL, false, 1)).not.toContain('Secure');
  });

  it('picks out the Google cookies to delete when consent is withdrawn, and nothing else', () => {
    const names = ['an_guest', 'an_consent', 'sb-abc-auth-token', '_ga', '_ga_ABC123', '_gid', '__gads', '__gpi', 'IDE', 'test_cookie', 'theme'];
    expect(optionalCookieNames(names)).toEqual(['_ga', '_ga_ABC123', '_gid', '__gads', '__gpi', 'IDE', 'test_cookie']);
  });

  it('lists the domains a cookie may have been set on', () => {
    expect(cookieDomains('www.anillion.example')).toEqual(['www.anillion.example', '.www.anillion.example', '.anillion.example']);
    expect(cookieDomains('localhost')).toEqual(['localhost']);
    expect(cookieDomains('127.0.0.1')).toEqual(['127.0.0.1']);
  });
});
