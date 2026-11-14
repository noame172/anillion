'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AdSlot } from '@/components/Consent';
import { Countdown } from '@/components/Countdown';
import { Hero } from '@/components/Hero';
import { apiFetch, type ApiError } from '@/lib/client/api';
import type { GameState } from '@/lib/game/session';

type Today = {
  available: boolean;
  date: string | null;
  gameNumber: number | null;
  questionCount: number | null;
  timeLimitSec: number | null;
  state: GameState | null;
  streak: number;
  nextGameAt: string;
  viewer: { kind: 'user' | 'guest'; username?: string };
};

export function HomeClient() {
  const router = useRouter();
  const [today, setToday] = useState<Today | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setError('');
    setSlow(false);
    const slowTimer = setTimeout(() => setSlow(true), 4000);
    apiFetch<Today>('/api/game/today')
      .then((t) => current && setToday(t))
      .catch((e: ApiError) => current && setError(e.message))
      .finally(() => clearTimeout(slowTimer));
    return () => {
      current = false;
      clearTimeout(slowTimer);
    };
  }, [attempt]);

  const state = today?.state ?? null;
  const done = Boolean(state?.completed);
  const inProgress = Boolean(state && !state.completed);
  const count = today?.questionCount ?? 7;
  const limit = today?.timeLimitSec ?? 30;

  function powerUp() {
    setStarting(true);
    router.push(done ? '/results' : '/play');
  }

  return (
    <div className="home">
      <h1 className="wordmark">ANIMELLION</h1>
      <p className="tagline display">THE DAILY POWER-UP</p>
      <p className="subline">
        {count} prompts · {limit} seconds each · rarer answers charge higher
      </p>

      <Hero form={state?.form ?? 'base'} size={210} />

      <div className="home-cta">
        {error && (
          <p className="notice warn" role="alert">
            {error}
          </p>
        )}
        {today && !today.available ? (
          <div className="notice">
            Today&apos;s game is not ready yet. Next game in <Countdown to={today.nextGameAt} />.
          </div>
        ) : (
          <button
            type="button"
            className="btn power"
            onClick={error && !today ? () => setAttempt((n) => n + 1) : powerUp}
            disabled={starting}
            aria-busy={!today && !error}
          >
            {/* Usable straight away: the play page finds today's game itself, or sends a finished player to the results. */}
            {error && !today
              ? 'TRY AGAIN'
              : starting
                ? 'STARTING…'
                : done
                  ? 'VIEW RESULTS'
                  : inProgress
                    ? 'CONTINUE'
                    : '⚡ POWER UP ⚡'}
          </button>
        )}
        {slow && !today && !error && (
          <p className="hint" role="status">
            Still fetching today&apos;s game. You can already press Power Up.
          </p>
        )}

        <div className="home-meta">
          <span className="chip">{today?.gameNumber ? `Game #${today.gameNumber}` : 'Daily game'}</span>
          {today && today.streak > 0 && <span className="chip hot">🔥 {today.streak}-day streak</span>}
          <span className="row" style={{ gap: 8 }}>
            <Link href="/leaderboard" className="btn ghost">
              Leaderboard
            </Link>
            <Link href="/profile" className="btn ghost">
              History
            </Link>
          </span>
        </div>

        {done && today && (
          <p className="hint">
            You scored <strong>{state!.score}</strong> today. Next game in <Countdown to={today.nextGameAt} />.
          </p>
        )}
        {today?.viewer.kind === 'guest' && (
          <p className="hint">
            Playing as a guest: progress stays on this device. <Link href="/register">Create an account</Link> to keep
            your streak everywhere.
          </p>
        )}
      </div>

      <AdSlot slot={process.env.NEXT_PUBLIC_ADSENSE_SLOT_HOME} />
    </div>
  );
}
