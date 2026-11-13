'use client';

import { useState } from 'react';
import { adminCall, useAdmin } from '@/components/admin/useAdmin';

export default function AdminUsersPage() {
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const { data, error, reload } = useAdmin(`users?q=${encodeURIComponent(applied)}`);
  const { data: sus } = useAdmin('suspicious');
  const [msg, setMsg] = useState('');

  async function update(id: string, body: unknown, question: string) {
    if (!confirm(question)) return;
    const res = await adminCall(`users/${id}`, 'PATCH', body);
    setMsg(res.error || 'Updated.');
    if (!res.error) await reload();
  }

  return (
    <div className="stack">
      <h1>Users</h1>
      <form className="row" onSubmit={(e) => { e.preventDefault(); setApplied(search); }}>
        <label htmlFor="u-search" className="sr-only">Search users</label>
        <input id="u-search" className="input" style={{ maxWidth: 320 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Username or email" />
        <button type="submit" className="btn ghost small">Search</button>
        <span className="hint" role="status" aria-live="polite">{msg}</span>
      </form>
      {error && <p className="error" role="alert">{error}</p>}

      <section className="card">
        {!data ? (
          <div className="loading"><div className="spinner" /></div>
        ) : data.users.length === 0 ? (
          <p className="muted">No users found.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Username</th><th>Email</th><th>Role</th><th className="num">Games</th><th className="num">Points</th><th>Joined</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {data.users.map((u: any) => (
                  <tr key={u.id}>
                    <td><strong>{u.username}</strong> {u.suspended && <span className="tag warn">suspended</span>}</td>
                    <td>{u.email ?? '—'}</td>
                    <td><span className={`tag ${u.role === 'admin' ? 'ok' : ''}`}>{u.role}</span></td>
                    <td className="num">{u.games_played}</td>
                    <td className="num">{u.total_points}</td>
                    <td>{new Date(u.created_at).toLocaleDateString()}</td>
                    <td>
                      <div className="row">
                        <button type="button" className="btn ghost small" onClick={() => update(u.id, { suspended: !u.suspended }, `${u.suspended ? 'Restore' : 'Suspend'} ${u.username}?`)}>
                          {u.suspended ? 'Restore' : 'Suspend'}
                        </button>
                        <button type="button" className="btn ghost small" onClick={() => update(u.id, { role: u.role === 'admin' ? 'user' : 'admin' }, u.role === 'admin' ? `Remove admin rights from ${u.username}?` : `Make ${u.username} an administrator?`)}>
                          {u.role === 'admin' ? 'Remove admin' : 'Make admin'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Suspicious activity</h2>
        <h3 style={{ fontSize: 14, margin: '8px 0' }}>Games finished in under 20 seconds</h3>
        {!sus || sus.fastSessions.length === 0 ? (
          <p className="muted">None.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Player</th><th>Date</th><th className="num">Score</th><th className="num">Seconds</th></tr></thead>
              <tbody>
                {sus.fastSessions.map((s: any) => (
                  <tr key={s.id}><td>{s.username ?? `guest ${String(s.guest_id).slice(0, 8)}`}</td><td>{s.date}</td><td className="num">{s.total_score}</td><td className="num">{s.seconds}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <h3 style={{ fontSize: 14, margin: '16px 0 8px' }}>Heavy request sources (last 24 hours)</h3>
        {!sus || sus.rateLimited.length === 0 ? (
          <p className="muted">None.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Limiter key</th><th className="num">Requests</th><th>Last seen</th></tr></thead>
              <tbody>
                {sus.rateLimited.map((r: any) => (
                  <tr key={r.key}><td>{r.key}</td><td className="num">{r.hits}</td><td>{new Date(r.last_seen).toLocaleString()}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
