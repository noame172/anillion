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

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.200 0-9.600-3.300-11.300-7.900l-6.500 5C9.500 39.600 16.200 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.200-2.200 4.200-4.100 5.600l6.200 5.200C37 39.200 44 34 44 24c0-1.300-.100-2.400-.400-3.500z" />
    </svg>
  );
}

export function AuthForm({ mode, google = false }: { mode: Mode; google?: boolean }) {
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
        await apiFetch('/api/auth/login', { body: { identifier: email, password } });
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
            <label htmlFor="email">{mode === 'login' ? 'Email or username' : 'Email'}</label>
            <input
              id="email"
              className="input"
              type={mode === 'login' ? 'text' : 'email'}
              autoCapitalize="none"
              spellCheck={false}
              autoComplete={mode === 'login' ? 'username' : 'email'}
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

      {(mode === 'login' || mode === 'register') && (
        <>
          <div className="or" aria-hidden="true">
            <span>or</span>
          </div>
          {google ? (
            <a className="btn ghost google" href="/api/auth/google">
              <GoogleMark /> Continue with Google
            </a>
          ) : (
            <>
              <button type="button" className="btn ghost google" disabled aria-describedby="google-hint">
                <GoogleMark /> Continue with Google
              </button>
              <p id="google-hint" className="hint" style={{ marginTop: 8 }}>
                Google sign-in switches on once the site is connected to Supabase with the Google provider enabled.
              </p>
            </>
          )}
        </>
      )}

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
