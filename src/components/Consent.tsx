'use client';

import Link from 'next/link';
import Script from 'next/script';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ACCEPT_ALL,
  REJECT_ALL,
  cookieDomains,
  consentCookie,
  effectiveConsent,
  isDecided,
  optionalCookieNames,
  readConsent,
  type Consent,
} from '@/lib/consent';

const GA_ID = process.env.NEXT_PUBLIC_GA_ID;
const ADS_CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT;
// Third-party scripts never load in development unless explicitly forced.
const ALLOW_IN_DEV = process.env.NEXT_PUBLIC_ENABLE_THIRD_PARTY_IN_DEV === 'true';
const THIRD_PARTY_ON = process.env.NODE_ENV === 'production' || ALLOW_IN_DEV;
const ANALYTICS_CONFIGURED = Boolean(GA_ID);
const ADS_CONFIGURED = Boolean(ADS_CLIENT);

type ConsentState = { analytics: boolean; ads: boolean; decided: boolean; openSettings: () => void };
const ConsentContext = createContext<ConsentState>({ analytics: false, ads: false, decided: false, openSettings: () => {} });
export const useConsent = () => useContext(ConsentContext);

/** Remove the cookies Google set (on this host and its parents), after consent is withdrawn. */
function clearOptionalCookies() {
  const names = optionalCookieNames(document.cookie.split(';').map((c) => c.split('=')[0].trim()));
  for (const name of names) {
    for (const domain of cookieDomains(location.hostname)) {
      document.cookie = `${name}=; Max-Age=0; Path=/; ${domain ? `Domain=${domain}; ` : ''}SameSite=Lax`;
    }
    document.cookie = `${name}=; Max-Age=0; Path=/`;
  }
}

