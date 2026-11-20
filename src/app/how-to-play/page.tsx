import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'How to play',
  description: 'How Animellion works: seven anime prompts a day, thirty seconds each, and rarer answers score more.',
  alternates: { canonical: '/how-to-play' },
};

const FORM_STEPS = [
  { form: 'base', name: 'Base Form', range: '0 to 199 points' },
  { form: 'ascended', name: 'Ascended', range: '200 to 349' },
  { form: 'azure', name: 'Azure Ascended', range: '350 to 499' },
  { form: 'ultra', name: 'Ultra Form', range: '500 and up' },
] as const;

export default function HowToPlayPage() {
  return (
    <article className="prose">
      <h1>How to play</h1>
      <p>
        Every day Animellion asks everyone the same seven anime prompts, such as “Name a One Piece character”. Type one
        answer for each. The fewer players who gave your answer, the more it is worth.
      </p>

      <h2>The round</h2>
      <ul>
        <li>Press <strong>Power Up</strong> to begin. You get one game per day.</li>
        <li>Each prompt has a <strong>30-second timer</strong>.</li>
        <li>Wrong or unrecognised guesses cost nothing. Keep trying until the time runs out.</li>
        <li>Your first valid answer scores and locks the prompt. You cannot change it afterwards.</li>
        <li>If the timer runs out, the prompt scores 0 and you move on.</li>
        <li>Don&apos;t know one? Press <strong>Pass</strong> (and tap again to confirm) to skip it. It scores 0, the same as running out of time, without the wait.</li>
      </ul>

      <h2>Points</h2>
      <ul className="tier-list">
        <li>
          <span className="tier-badge tier-common">Common</span>
          <span className="share">More than 10% of players said it</span>
          <span className="pts">25</span>
        </li>
        <li>
          <span className="tier-badge tier-rare">Rare</span>
          <span className="share">More than 3%, up to 10%</span>
          <span className="pts">50</span>
        </li>
        <li>
          <span className="tier-badge tier-epic">Epic</span>
          <span className="share">More than 1%, up to 3%</span>
          <span className="pts">75</span>
        </li>
        <li>
          <span className="tier-badge tier-ultra">Ultra Answer</span>
          <span className="share">1% of players or fewer</span>
          <span className="pts">100</span>
        </li>
      </ul>
      <p>
        Rarity comes from what earlier players actually answered. It is frozen when the day&apos;s game opens, so an
        answer is worth the same to everyone all day. A prompt that is still new shows “New” instead of a percentage:
        its rarity is a provisional estimate until enough players have answered.
      </p>

      <h2>Power levels</h2>
      <p>Your hero powers up as your total score climbs:</p>
      <ol className="form-ladder">
        {FORM_STEPS.map((f) => (
          <li key={f.form}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/hero/${f.form}/hero.svg`} alt="" width={60} height={80} loading="lazy" />
            <strong>{f.name}</strong>
            <span>{f.range}</span>
          </li>
        ))}
      </ol>

      <h2>Streaks and leaderboards</h2>
      <p>
        Finish a game on consecutive days to build a streak. Every 7th day of a streak earns a <strong>streak freeze</strong>
        (you can bank 2). If you miss a single day, a freeze covers it automatically and your streak carries on; missing
        two days in a row ends it. <Link href="/register">Create an account</Link> to appear
        on the <Link href="/leaderboard">leaderboard</Link> and keep your history on every device.
      </p>

      <h2>My answer was right but was not accepted</h2>
      <p>
        Answers are checked against a reviewed list. Unrecognised answers are logged for review, and correct ones are
        added for future games.
      </p>
      <p>
        <Link href="/" className="btn">Play today&apos;s game</Link>
      </p>
    </article>
  );
}
