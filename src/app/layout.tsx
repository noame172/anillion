import type { Metadata, Viewport } from 'next';
import { Bungee, Rubik } from 'next/font/google';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ConsentProvider } from '@/components/Consent';
import { SiteHeader } from '@/components/SiteHeader';
import './globals.css';

const display = Bungee({ weight: '400', subsets: ['latin'], variable: '--font-display', display: 'swap' });
const body = Rubik({ subsets: ['latin'], variable: '--font-body', display: 'swap' });

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const description =
  'Anillion is the daily anime guessing game. Seven prompts, thirty seconds each. The rarer your answer, the more power you gain.';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: 'Anillion — the daily anime power-up', template: '%s · Anillion' },
  description,
  applicationName: 'Anillion',
  keywords: ['anime game', 'daily game', 'anime quiz', 'anime trivia', 'guessing game'],
  openGraph: { type: 'website', siteName: 'Anillion', title: 'Anillion — the daily anime power-up', description, url: siteUrl },
  twitter: { card: 'summary_large_image', title: 'Anillion — the daily anime power-up', description },
  alternates: { canonical: '/' },
};

export const viewport: Viewport = { themeColor: '#0c1233', width: 'device-width', initialScale: 1 };

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
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
              <Link href="/contact">Contact</Link>
              <div style={{ marginTop: 8 }}>
                Anillion is a fan-made game and is not affiliated with any anime studio or publisher.
              </div>
            </footer>
          </div>
        </ConsentProvider>
      </body>
    </html>
  );
}