const gpcOn = () => (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;

/**
 * Cookie banner, settings panel, and the loaders for Google Analytics and AdSense.
 * Nothing optional runs until the visitor says yes. The default, and "Reject all",
 * means no analytics, no advertising, and no third-party cookies at all.
 */
export function ConsentProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [consent, setConsent] = useState<Consent>(REJECT_ALL);
  const [decided, setDecided] = useState(false);
  const [panel, setPanel] = useState(false);
  // What was switched on when the page loaded: if it is switched off, the page must reload to drop the scripts.
  const loadedWith = useRef<Consent>(REJECT_ALL);

  useEffect(() => {
    const stored = readConsent(document.cookie);
    const gpc = gpcOn();
    const effective = effectiveConsent(stored, gpc);
    setConsent(effective);
    setDecided(isDecided(stored, gpc));
    loadedWith.current = effective;
    if (GA_ID && !effective.analytics) (window as any)[`ga-disable-${GA_ID}`] = true;
    if (!effective.analytics && !effective.ads) clearOptionalCookies();
    setReady(true);
  }, []);

  const save = useCallback((next: Consent) => {
    const effective = gpcOn() ? REJECT_ALL : next;
    document.cookie = consentCookie(next, location.protocol === 'https:');
    setConsent(effective);
    setDecided(true);
    setPanel(false);
    const withdrew = (loadedWith.current.analytics && !effective.analytics) || (loadedWith.current.ads && !effective.ads);
    if (GA_ID && !effective.analytics) (window as any)[`ga-disable-${GA_ID}`] = true;
    if (!effective.analytics || !effective.ads) clearOptionalCookies();
    // Remember what this page has started loading, so withdrawing it later still triggers a reload.
    loadedWith.current = {
      analytics: loadedWith.current.analytics || effective.analytics,
      ads: loadedWith.current.ads || effective.ads,
    };
    // A script that is already running cannot be unloaded, so start the page again without it.
    if (withdrew) location.reload();
  }, []);

  const openSettings = useCallback(() => setPanel(true), []);
  const live = THIRD_PARTY_ON;

  return (
    <ConsentContext.Provider value={{ ...consent, decided, openSettings }}>
      {children}
      {live && ready && consent.analytics && GA_ID && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
          <Script id="ga-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}',{anonymize_ip:true});`}
          </Script>
        </>
      )}
      {live && ready && consent.ads && ADS_CLIENT && (
        <Script
          src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADS_CLIENT}`}
          strategy="lazyOnload"
          crossOrigin="anonymous"
        />
      )}
      {ready && !decided && !panel && <Banner onSave={save} onCustomise={openSettings} />}
      {ready && panel && <SettingsPanel current={consent} onSave={save} onClose={() => setPanel(false)} />}
    </ConsentContext.Provider>
  );
}

function Banner({ onSave, onCustomise }: { onSave: (c: Consent) => void; onCustomise: () => void }) {
  return (
    <div className="consent" role="dialog" aria-labelledby="consent-title" aria-describedby="consent-text" data-testid="cookie-banner">
      <h2 id="consent-title" className="consent-title">
        Cookies
      </h2>
      <p id="consent-text" style={{ margin: '0 0 12px' }}>
        We use cookies that are needed to run the game. With your permission we would also use cookies for analytics and
        advertising. If you reject, we use nothing else and nothing is shared with anyone. Details in our{' '}
        <Link href="/cookies">cookie policy</Link>.
      </p>
      <div className="row">
        <button type="button" className="btn small" onClick={() => onSave(REJECT_ALL)}>
          Reject all
        </button>
        <button type="button" className="btn small" onClick={() => onSave(ACCEPT_ALL)}>
          Accept all
        </button>
        <button type="button" className="btn ghost small" onClick={onCustomise}>
          Choose
        </button>
      </div>
    </div>
  );
}

function SettingsPanel({ current, onSave, onClose }: { current: Consent; onSave: (c: Consent) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<Consent>(current);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="consent-backdrop" onClick={onClose}>
      <div
        className="consent-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-panel-title"
        data-testid="cookie-settings"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="consent-panel-title" className="consent-title">
          Cookie settings
        </h2>
        <p className="hint" style={{ marginTop: 0 }}>
          Choose which optional cookies you allow. You can change this at any time from the footer. See the{' '}
          <Link href="/cookies">cookie policy</Link> for every cookie by name.
        </p>

        <div className="consent-row">
          <div>
            <strong>Necessary</strong>
            <p>Keeps you signed in, remembers your guest game and remembers this choice. The game cannot work without them.</p>
          </div>
          <label className="switch">
            <input type="checkbox" checked disabled aria-label="Necessary cookies (always on)" />
            <span>Always on</span>
          </label>
        </div>

        <div className="consent-row">
          <div>
            <strong>Analytics</strong>
            <p>
              Google Analytics, to see how many people play and which pages work.{' '}
              {!ANALYTICS_CONFIGURED && <em>Not used on this site at the moment.</em>}
            </p>
          </div>
          <label className="switch">
            <input
              ref={first}
              type="checkbox"
              checked={draft.analytics}
              onChange={(e) => setDraft({ ...draft, analytics: e.target.checked })}
              aria-label="Analytics cookies"
            />
            <span>{draft.analytics ? 'On' : 'Off'}</span>
          </label>
        </div>

        <div className="consent-row">
          <div>
            <strong>Advertising</strong>
            <p>
              Google AdSense, to show ads outside the game screen.{' '}
              {!ADS_CONFIGURED && <em>Not used on this site at the moment.</em>}
            </p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={draft.ads}
              onChange={(e) => setDraft({ ...draft, ads: e.target.checked })}
              aria-label="Advertising cookies"
            />
            <span>{draft.ads ? 'On' : 'Off'}</span>
          </label>
        </div>

        <div className="row" style={{ marginTop: 14 }}>
          <button type="button" className="btn small" onClick={() => onSave(draft)}>
            Save choices
          </button>
          <button type="button" className="btn small" onClick={() => onSave(REJECT_ALL)}>
            Reject all
          </button>
          <button type="button" className="btn ghost small" onClick={() => onSave(ACCEPT_ALL)}>
            Accept all
          </button>
        </div>
      </div>
    </div>
  );
}

/** Footer / policy-page control to reopen the settings. */
export function CookieSettingsButton({ className = 'linklike' }: { className?: string }) {
  const { openSettings } = useConsent();
  return (
    <button type="button" className={className} onClick={openSettings}>
      Cookie settings
    </button>
  );
}

/**
 * An advertising slot. Renders nothing unless AdSense is configured, the slot id
 * exists and the visitor allowed advertising. Only placed outside gameplay.
 */
export function AdSlot({ slot }: { slot: string | undefined }) {
  const { ads } = useConsent();
  const show = THIRD_PARTY_ON && ADS_CLIENT && slot && ads;

  useEffect(() => {
    if (!show) return;
    try {
      ((window as any).adsbygoogle = (window as any).adsbygoogle || []).push({});
    } catch {
      // Ad blockers and slow loads are fine; the page works without ads.
    }
  }, [show]);

  if (!show) return null;
  return (
    <aside className="ad-slot" aria-label="Advertisement">
      <div className="ad-label">Advertisement</div>
      <ins
        className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client={ADS_CLIENT}
        data-ad-slot={slot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </aside>
  );
}
