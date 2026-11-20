import type { Metadata } from 'next';
import Link from 'next/link';

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export const metadata: Metadata = {
  title: 'Animellion FAQ',
  description: 'Answers to common questions about Animellion, the free daily anime guessing game: scoring, rarity, the timer and accounts.',
  alternates: { canonical: '/faq' },
};

const FAQ: { q: string; a: string }[] = [
  { q: 'What is Animellion?', a: 'Animellion is a free daily anime guessing game. Everyone gets the same seven anime prompts each day and has thirty seconds to answer each one.' },
  { q: 'How many games can I play a day?', a: 'One. A new game is available every day, and everyone gets the same prompts.' },
  { q: 'How do I score points?', a: 'The fewer players who gave the same answer as you, the more it is worth: 25 points for a common answer, 50 for rare, 75 for epic and 100 for an Ultra Answer.' },
  { q: 'What is an Ultra Answer?', a: 'An answer given by 1% of players or fewer. It is the most valuable answer you can give, worth 100 points.' },
  { q: 'What happens if I type a wrong answer?', a: 'Nothing is lost. Wrong or unrecognised guesses cost no points, so you can keep trying until the thirty seconds run out.' },
  { q: 'Can I skip a prompt I do not know?', a: 'Yes. Press Pass, then tap again to confirm. The prompt scores 0, the same as running out of time, but you do not have to wait for the timer. You cannot come back to it.' },
  { q: 'Can I change an answer after I submit it?', a: 'No. Your first valid answer scores and locks that prompt.' },
  { q: 'My answer was right but was not accepted. What now?', a: 'Answers are checked against a reviewed list. Unrecognised answers are logged for review, and correct ones are added for future games.' },
  { q: 'Do I need an account?', a: 'An account is needed to appear on the leaderboard and to keep your history on every device.' },
  { q: 'What are the power levels?', a: 'Your hero powers up as your total score grows: Base Form, Ascended, Azure Ascended and Ultra Form.' },
  { q: 'What kind of prompts will I get?', a: 'Characters from popular series, anime studios, genres, release years, movies and more. See the list on the anime quiz questions page.' },
];

export default function FaqPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    url: `${siteUrl}/faq`,
    mainEntity: FAQ.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
  return (
    <article className="prose">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <h1>Animellion FAQ</h1>
      {FAQ.map((f) => (
        <div key={f.q}>
          <h2>{f.q}</h2>
          <p>{f.a}</p>
          {f.q === 'How do I score points?' && (
            <figure className="demo" aria-label="Example prompt">
              <figcaption>A worked example</figcaption>
              <p className="demo-q">Name a One Piece character.</p>
              <ul className="demo-answers">
                <li>
                  <span className="tier-badge tier-common">Common</span> Luffy <b>25</b>
                </li>
                <li>
                  <span className="tier-badge tier-ultra">Ultra Answer</span> Dr. Hogback <b>100</b>
                </li>
              </ul>
              <p className="demo-note">Illustrative tiers only. Real ones come from what players actually answer each day.</p>
            </figure>
          )}
        </div>
      ))}
      <p>
        More detail: <Link href="/how-to-play">how to play</Link>, <Link href="/tips">tips for scoring higher</Link>,{' '}
        <Link href="/anime-quiz-questions">anime quiz questions</Link>.
      </p>
    </article>
  );
}
