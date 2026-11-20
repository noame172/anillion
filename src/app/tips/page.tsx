import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Tips for scoring higher',
  description:
    'How to score more in Animellion: why the obvious anime answer earns the least, how rarity works, and how to use the 30-second timer.',
  alternates: { canonical: '/tips' },
};

export default function TipsPage() {
  return (
    <article className="prose">
      <h1>Tips for scoring higher in Animellion</h1>
      <p>
        Animellion rewards knowing anime, and also thinking differently from everyone else. Here is how the scoring
        works in practice, and a few habits that help. The exact numbers are on the{' '}
        <Link href="/how-to-play">how to play</Link> page.
      </p>

      <h2>The obvious answer is worth the least</h2>
      <p>
        An answer is worth 25 points if more than 10% of players gave it, and 100 points if 1% or fewer did. Ask
        “Name a One Piece character” and most people type Luffy, so Luffy is a Common answer. A less famous crew member,
        a villain from a single arc or a side character earns far more.
      </p>

      <figure className="demo" aria-label="Example prompt">
        <figcaption>A worked example</figcaption>
        <p className="demo-q">Name a One Piece character.</p>
        <ul className="demo-answers">
          <li>
            <span className="tier-badge tier-common">Common</span> Luffy <b>25</b>
          </li>
          <li>
            <span className="tier-badge tier-rare">Rare</span> Usopp <b>50</b>
          </li>
          <li>
            <span className="tier-badge tier-epic">Epic</span> Kuro <b>75</b>
          </li>
          <li>
            <span className="tier-badge tier-ultra">Ultra Answer</span> Dr. Hogback <b>100</b>
          </li>
        </ul>
        <p className="demo-note">Illustrative tiers only. Real ones come from what players actually answer each day.</p>
      </figure>

      <h2>Think one step past the first name that comes to mind</h2>
      <ul>
        <li>For a series, skip the lead and the main rival. Think of a character from the middle of the cast.</li>
        <li>For a genre or year, skip the shows everybody names first. Think of one you watched but rarely hear about.</li>
        <li>For a studio, pick a smaller production rather than its biggest hit.</li>
        <li>Rare is only worth it if the answer is accepted, so do not trade accuracy for obscurity.</li>
      </ul>

      <h2>Use the 30-second timer</h2>
      <ul>
        <li>An answer that is not recognised costs nothing, so you can keep trying until time runs out.</li>
        <li>Your first accepted answer locks the prompt, so decide before you press enter.</li>
        <li>Spend the first seconds thinking of two or three candidates, then enter the rarest one you are sure of.</li>
      </ul>

      <h2>Build a streak</h2>
      <p>
        Play every day to keep your streak going. <Link href="/register">Create an account</Link> to keep your history
        and appear on the <Link href="/leaderboard">leaderboard</Link>.
      </p>

      <p>
        <Link href="/" className="btn">Play today&apos;s game</Link>
      </p>
    </article>
  );
}
