'use client';

import { useEffect, useState } from 'react';
import { apiFetch, type ApiError } from '@/lib/client/api';
import { FORM_LABELS } from '@/lib/game/forms';
import type { LeaderboardRow } from '@/lib/leaderboard';

type Scope = 'daily' | 'alltime';

export default function LeaderboardPage() {
  const [scope, setScope] = useState<Scope>('daily');
  const [data, setData] = useState<{ rows: LeaderboardRow[]; date?: string } | null>(null);
  const [me, setMe] = useState<string | null>(null);
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
      .catch(() => {});
  }, []);

  return (
    <div className="stack">
      <h1 style={{ fontSize: 'clamp(28px, 6vw, 44px)', color: 'var(--yellow)' }}>Leaderboard</h1>
      <div className="tabs" role="tablist" aria-label="Leaderboard range">
        {(['daily', 'alltime'] as const).map((s) => (
          <button key={s} type="button" role="tab" className="tab" aria-selected={scope === s} onClick={() => setScope(s)}>
            {s === 'daily' ? 'Today' : 'All time'}
          </button>
        ))}
      </div>
      <section className="card" role="tabpanel">
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
          <p className="muted center">
            {scope === 'daily'
              ? 'No registered player has finished today’s game yet. Be the first!'
              : 'No games on record yet.'}
          </p>
        )}
        {data && data.rows.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">
                {scope === 'daily' ? `Top scores for ${data.date}` : 'Top total points of all time'}
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
                    <td>{r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}</td>
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
        </p>
      </section>
    </div>
  );
}
