import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of service',
  description: 'The rules for using Anillion.',
  alternates: { canonical: '/terms' },
};

export default function TermsPage() {
  return (
    <article className="prose">
      <h1>Terms of service</h1>
      <p className="hint">Last updated: 13 November 2026</p>
      <p>
        By using Anillion you agree to these terms. The site operator should review this page with a legal adviser
        before launch and add their legal name and governing law.
      </p>

      <h2>The game</h2>
      <p>
        Anillion is a free daily guessing game provided as is, for entertainment. Questions, accepted answers and
        rarity scores are decided by us and may be corrected at any time.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>Keep your login details to yourself. You are responsible for activity on your account.</li>
        <li>Choose a username that is not offensive, misleading or someone else&apos;s name or brand.</li>
        <li>You may delete your account at any time from your profile.</li>
      </ul>

      <h2>Fair play</h2>
      <ul>
        <li>One daily game per person. Do not use multiple accounts or guest identities to replay a game.</li>
        <li>Do not use bots, scripts or other automation to play or to submit answers.</li>
        <li>Do not attempt to tamper with scores, leaderboards, other players&apos; data or the service itself.</li>
      </ul>
      <p>We may remove scores, suspend or close accounts that break these rules.</p>

      <h2>Content and trademarks</h2>
      <p>
        Anillion is an unofficial fan-made game. Anime titles, character names and studio names belong to their
        respective owners and are referred to only as trivia. Anillion is not affiliated with or endorsed by any of
        them. If you are a rights holder with a concern, please <Link href="/contact">contact us</Link>.
      </p>

      <h2>Availability and liability</h2>
      <p>
        We try to keep the game running but do not guarantee it will always be available or error free. To the extent
        the law allows, we are not liable for losses arising from your use of the site.
      </p>

      <h2>Changes</h2>
      <p>We may update these terms. Continuing to play after a change means you accept the updated terms.</p>
      <p>
        See also our <Link href="/privacy">privacy policy</Link>.
      </p>
    </article>
  );
}
