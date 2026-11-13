'use client';

import Link from 'next/link';
import Script from 'next/script';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const GA_ID = process.env.NEXT_PUBLIC_GA_ID;
const ADS_CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT;
// Third-party scripts never load in development unless explicitly forced.
const ALLOW_IN_DEV = process.env.NEXT_PUBLIC_ENABLE_THIRD_PARTY_IN_DEV === 'true';
const THIRD_PARTY_ON = process.env.NODE_ENV === 'production' || ALLOW_IN_DEV;
const NEEDS_CONSENT = THIRD_PARTY_ON && Boolean(GA_ID || ADS_CLIENT);
const KEY = 'anillion-consent';

type Choice = 'granted' | 'denied' | null;
const ConsentContext = createContext<Choice>(null);
export const useConsent = () => useContext(ConsentContext);

/**
 * Cookie consent + loaders for Google Analytics and AdSense.
 * Nothing third-party loads until the visitor accepts, and nothing at all
 * renders when neither integration is configured.
 */
export function ConsentProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<Choice>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === 'granted' || saved === 'denied') setChoice(saved);
    } catch {
      // Storage unavailable: treat as undecided.
    }
    setReady(true);
  }, []);

  function decide(next: Exclude<Choice, null>) {
    setChoice(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Ignore: the choice still applies to this visit.
    }
  }

  const granted = NEEDS_CONSENT && choice === 'granted';

  return (
    <ConsentContext.Provider value={NEEDS_CONSENT ? choice : 'denied'}>
      {children}
      {granted && GA_ID && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
          <Script id="ga-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}',{anonymize_ip:true});`}
          </Script>
        </>
      )}
      {granted && ADS_CLIENT && (
        <Script
          src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADS_CLIENT}`}
          strategy="lazyOnload"
          crossOrigin="anonymous"
        />
      )}
      {NEEDS_CONSENT && ready && choice === null && (
        <div className="consent" role="dialog" aria-label="Cookie preferences">
          <p style={{ margin: '0 0 10px' }}>
            We use cookies that are needed to run the game. With your permission we also use cookies for analytics and
            advertising. See our <Link href="/privacy">privacy policy</Link>.
          </p>
          <div className="row">
            <button type="button" className="btn small" onClick={() => decide('granted')}>
              Accept all
            </button>
            <button type="button" className="btn ghost small" onClick={() => decide('denied')}>
              Necessary only
            </button>
          </div>
        </div>
      )}
    </ConsentContext.Provider>
  );
}

/**
 * An advertising slot. Renders nothing unless AdSense is configured, the
 * slot id exists and the visitor consented. Only placed outside gameplay.
 */
export function AdSlot({ slot }: { slot: string | undefined }) {
  const consent = useConsent();
  const show = THIRD_PARTY_ON && ADS_CLIENT && slot && consent === 'granted';

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
