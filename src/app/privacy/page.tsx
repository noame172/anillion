import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: 'What data Anillion collects, why, and the choices you have.',
  alternates: { canonical: '/privacy' },
};

const adsOn = Boolean(process.env.NEXT_PUBLIC_ADSENSE_CLIENT);
const gaOn = Boolean(process.env.NEXT_PUBLIC_GA_ID);

export default function PrivacyPage() {
  return (
    <article className="prose">
      <h1>Privacy policy</h1>
      <p className="hint">Last updated: 13 November 2026</p>
      <p>
        This policy explains what Anillion collects when you play and what we do with it. The site operator should
        review this page with a legal adviser before launch and add their legal name and address.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Guest play.</strong> A random identifier is stored in a cookie on your device so your daily game,
          score and streak can be saved. It is not linked to your name or email.
        </li>
        <li>
          <strong>Accounts.</strong> If you register we store your email address, your chosen username, an optional
          profile picture link, and your game history. Passwords are handled by our authentication provider and are
          only ever stored as a one-way hash.
        </li>
        <li>
          <strong>Gameplay.</strong> The answers you submit, your scores and the times of your games. Answers are
          combined into anonymous statistics that decide how rare each answer is.
        </li>
        <li>
          <strong>Technical data.</strong> Your IP address is used briefly to limit abuse (for example, too many login
          attempts).
        </li>
      </ul>

      <h2>What is public</h2>
      <p>
        Leaderboards and shared result links show your username, profile picture, scores and streak. Your email address
        is never shown to other players.
      </p>

      <h2>Cookies</h2>
      <p>
        We always use a few <strong>necessary</strong> cookies: your guest identifier, your login session and a note of
        your cookie choice. Analytics and advertising cookies are{' '}
        {gaOn || adsOn
          ? `only used with your consent (${[gaOn && 'Google Analytics', adsOn && 'Google AdSense'].filter(Boolean).join(' and ')}).`
          : 'not used on this site at the moment, and would only ever be used with your consent.'}{' '}
        If you press “Reject all” we load nothing else and nothing is passed to any third party. Every cookie is listed
        in the <Link href="/cookies">cookie policy</Link>, where you can also change your choice.
      </p>

      <h2>Service providers</h2>
      <p>
        We use hosting, database and authentication providers to run the site. They process data on our behalf and only
        as needed to provide the service.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>Change your username or profile picture on your <Link href="/profile">profile</Link>.</li>
        <li>
          Delete your account from your profile page. This removes your email, username and personal history;
          anonymous statistics remain.
        </li>
        <li>Clear your browser cookies to remove a guest identifier.</li>
        <li><Link href="/contact">Contact us</Link> to ask for a copy of your data or to raise a concern.</li>
      </ul>

      <h2>Children</h2>
      <p>Anillion is not directed at children under 13, and we do not knowingly collect their personal data.</p>

      <h2>Changes</h2>
      <p>If this policy changes in a meaningful way we will update the date above and note the change here.</p>
    </article>
  );
}
