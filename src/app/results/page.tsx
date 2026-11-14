'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type CSSProperties } from 'react';
import { AllAnswers } from '@/components/AllAnswers';
import { AdSlot } from '@/components/Consent';
import { Countdown } from '@/components/Countdown';
import { Hero } from '@/components/Hero';
import { ShareButton } from '@/components/ShareButton';
import { useAscend } from '@/components/useAscend';
import { apiFetch, type ApiError } from '@/lib/client/api';
import { FORM_LABELS } from '@/lib/game/forms';
import { shareText } from '@/lib/game/share-text';
import type { GameState } from '@/lib/game/session';
import { TIER_LABELS } from '@/lib/game/tiers';

const VERDICT = {
  base: 'A solid warm-up. Dig for deeper cuts tomorrow.',
  ascended: 'You broke through! Rare knowledge pays.',
  azure: 'Blazing blue. Few reach this level.',
  ultra: 'Ultra Form. That was a legendary run.',
} as const;

function shareCell(share: number | null, timedOut: boolean) {
  if (timedOut) return '—';
  if (share === null) return 'New';
  return `${share < 0.1 && share > 0 ? '<0.1' : share}%`;
}

function Results() {
  const date = useSearchParams().get('date');
  const [data, setData] = useState<{ state: GameState; streak: number; guest: boolean } | null>(null);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  // The hero climbs from base to the final form, then the numbers appear.
  const hero = useAscend();
  const [shown, setShown] = useState(false);
  const { ascend } = hero;
  const finalForm = data?.state.form;

  useEffect(() => {
    if (finalForm) ascend(finalForm, () => setShown(true));
  }, [finalForm, ascend]);

  useEffect(() => {
    let current = true;
    const load = /^\d{4}-\d{2}-\d{2}$/.test(date ?? '')
      ? apiFetch(`/api/game/result?date=${date}`).then((r) => ({ state: r.state as GameState, streak: r.streak, guest: false }))
      : apiFetch('/api/game/today').then((r) => {
          if (!r.state) throw Object.assign(new Error('none'), { code: 'NOT_FOUND' });
          return { state: r.state as GameState, streak: r.streak, guest: r.viewer.kind === 'guest' };
        });
    load
      .then((d) => current && setData(d))
      .catch((e: ApiError) => current && (e.code === 'NOT_FOUND' ? setMissing(true) : setError(e.message)));
    return () => {
      current = false;
    };
  }, [date]);

  if (missing) {
    return (
      <div className="narrow card center stack">
        <h1>No result yet</h1>
        <p>You have not played this game.</p>
        <Link href="/" className="btn">
          Go to today&apos;s game
        </Link>
      </div>
    );
  }
  if (error) {
    return (
      <p className="notice warn narrow" role="alert">
        {error}
      </p>
    );
  }
  if (!data) {
    return (
      <div className="loading" role="status">
        <div>
          <div className="spinner" />
          Tallying your power…
        </div>
      </div>
    );
  }

  const { state, streak } = data;
  const shareUrl = `${window.location.origin}/share/${state.sessionId}`;
  const text = shareText(state);

  return (
    <div className="stack">
      {hero.arrived && (
        <div className="transform-flash" data-form={hero.arrived} style={{ '--aura': 'rgba(255,220,120,0.9)' } as CSSProperties} aria-hidden="true">
          <div className="word">{FORM_LABELS[hero.arrived]}!</div>
        </div>
      )}
      <section className="card">
        <div className="results-top">
          <Hero form={hero.form} size={190} burst={hero.burst} />
          <div className="stack fade-in" style={{ gap: 10, visibility: shown ? 'visible' : 'hidden' }} key={String(shown)}>
            <div className="chip" style={{ justifySelf: 'start' }}>
              Game #{state.gameNumber} · {state.date}
              {!state.completed && ' · unfinished'}
            </div>
            <div>
              <div className="label">Final score</div>
              <div className="big-score">{state.score}</div>
            </div>
            <div>
              <div className="label">Final form</div>
              <h1 className="form-name" data-form={state.form} style={{ fontSize: 'clamp(24px, 5vw, 36px)' }}>
                {FORM_LABELS[state.form]}
              </h1>
              <p className="muted" style={{ margin: '6px 0 0' }}>
                {VERDICT[state.form]}
              </p>
            </div>
          </div>
        </div>

        <div className="stat-grid" style={{ marginTop: 18 }}>
          <div className="stat">
            <div className="k">Prompts done</div>
            <div className="v">
              {state.position}/{state.total}
            </div>
          </div>
          <div className="stat">
            <div className="k">Valid answers</div>
            <div className="v">
              {state.validAnswers}/{state.total}
            </div>
          </div>
          <div className="stat">
            <div className="k">Streak</div>
            <div className="v">🔥 {streak}</div>
          </div>
          <div className="stat">
            <div className="k">Next game in</div>
            <div className="v" style={{ fontSize: 18 }}>
              <Countdown to={state.nextGameAt} />
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Answer breakdown</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Prompt</th>
                <th scope="col">Your answer</th>
                <th scope="col">Rarity</th>
                <th scope="col" className="num">
                  Players
                </th>
                <th scope="col" className="num">
                  Points
                </th>
              </tr>
            </thead>
            <tbody>
              {state.answers.map((a) => (
                <tr key={a.position}>
                  <td>{a.position + 1}</td>
                  <td>{a.question}</td>
                  <td>
                    <strong>{a.answer ?? (a.timedOut ? 'Time ran out' : '—')}</strong>
                  </td>
                  <td>
                    {a.tier ? (
                      <span className={`tier-badge tier-${a.tier}`} style={{ fontSize: 11, padding: '3px 9px' }}>
                        {TIER_LABELS[a.tier]}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="num" title={a.provisional ? 'Provisional rarity: not enough player data yet' : undefined}>
                    {shareCell(a.share, a.timedOut)}
                  </td>
                  <td className="num">
                    <strong>+{a.points}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} className="num">
                  <strong>Total</strong>
                </td>
                <td className="num">
                  <strong>{state.score}</strong>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="hint">
          “Players” is the share of earlier players who gave the same answer. “New” means the answer is too fresh for
          real data, so its rarity is provisional.
        </p>
      </section>

      {state.completed && <AllAnswers date={state.date} />}

      {state.completed && (
        <section className="card stack">
          <h2>Share your power level</h2>
          <pre className="notice" style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
            {text}
            {'\n'}
            {shareUrl}
          </pre>
          <div className="row">
            <ShareButton text={text} url={shareUrl} />
            <Link href="/leaderboard" className="btn ghost">
              Leaderboard
            </Link>
            {data.guest && (
              <Link href="/register" className="btn ghost">
                Save progress: create account
              </Link>
            )}
          </div>
        </section>
      )}

      <AdSlot slot={process.env.NEXT_PUBLIC_ADSENSE_SLOT_RESULTS} />
    </div>
  );
}

export default function ResultsPage() {
  return (
    <Suspense fallback={<div className="loading">Loading…</div>}>
      <Results />
    </Suspense>
  );
}
