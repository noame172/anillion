'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { apiFetch, type ApiError } from '@/lib/client/api';

type Mode = 'login' | 'register' | 'reset' | 'new-password';

const TITLES: Record<Mode, string> = {
  login: 'Log in',
  register: 'Create account',
  reset: 'Reset password',
  'new-password': 'Choose a new password',
};

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (mode === 'login') {
        await apiFetch('/api/auth/login', { body: { email, password } });
        router.push('/');
        router.refresh();
      } else if (mode === 'register') {
        const res = await apiFetch('/api/auth/register', { body: { email, password, username } });
        if (res.needsVerification) setMessage('Check your inbox and confirm your email, then log in.');
        else {
          router.push('/');
          router.refresh();
        }
      } else if (mode === 'reset') {
        const res = await apiFetch('/api/auth/reset', { body: { email } });
        setMessage(
          res.emailSent
            ? 'If that email has an account, a reset link is on its way.'
            : 'This site is running in local development mode, which has no email service. See the README for resetting a local password.',
        );
      } else {
        await apiFetch('/api/auth/password', { body: { next: password } });
        setMessage('Password updated.');
        setTimeout(() => router.push('/profile'), 1200);
      }
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  const needsEmail = mode !== 'new-password';
  const needsPassword = mode !== 'reset';

  return (
    <div className="narrow card">
      <h1 style={{ fontSize: 28, color: 'var(--yellow)', marginBottom: 16 }}>{TITLES[mode]}</h1>
      <form onSubmit={submit} noValidate>
        {needsEmail && (
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        )}
        {mode === 'register' && (
          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              className="input"
              autoComplete="username"
              required
              minLength={3}
              maxLength={20}
              pattern="[A-Za-z0-9_]{3,20}"
              aria-describedby="username-hint"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <span id="username-hint" className="hint">
              3-20 letters, numbers or underscores. Shown on leaderboards.
            </span>
          </div>
        )}
        {needsPassword && (
          <div className="field">
            <label htmlFor="password">{mode === 'new-password' ? 'New password' : 'Password'}</label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={8}
              aria-describedby={mode === 'login' ? undefined : 'password-hint'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {mode !== 'login' && (
              <span id="password-hint" className="hint">
                At least 8 characters.
              </span>
            )}
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="notice ok" role="status">
            {message}
          </p>
        )}
        <button type="submit" className="btn" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Working…' : TITLES[mode]}
        </button>
      </form>

      <p className="hint" style={{ marginTop: 16 }}>
        {mode === 'login' && (
          <>
            New here? <Link href="/register">Create an account</Link> · <Link href="/reset-password">Forgot password?</Link>
          </>
        )}
        {mode === 'register' && (
          <>
            Already have an account? <Link href="/login">Log in</Link>. Games you played as a guest on this device are
            kept. By creating an account you agree to the <Link href="/terms">terms</Link> and{' '}
            <Link href="/privacy">privacy policy</Link>.
          </>
        )}
        {mode === 'reset' && (
          <>
            Remembered it? <Link href="/login">Log in</Link>
          </>
        )}
      </p>
    </div>
  );
}
