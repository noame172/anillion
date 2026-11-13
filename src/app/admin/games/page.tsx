'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { adminCall, useAdmin } from '@/components/admin/useAdmin';

export default function AdminGamesPage() {
  const router = useRouter();
  const { data, error } = useAdmin('games');
  const [date, setDate] = useState('');
  const [formError, setFormError] = useState('');

  async function create(e: FormEvent) {
    e.preventDefault();
    const res = await adminCall('games', 'POST', { date });
    if (res.error) setFormError(res.error);
    else router.push(`/admin/games/${res.data.id}`);
  }

  return (
    <div className="stack">
      <h1>Daily games</h1>
      <p className="hint">
        Every player gets the same game on a given day. Schedule games ahead here; on any day with no game, one is
        built automatically from the least recently used questions (unless that is turned off under Rarity &amp; rules).
        {data && <> Current game day: <strong>{data.today}</strong>.</>}
      </p>

      <section className="card">
        <h2>Schedule a game</h2>
        <form onSubmit={create} className="row" style={{ alignItems: 'end' }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="g-date">Date</label>
            <input id="g-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <button type="submit" className="btn small">Create draft</button>
        </form>
        <p className="hint">The draft starts with suggested questions. Edit the list and order, then publish.</p>
        {formError && <p className="error" role="alert">{formError}</p>}
      </section>

      <section className="card">
        {error && <p className="error" role="alert">{error}</p>}
        {!data ? (
          <div className="loading"><div className="spinner" /></div>
        ) : data.games.length === 0 ? (
          <p className="muted">No games yet. The first one is created when someone opens the site.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Date</th><th>Status</th><th className="num">Questions</th><th className="num">Started</th><th className="num">Completed</th><th className="num">Avg score</th></tr>
              </thead>
              <tbody>
                {data.games.map((g: any) => (
                  <tr key={g.id} className={g.date === data.today ? 'me' : undefined}>
                    <td><Link href={`/admin/games/${g.id}`}>{g.date}</Link>{g.date === data.today && <span className="tag" style={{ marginLeft: 8 }}>today</span>}</td>
                    <td>
                      <span className={`tag ${g.status === 'published' ? 'ok' : 'warn'}`}>{g.status === 'published' ? (g.frozen ? 'live' : 'scheduled') : 'draft'}</span>
                    </td>
                    <td className="num">{g.question_count}</td>
                    <td className="num">{g.sessions}</td>
                    <td className="num">{g.completed}</td>
                    <td className="num">{g.avg_score ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
