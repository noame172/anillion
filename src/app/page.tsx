import type { Metadata } from 'next';
import Link from 'next/link';
import { HomeClient } from '@/components/HomeClient';

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

const title = 'Animellion — Daily Anime Guessing Game & Quiz';
const description =
  'Animellion is a free daily anime guessing game. Answer seven anime prompts, thirty seconds each. The rarer your answer, the more points you earn. A new game every day.';

export const metadata: Metadata = {
  title: { absolute: title },
  description,
  alternates: { canonical: '/' },
  openGraph: { type: 'website', siteName: 'Animellion', title, description, url: siteUrl },
  twitter: { card: 'summary_large_image', title, description },
};

/** Shown on the page and repeated in the structured data below, so both always say the same thing. */
const FAQ: { q: string; a: string }[] = [
  {
    q: 'What is Animellion?',
    a: 'Animellion is a free daily anime guessing game. Every day everyone gets the same seven anime prompts, such as “Name a One Piece character”, and has thirty seconds to answer each one.',
  },
  {
    q: 'How is the score worked out?',
    a: 'The fewer players who gave the same answer, the more it is worth. Common answers score the least and rare answers score the most, so the obvious pick is rarely the best one.',
  },
  {
    q: 'Is Animellion free?',
    a: 'Yes. You can play as a guest without an account. Creating a free account keeps your streak and your history on every device.',
  },
  {
    q: 'When does the next game start?',
    a: 'A new game is released every day. The home page shows a countdown to the next one once you have finished today’s game.',
  },
];

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${siteUrl}/#website`,
      url: siteUrl,
      name: 'Animellion',
      description,
      inLanguage: 'en',
    },
    {
      '@type': 'VideoGame',
      '@id': `${siteUrl}/#game`,
      name: 'Animellion',
      url: siteUrl,
      description,
      genre: ['Trivia', 'Puzzle'],
      applicationCategory: 'Game',
      gamePlatform: 'Web browser',
      operatingSystem: 'Any',
      inLanguage: 'en',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    },
    {
      '@type': 'FAQPage',
      mainEntity: FAQ.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
  ],
};

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        // "<" is escaped so the JSON can never close the script tag early.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <HomeClient />
      <section className="prose home-about" aria-labelledby="about-heading">
        <h2 id="about-heading">The daily anime guessing game</h2>
        <p>
          Animellion tests how well you know anime, and how differently you think from everyone else. Each day there are
          seven prompts, and the rarer your answer, the more power you gain.{' '}
          <Link href="/how-to-play">Read how to play</Link> or check the <Link href="/leaderboard">leaderboard</Link>.
        </p>
        {FAQ.map((f) => (
          <div key={f.q}>
            <h3>{f.q}</h3>
            <p>{f.a}</p>
          </div>
        ))}
      </section>
    </>
  );
}
