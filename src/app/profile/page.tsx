'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ApiError, apiFetch } from '@/lib/client/api';
import { whatYouWouldLose } from '@/lib/delete-summary';
import { FORM_LABELS } from '@/lib/game/forms';
import type { HistoryRow, PlayerStats, ProfileData } from '@/lib/profile-data';
import { TIER_LABELS } from '@/lib/game/tiers';

type Data = { profile: ProfileData; history: HistoryRow[]; stats: PlayerStats | null; mode: 'supabase' | 'dev-local' };

export default function ProfilePage() {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [guest, setGuest] = useState(false);
  const [error, setError] = useState('');
  const [username, setUsername] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [saved, setSaved] = useState('');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  // Deleting asks one more question first: what you would lose, and a yes or no.
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);
  const askRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) keepRef.current?.focus();
  }, [confirming]);

  useEffect(() => {
    apiFetch<Data>('/api/profile')
      .then((d) => {
        setData(d);
        setUsername(d.profile.username);
        setAvatarUrl(d.profile.avatarUrl ?? '');
      })
      .catch((e: ApiError) => (e.status === 401 ? setGuest(true) : setError(e.message)));
  }, []);

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setSaved('');
    setError('');
    try {
      const res = await apiFetch('/api/profile', { method: 'PATCH', body: { username, avatarUrl } });
      setData((d) => d && { ...d, profile: res.profile });
      setSaved('Saved.');
      router.refresh();
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setPwMsg('');
    try {
      await apiFetch('/api/auth/password', { body: { current, next } });
      setPwMsg('Password updated.');
      setCurrent('');
      setNext('');
    } catch (err) {
      setPwMsg((err as ApiError).message);
    }
  }

  async function deleteAccount() {
    setDeleting(true);
    setError('');
    try {
      await apiFetch('/api/profile', { method: 'DELETE', body: { confirm: 'DELETE' } });
      router.push('/');
      router.refresh();
    } catch (err) {
      setError((err as ApiError).message);
      setDeleting(false);
    }
  }

  function closeConfirm() {
    setConfirming(false);
    askRef.current?.focus();
  }

  function onConfirmKey(e: KeyboardEvent) {
    if (e.key === 'Escape') closeConfirm();
  }

  if (guest) {
    return (
      <div className="narrow card stack center">
        <h1 style={{ color: 'var(--yellow)' }}>You&apos;re playing as a guest</h1>
        <p>
          Guest progress lives only on this device and can be lost if you clear your browser data. Create an account to
          keep your history, streak and leaderboard place. Games you already played here come with you.
        </p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Link href="/register" className="btn">
            Create account
          </Link>
          <Link href="/login" className="btn ghost">
            Log in
          </Link>
        </div>
      </div>
    );
  }
  if (!data) {
    return error ? (
      <p className="notice warn narrow" role="alert">
        {error}
      </p>
    ) : (
      <div className="loading" role="status">
        <div className="spinner" />
      </div>
    );
  }

  const { profile, history, stats } = data;
  return (
    <div className="stack">
      <section className="card">
        <div className="row" style={{ marginBottom: 14 }}>
          {profile.avatarUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.avatarUrl}
              alt=""
              width={56}
              height={56}
              loading="lazy"
              referrerPolicy="no-referrer"
              style={{ borderRadius: '50%', border: '3px solid var(--line)', objectFit: 'cover' }}
            />
          )}
          <div>
            <h1 style={{ fontSize: 30, color: 'var(--yellow)' }}>{profile.username}</h1>
            <span className="hint">Joined {new Date(profile.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
        <div className="stat-grid">
          {[
            ['Current streak', `🔥 ${profile.streak}`],
            ['Longest streak', profile.longestStreak],
            ['Streak freezes', `🧊 ${profile.freezes}`],
            ['Games played', profile.gamesPlayed],
            ['Total points', profile.totalPoints],
            ['Average score', profile.averageScore],
            ['Best score', profile.bestScore],
          ].map(([k, v]) => (
            <div className="stat" key={k}>
              <div className="k">{k}</div>
              <div className="v">{v}</div>
            </div>
          ))}
        </div>
        <p className="hint">
          A streak freeze covers one missed day, so your streak carries on. You earn one every 7 days of a streak and can
          bank 2.
        </p>
      </section>


      {stats && stats.answered > 0 && (
        <section className="card stack">
          <h2>Your answers</h2>
          <div className="tier-bars" role="list">
            {(['common', 'rare', 'epic', 'ultra'] as const).map((t) => (
              <div className="tier-bar" role="listitem" key={t}>
                <span>{TIER_LABELS[t]}</span>
                <span className="track" aria-hidden="true">
                  <span className="fill" style={{ width: `${(stats.tiers[t] / stats.answered) * 100}%`, background: `var(--tier-${t})` }} />
                </span>
                <span className="n">{stats.tiers[t]}</span>
              </div>
            ))}
          </div>
          <p className="hint">
            {stats.answered} answers scored{stats.timeouts > 0 ? `, ${stats.timeouts} prompts timed out or passed` : ''}.
          </p>
          {stats.ultraAnswers.length > 0 && (
            <>
              <h3>Your latest Ultra answers</h3>
              <ul>
                {stats.ultraAnswers.map((u) => (
                  <li key={`${u.date}-${u.question}`}>
                    <strong>{u.answer}</strong> <span className="muted">for “{u.question}” on {u.date}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {stats && (
        <section className="card stack">
          <h2>
            Badges{' '}
            <span className="hint">
              {stats.badges.filter((b) => b.earned).length}/{stats.badges.length}
            </span>
          </h2>
          <div className="badge-grid">
            {stats.badges.map((b) => (
              <div key={b.id} className={`badge-card ${b.earned ? 'earned' : 'locked'}`}>
                <span className="name">
                  {b.earned ? '🏅' : '🔒'} {b.name}
                </span>
                <span className="desc">{b.description}</span>
                {!b.earned && (
                  <span className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={b.target} aria-valuenow={b.current} aria-label={`${b.name} progress`}>
                    <span style={{ width: `${(b.current / b.target) * 100}%` }} />
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <h2>Game history</h2>
        {history.length === 0 ? (
          <p className="muted">
            No games yet. <Link href="/">Play today&apos;s game</Link>.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Game</th>
                  <th scope="col">Date</th>
                  <th scope="col">Final form</th>
                  <th scope="col" className="num">
                    Score
                  </th>
                  <th scope="col">
                    <span className="sr-only">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.date}>
                    <td>#{h.gameNumber}</td>
                    <td>{h.date}</td>
                    <td>
                      {FORM_LABELS[h.form]} {!h.completed && <span className="tag warn">unfinished</span>}
                    </td>
                    <td className="num">
                      <strong>{h.score}</strong>
                    </td>
                    <td className="num">
                      <Link href={`/results?date=${h.date}`}>View</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid-2">
        <section className="card">
          <h2>Profile</h2>
          <form onSubmit={saveProfile}>
            <div className="field">
              <label htmlFor="p-username">Username</label>
              <input
                id="p-username"
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                minLength={3}
                maxLength={20}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="p-avatar">Profile picture URL (https)</label>
              <input
                id="p-avatar"
                className="input"
                type="url"
                placeholder="https://…"
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
              />
            </div>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="row">
              <button type="submit" className="btn">
                Save
              </button>
              <span className="hint" role="status">
                {saved}
              </span>
            </div>
          </form>
        </section>

        <section className="card">
          <h2>Password</h2>
          <form onSubmit={changePassword}>
            <div className="field">
              <label htmlFor="pw-current">Current password</label>
              <input
                id="pw-current"
                className="input"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                required={data.mode === 'dev-local'}
              />
              {data.mode !== 'dev-local' && (
                <p className="hint">Needed unless you signed in a few minutes ago or came from a reset link.</p>
              )}
            </div>
            <div className="field">
              <label htmlFor="pw-next">New password</label>
              <input
                id="pw-next"
                className="input"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                required
              />
            </div>
            <div className="row">
              <button type="submit" className="btn ghost">
                Change password
              </button>
              <span className="hint" role="status">
                {pwMsg}
              </span>
            </div>
          </form>
        </section>
      </div>

      <section className="card">
        <h2 style={{ color: 'var(--red)' }}>Delete account</h2>
        <p className="hint">
          This permanently removes your account, username, streak and leaderboard entries. Anonymous game statistics
          are kept. This cannot be undone.
        </p>
        {!confirming ? (
          <button ref={askRef} type="button" className="btn danger" onClick={() => setConfirming(true)}>
            Delete my account
          </button>
        ) : (
          <div className="confirm-delete" role="group" aria-labelledby="confirm-title" onKeyDown={onConfirmKey}>
            <h3 id="confirm-title">Leaving already?</h3>
            {(() => {
              const loss = whatYouWouldLose(data.profile, data.stats);
              return loss.length > 0 ? (
                <>
                  <p>You&apos;ll lose:</p>
                  <ul>
                    {loss.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p>You haven&apos;t played yet, so this only removes your username.</p>
              );
            })()}
            <p>This can&apos;t be undone. Do you want to delete your account?</p>
            <div className="row">
              <button ref={keepRef} type="button" className="btn" onClick={closeConfirm} disabled={deleting}>
                No, keep my account
              </button>
              <button type="button" className="btn danger" onClick={deleteAccount} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Yes, delete it'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
