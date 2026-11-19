import type { Metadata } from 'next';
import Link from 'next/link';
import { query } from '@/lib/db/client';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Anime quiz questions',
  description:
    'Browse the anime prompts that can appear in Animellion: characters from popular series, studios, genres, release years and more.',
  alternates: { canonical: '/anime-quiz-questions' },
};

const SECTIONS: { title: string; test: (c: string) => boolean }[] = [
  { title: 'Anime studios', test: (c) => c === 'Studios' || c === 'Studio Ghibli' || c.startsWith('Studio:') },
  { title: 'Genres and themes', test: (c) => c === 'Genre' },
  { title: 'Release years and eras', test: (c) => c === 'Era' },
  { title: 'Episode counts, formats and sources', test: (c) => ['Length', 'Format', 'Source', 'Movies', 'Anime'].includes(c) },
  { title: 'People, manga and more', test: (c) => ['People', 'Manga', 'Light Novels', 'Pokémon'].includes(c) },
];

type Row = { text: string; category: string };

export default async function QuestionsPage() {
  let rows: Row[] = [];
  try {
    // Only the prompts are listed. The accepted answers stay secret, so the game is not spoiled.
    rows = await query<Row>(`select text, category from questions where active order by category, text`);
  } catch {
    rows = [];
  }
  const used = new Set<string>();
  const groups = SECTIONS.map((s) => {
    const items = rows.filter((r) => s.test(r.category));
    for (const r of items) used.add(r.text);
    return { title: s.title, items };
  });
  const series = rows.filter((r) => !used.has(r.text));

  return (
    <article className="prose">
      <h1>Anime quiz questions</h1>
      <p>
        Every day <Link href="/">Animellion</Link> picks seven prompts like these.
        {rows.length > 0 ? ` There are ${rows.length} prompts in the game right now.` : ''} The answers are not listed
        here, so the daily game stays a surprise. See <Link href="/tips">tips for scoring higher</Link> or{' '}
        <Link href="/how-to-play">how to play</Link>.
      </p>
      {series.length > 0 && (
        <section>
          <h2>Characters from popular anime</h2>
          <ul>
            {series.map((r) => (
              <li key={r.text}>{r.text}</li>
            ))}
          </ul>
        </section>
      )}
      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <section key={g.title}>
            <h2>{g.title}</h2>
            <ul>
              {g.items.map((r) => (
                <li key={r.text}>{r.text}</li>
              ))}
            </ul>
          </section>
        ))}
      <p>
        <Link href="/" className="btn">Play today&apos;s game</Link>
      </p>
    </article>
  );
}
