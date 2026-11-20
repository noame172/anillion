'use client';

import Link from 'next/link';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { apiFetch, type ApiError } from '@/lib/client/api';
import { FORM_LABELS } from '@/lib/game/forms';
import type { LeaderboardRow } from '@/lib/leaderboard';

type Scope = 'daily' | 'weekly' | 'monthly' | 'alltime';
const LABELS: Record<Scope, string> = { daily: 'Today', weekly: 'This week', monthly: 'This month', alltime: 'All time' };
const SCOPES = ['daily', 'weekly', 'monthly', 'alltime'] as const;
const MEDALS = [
  { icon: '🥇', name: 'First place' },
  { icon: '🥈', name: 'Second place' },
  { icon: '🥉', name: 'Third place' },
];
const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });

export default function LeaderboardPage() {
  const [scope, setScope] = useState<Scope>('daily');
  const [data, setData] = useState<{ rows: LeaderboardRow[]; date?: string; from?: string; to?: string } | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [known, setKnown] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    setError('');
    apiFetch(`/api/leaderboard?scope=${scope}`)
      .then(setData)
      .catch((e: ApiError) => setError(e.message));
  }, [scope]);

  useEffect(() => {
    apiFetch('/api/me')
      .then((m) => setMe(m.user?.username ?? null))
      .catch(() => {})
      .finally(() => setKnown(true));
  }, []);

  /** Arrow keys, Home and End move between the tabs, as in a native tab list. */
  function onTabKey(e: KeyboardEvent<HTMLButtonElement>) {
    const i = SCOPES.indexOf(scope);
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % SCOPES.length;
    else if (e.key === 'ArrowLeft') n = (i + SCOPES.length - 1) % SCOPES.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = SCOPES.length - 1;
    if (n < 0) return;
    e.preventDefault();
    setScope(SCOPES[n]);
    document.getElementById(`tab-${SCOPES[n]}`)?.focus();
  }

  return (
    <div className="stack">
      <h1 style={{ fontSize: 'clamp(28px, 6vw, 44px)', color: 'var(--yellow)' }}>Leaderboard</h1>
      <div className="tabs" role="tablist" aria-label="Leaderboard range">
        {SCOPES.map((s) => (
          <button
            key={s}
            id={`tab-${s}`}
            type="button"
            role="tab"
            className="tab"
            aria-selected={scope === s}
            aria-controls="board-panel"
            tabIndex={scope === s ? 0 : -1}
            onClick={() => setScope(s)}
            onKeyDown={onTabKey}
          >
            {LABELS[s]}
          </button>
        ))}
      </div>
      <section className="card" role="tabpanel" id="board-panel" aria-labelledby={`tab-${scope}`}>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {!data && !error && (
          <div className="loading" role="status">
            <div className="spinner" />
          </div>
        )}
        {data && data.rows.length === 0 && (
          <div className="empty-board center stack">
            <p className="muted" style={{ margin: 0 }}>
              {scope === 'daily'
                ? 'Nobody is on the board for today yet. The top spot is empty.'
                : scope === 'alltime'
                  ? 'No games on record yet. The first name on the board stays there until someone beats it.'
                  : `Nobody has finished a game ${scope === 'weekly' ? 'this week' : 'this month'} yet. The top spot is empty.`}
            </p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <Link href="/" className="btn">
                Play today&apos;s game
              </Link>
              {known && !me && (
                <Link href="/register" className="btn ghost">
                  Create an account to be listed
                </Link>
              )}
            </div>
          </div>
        )}
        {data && data.from && data.to && (
          <p className="hint" style={{ marginBottom: 10 }}>
            {fmt(data.from)} to {fmt(data.to)}. Points from every game finished in this period, so everyone can catch up.
          </p>
        )}
        {data && data.rows.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">
                {scope === 'daily' ? `Top scores for ${data.date}` : scope === 'alltime' ? 'Top total points of all time' : `Top total points, ${LABELS[scope].toLowerCase()}`}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Rank</th>
                  <th scope="col">Player</th>
                  <th scope="col">{scope === 'daily' ? 'Form' : 'Games'}</th>
                  <th scope="col" className="num">
                    {scope === 'daily' ? 'Score' : 'Total points'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.rank} className={r.username === me ? 'me' : undefined}>
                    <td>
                      {r.rank <= 3 ? (
                        <span role="img" aria-label={MEDALS[r.rank - 1].name}>
                          {MEDALS[r.rank - 1].icon}
                        </span>
                      ) : (
                        r.rank
                      )}
                    </td>
                    <td>
                      <strong>{r.username}</strong>
                      {r.username === me && <span className="tag" style={{ marginLeft: 8 }}>you</span>}
                    </td>
                    <td>{r.form ? FORM_LABELS[r.form] : r.games}</td>
                    <td className="num">
                      <strong>{r.score}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint" style={{ marginTop: 14 }}>
          Leaderboards list registered players only. Ties are broken by the faster finish.
          {known && !me && (
            <>
              {' '}
              Playing as a guest? <Link href="/register">Create an account</Link> and your scores count here.
            </>
          )}
        </p>
      </section>
    </div>
  );
}
