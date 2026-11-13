import { z } from 'zod';
import { query, queryOne } from '@/lib/db/client';
import { config } from '@/lib/config';
import { AppError, forbidden } from '@/lib/errors';
import type { Viewer } from '@/lib/game/session';

export const usernameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_]{3,20}$/, 'Usernames are 3-20 letters, numbers or underscores.');

export const emailSchema = z.email('Enter a valid email address.').max(254).transform((e) => e.trim().toLowerCase());
export const passwordSchema = z.string().min(8, 'Passwords need at least 8 characters.').max(200);

export async function usernameTaken(username: string, exceptUserId?: string): Promise<boolean> {
  const row = await queryOne('select 1 from profiles where lower(username) = lower($1) and id <> $2', [
    username,
    exceptUserId ?? '00000000-0000-0000-0000-000000000000',
  ]);
  return Boolean(row);
}

const randomDigits = () => String(Math.floor(1000 + Math.random() * 9000));

/** A chosen username, or a neutral one. Never derived from the email, which would publish it. */
function cleanUsername(wanted: string | undefined): string {
  const base = (wanted ?? '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 16);
  return base.length >= 3 ? base : `player${randomDigits()}`;
}

/**
 * Make sure an authenticated user has a profile row.
 * `emailVerified` must be false when the email address has not been confirmed:
 * an unconfirmed address never earns administrator rights.
 */
export async function ensureProfile(
  userId: string,
  email: string | undefined,
  wantedUsername?: string,
  emailVerified = true,
): Promise<void> {
  const existing = await queryOne('select 1 from profiles where id = $1', [userId]);
  if (!existing) {
    let username = cleanUsername(wantedUsername);
    for (let i = 0; i < 8 && (await usernameTaken(username)); i++) {
      username = `${username.slice(0, 14)}${randomDigits()}`;
    }
    if (await usernameTaken(username)) username = `p_${userId.replace(/-/g, '').slice(0, 16)}`;
    await query('insert into profiles (id, username) values ($1, $2) on conflict (id) do nothing', [userId, username]);
  }
  // First-admin bootstrap: emails listed in ADMIN_EMAILS (server-only) are promoted on sign-in.
  // Local accounts have no email verification, so they are never promoted on a production server.
  const trusted = emailVerified && !(config.mode === 'dev-local' && process.env.NODE_ENV === 'production');
  if (trusted && email && config.adminEmails.includes(email.toLowerCase())) {
    await query(`update profiles set role = 'admin' where id = $1 and role <> 'admin'`, [userId]);
  }
}

/** Load the trusted viewer record for a user id. Role and status always come from the database. */
export async function loadUserViewer(userId: string): Promise<(Viewer & { kind: 'user' }) | null> {
  const p = await queryOne<{ username: string; role: 'user' | 'admin'; suspended: boolean }>(
    'select username, role, suspended from profiles where id = $1',
    [userId],
  );
  if (!p) return null;
  if (p.suspended) throw forbidden('This account is suspended.');
  return { kind: 'user', id: userId, role: p.role, username: p.username };
}

export async function changeUsername(userId: string, raw: string): Promise<string> {
  const username = usernameSchema.parse(raw);
  if (await usernameTaken(username, userId)) throw new AppError(409, 'USERNAME_TAKEN', 'That username is taken.');
  await query('update profiles set username = $2 where id = $1', [userId, username]);
  return username;
}

/** Delete an account. Past game rows are kept for statistics but detached from the person. */
export async function deleteAccount(userId: string): Promise<void> {
  await query(
    `update game_sessions set user_id = null, guest_id = gen_random_uuid() where user_id = $1`,
    [userId],
  );
  // Cascades to profiles and local_credentials. In Supabase this removes the auth user itself.
  await query('delete from auth.users where id = $1', [userId]);
}
