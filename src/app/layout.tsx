import type { Metadata, Viewport } from 'next';
import { Bungee, Rubik } from 'next/font/google';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Analytics } from '@vercel/analytics/next';
import { ConsentProvider, CookieSettingsButton } from '@/components/Consent';
import { SiteHeader } from '@/components/SiteHeader';
import './globals.css';

const display = Bungee({ weight: '400', subsets: ['latin'], variable: '--font-display', display: 'swap' });
const body = Rubik({ subsets: ['latin'], variable: '--font-body', display: 'swap' });

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const description =
  'Animellion is a free daily anime guessing game. Answer seven anime prompts, thirty seconds each. The rarer your answer, the more points you earn. A new game every day.';
// The code Google Search Console gives you for the "HTML tag" verification method (optional).
const googleVerification = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION;

// No site-wide canonical here: a canonical set in the root layout is inherited by every page that
// does not set its own, which would tell Google that all of them are copies of the home page.
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: 'Animellion — Daily Anime Guessing Game & Quiz', template: '%s · Animellion' },
  description,
  applicationName: 'Animellion',
  keywords: ['anime game', 'daily game', 'anime quiz', 'anime trivia', 'guessing game'],
  openGraph: { type: 'website', siteName: 'Animellion', title: 'Animellion — Daily Anime Guessing Game & Quiz', description, url: siteUrl },
  twitter: { card: 'summary_large_image', title: 'Animellion — Daily Anime Guessing Game & Quiz', description },
  ...(googleVerification ? { verification: { google: googleVerification } } : {}),
};

export const viewport: Viewport = {
  // The colour at the very top of the page, so the phone's status bar blends into it.
  themeColor: '#070b1f',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  // Draw under the notch (the CSS pads content back with env(safe-area-inset-*)), and let the
  // on-screen keyboard shrink the layout on Android the way it already does on iPhone.
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <ConsentProvider>
          <div className="shell">
            <SiteHeader />
            <main id="main" className="main">
              {children}
            </main>
            <footer className="site-footer">
              <Link href="/how-to-play">How to play</Link>
              <Link href="/tips">Tips</Link>
              <Link href="/anime-quiz-questions">Quiz questions</Link>
              <Link href="/faq">FAQ</Link>
              <Link href="/privacy">Privacy</Link>
              <Link href="/cookies">Cookies</Link>
              <CookieSettingsButton />
              <Link href="/terms">Terms</Link>
              <Link href="/contact">Contact</Link>
              <div style={{ marginTop: 8 }}>
                Animellion is a fan-made game and is not affiliated with any anime studio or publisher.
              </div>
            </footer>
          </div>
        </ConsentProvider>
        <Analytics />
      </body>
    </html>
  );
}
