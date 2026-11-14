'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/client/api';

type Me = { user: { username: string; role: 'user' | 'admin' } | null };

export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    let alive = true;
    apiFetch<Me>('/api/me')
      .then((m) => alive && setMe(m))
      .catch(() => alive && setMe({ user: null }));
    return () => {
      alive = false;
    };
  }, [pathname]);

  async function logout() {
    await apiFetch('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
    setMe({ user: null });
    router.push('/');
    router.refresh();
  }

  return (
    <header className="site-header">
      <Link href="/" className="brand" aria-label="Animellion home">
        ANIMELLION
      </Link>
      <nav className="nav" aria-label="Main">
        <Link href="/leaderboard">Leaderboard</Link>
        <Link href="/how-to-play">How to play</Link>
        {me?.user?.role === 'admin' && <Link href="/admin">Admin</Link>}
        {!me && <span className="nav-slot" aria-hidden="true" />}
        {me?.user ? (
          <>
            <Link href="/profile" className="pill">
              {me.user.username}
            </Link>
            <button type="button" onClick={logout}>
              Log out
            </button>
          </>
        ) : (
          me && (
            <Link href="/login" className="pill">
              Log in
            </Link>
          )
        )}
      </nav>
    </header>
  );
}
