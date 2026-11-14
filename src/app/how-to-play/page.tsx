import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'How to play',
  description: 'How Animellion works: seven anime prompts a day, thirty seconds each, and rarer answers score more.',
  alternates: { canonical: '/how-to-play' },
};

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
      </ul>

      <h2>Points</h2>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Rarity</th>
              <th scope="col">Share of players who said it</th>
              <th scope="col" className="num">Points</th>
            </tr>
          </thead>
          <tbody>
            <tr><td><span className="tier-badge tier-common">Common</span></td><td>More than 10%</td><td className="num">25</td></tr>
            <tr><td><span className="tier-badge tier-rare">Rare</span></td><td>More than 3%, up to 10%</td><td className="num">50</td></tr>
            <tr><td><span className="tier-badge tier-epic">Epic</span></td><td>More than 1%, up to 3%</td><td className="num">75</td></tr>
            <tr><td><span className="tier-badge tier-ultra">Ultra Answer</span></td><td>1% or less</td><td className="num">100</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        Rarity comes from what earlier players actually answered. It is frozen when the day&apos;s game opens, so an
        answer is worth the same to everyone all day. A prompt that is still new shows “New” instead of a percentage:
        its rarity is a provisional estimate until enough players have answered.
      </p>

      <h2>Power levels</h2>
      <p>Your hero powers up as your total score climbs:</p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th scope="col">Form</th><th scope="col" className="num">Total score</th></tr>
          </thead>
          <tbody>
            <tr><td>Base Form</td><td className="num">0 – 199</td></tr>
            <tr><td>Ascended</td><td className="num">200 – 349</td></tr>
            <tr><td>Azure Ascended</td><td className="num">350 – 499</td></tr>
            <tr><td>Ultra Form</td><td className="num">500+</td></tr>
          </tbody>
        </table>
      </div>

      <h2>Streaks and leaderboards</h2>
      <p>
        Finish a game on consecutive days to build a streak. <Link href="/register">Create an account</Link> to appear
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
