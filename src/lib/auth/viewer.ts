import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { config } from '@/lib/config';
import { forbidden, unauthorized } from '@/lib/errors';
import type { Viewer } from '@/lib/game/session';
import { ensureProfile, loadUserViewer } from './profile';
import { supabaseServer } from './supabase';
import { signToken, verifyToken } from './tokens';

export const SESSION_COOKIE = 'an_session';
export const GUEST_COOKIE = 'an_guest';

export type UserViewer = Viewer & { kind: 'user' };

function cookieOptions(days: number) {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: days * 86_400,
  };
}

/** The signed-in user, verified on the server. Null for guests. */
export async function getUserViewer(): Promise<UserViewer | null> {
  if (config.mode === 'supabase') {
    const supabase = await supabaseServer();
    // getUser() validates the token with Supabase; it does not trust the cookie contents.
    const { data } = await supabase.auth.getUser();
    if (!data.user) return null;
    await ensureProfile(data.user.id, data.user.email, data.user.user_metadata?.username);
    return loadUserViewer(data.user.id);
  }
  const store = await cookies();
  const userId = await verifyToken(store.get(SESSION_COOKIE)?.value, 'user');
  return userId ? loadUserViewer(userId) : null;
}

export async function readGuestId(): Promise<string | null> {
  const store = await cookies();
  return verifyToken(store.get(GUEST_COOKIE)?.value, 'guest');
}

/** The current player: a signed-in user, or a guest identified by a signed cookie. */
export async function getViewer(): Promise<Viewer> {
  const user = await getUserViewer();
  if (user) return user;
  let guestId = await readGuestId();
  if (!guestId) {
    guestId = crypto.randomUUID();
    (await cookies()).set(GUEST_COOKIE, await signToken('guest', guestId, 365), cookieOptions(365));
  }
  return { kind: 'guest', id: guestId };
}

export async function requireUser(): Promise<UserViewer> {
  const user = await getUserViewer();
  if (!user) throw unauthorized();
  return user;
}

export async function requireAdmin(): Promise<UserViewer> {
  const user = await requireUser();
  if (user.role !== 'admin') throw forbidden();
  return user;
}

/** dev-local login: issue the signed session cookie. */
export async function setLocalSession(userId: string) {
  (await cookies()).set(SESSION_COOKIE, await signToken('user', userId, 30), cookieOptions(30));
}

export async function clearLocalSession() {
  (await cookies()).delete(SESSION_COOKIE);
}
