import type { Metadata } from 'next';
import Link from 'next/link';
import { CookieSettingsButton } from '@/components/Consent';

export const metadata: Metadata = {
  title: 'Cookie policy',
  description: 'Which cookies Anillion uses, what each one is for, and how to change your choice.',
  alternates: { canonical: '/cookies' },
};

const gaOn = Boolean(process.env.NEXT_PUBLIC_GA_ID);
const adsOn = Boolean(process.env.NEXT_PUBLIC_ADSENSE_CLIENT);

export default function CookiePolicyPage() {
  return (
    <article className="prose">
      <h1>Cookie policy</h1>
      <p className="hint">Last updated: 14 November 2026</p>
      <p>
        Cookies are small files a website stores in your browser. This page lists every cookie Anillion uses, in plain
        words, so you can decide what to allow. The site operator should review it with a legal adviser before launch
        and add their legal name and address.
      </p>
      <p>
        <CookieSettingsButton className="btn small" />
      </p>

      <h2>Your choice</h2>
      <ul>
        <li>
          The first time you visit, a banner asks you to <strong>Reject all</strong>, <strong>Accept all</strong> or{' '}
          <strong>Choose</strong>. The buttons are the same size on purpose.
        </li>
        <li>
          <strong>If you reject</strong>, we use only the necessary cookies below. No analytics script and no
          advertising script is loaded, no third party receives anything about your visit, and any optional cookies
          already on your device are deleted.
        </li>
        <li>
          Until you choose, optional cookies stay off. We remember your choice for six months and then ask again.
        </li>
        <li>
          If your browser sends the <strong>Global Privacy Control</strong> signal we treat it as “Reject all”.
        </li>
        <li>You can change your mind at any time with “Cookie settings” in the footer or the button above.</li>
      </ul>

      <h2>Necessary cookies</h2>
      <p>These make the game work, so they are used without asking. You can delete them in your browser; the game will then forget your guest progress.</p>
      <div className="table-wrap">
        <table className="cookie-table">
          <thead>
            <tr>
              <th scope="col">Cookie</th>
              <th scope="col">What it does</th>
              <th scope="col">Lasts</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>an_guest</code></td>
              <td>A random identifier, so your daily game, score and streak are saved when you play without an account. It is not linked to your name or email.</td>
              <td>1 year</td>
            </tr>
            <tr>
              <td><code>sb-…-auth-token</code></td>
              <td>Keeps you logged in after you sign in (set by our authentication provider, Supabase). Not set if you never log in.</td>
              <td>Until you log out, or the session expires</td>
            </tr>
            <tr>
              <td><code>an_session</code></td>
              <td>The login session used when the site runs without Supabase (local development only).</td>
              <td>30 days</td>
            </tr>
            <tr>
              <td><code>an_consent</code></td>
              <td>Remembers your cookie choice so we do not ask on every page.</td>
              <td>6 months</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Analytics cookies (only if you allow them)</h2>
      <p>
        {gaOn
          ? 'This site uses Google Analytics to count visits and see which pages are used. It only loads if you accept analytics.'
          : 'This site does not use analytics at the moment. If that changes, it will only load if you accept analytics.'}
      </p>
      <div className="table-wrap">
        <table className="cookie-table">
          <thead>
            <tr>
              <th scope="col">Cookie</th>
              <th scope="col">What it does</th>
              <th scope="col">Lasts</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>_ga</code></td>
              <td>Google Analytics: tells returning visitors apart. IP addresses are anonymised.</td>
              <td>2 years</td>
            </tr>
            <tr>
              <td><code>_ga_&lt;id&gt;</code></td>
              <td>Google Analytics: keeps session state.</td>
              <td>2 years</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Advertising cookies (only if you allow them)</h2>
      <p>
        {adsOn
          ? 'This site may show Google AdSense ads outside the game screen. The ad script only loads if you accept advertising; ads never appear during play.'
          : 'This site does not show ads at the moment. If that changes, the ad script will only load if you accept advertising, and ads will never appear during play.'}
      </p>
      <div className="table-wrap">
        <table className="cookie-table">
          <thead>
            <tr>
              <th scope="col">Cookie</th>
              <th scope="col">What it does</th>
              <th scope="col">Lasts</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>__gads</code>, <code>__gpi</code></td>
              <td>Google AdSense: choose and measure ads and limit how often you see the same one.</td>
              <td>Up to 13 months</td>
            </tr>
            <tr>
              <td><code>IDE</code>, <code>test_cookie</code></td>
              <td>Google (doubleclick.net): advertising and checking that your browser accepts cookies.</td>
              <td>Up to 13 months</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Google acts as an independent controller for these cookies. See{' '}
        <a href="https://policies.google.com/technologies/cookies" rel="noopener noreferrer">how Google uses cookies</a>.
      </p>

      <h2>What we do not do</h2>
      <ul>
        <li>We do not sell your data.</li>
        <li>We do not use cookies to follow you across other websites.</li>
        <li>
          The answers you give are combined into anonymous totals (how many players gave each answer) to decide how rare
          an answer is. These totals are not tied to you. See the <Link href="/privacy">privacy policy</Link>.
        </li>
      </ul>

      <h2>Browser settings</h2>
      <p>
        You can also block or delete cookies in your browser settings. Blocking the necessary cookies will stop guest
        progress and login from working.
      </p>
    </article>
  );
}
