import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { query, queryOne, tx } from '@/lib/db/client';
import { uniqueViolation } from '@/lib/db/errors';
import { AppError } from '@/lib/errors';
import { emailSchema, ensureProfile, passwordSchema, usernameSchema, usernameTaken } from './profile';

/**
 * Email + password login for dev-local mode (no Supabase keys).
 * Production uses Supabase Auth; this exists so the app is fully usable offline.
 */

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Compared against when the email is unknown, so both paths take the same time.
const DUMMY_HASH = hashPassword('not-a-real-password');

export async function registerLocal(input: { email: string; password: string; username: string }): Promise<string> {
  const email = emailSchema.parse(input.email);
  const password = passwordSchema.parse(input.password);
  const username = usernameSchema.parse(input.username);
  const password_hash = await hashPassword(password);
  try {
    return await registerTx(email, password_hash, username);
  } catch (err) {
    // Two sign-ups with the same email or username at the same moment: the database picks the winner.
    const clash = uniqueViolation(err);
    if (clash) {
      if (clash.includes('username')) throw new AppError(409, 'USERNAME_TAKEN', 'That username is taken.');
      throw new AppError(409, 'EMAIL_TAKEN', 'An account with that email already exists.');
    }
    throw err;
  }
}

async function registerTx(email: string, password_hash: string, username: string): Promise<string> {
  return tx(async () => {
    if (await queryOne('select 1 from local_credentials where lower(email) = $1', [email])) {
      throw new AppError(409, 'EMAIL_TAKEN', 'An account with that email already exists.');
    }
    if (await usernameTaken(username)) throw new AppError(409, 'USERNAME_TAKEN', 'That username is taken.');
    const [{ id }] = await query<{ id: string }>('insert into auth.users (email) values ($1) returning id', [email]);
    await query('insert into local_credentials (user_id, email, password_hash) values ($1, $2, $3)', [
      id,
      email,
      password_hash,
    ]);
    await ensureProfile(id, email, username);
    return id;
  });
}

/**
 * Log in with an email address or a username. Returns the user id, or null.
 * Never reveals whether the email or username exists.
 */
export async function loginLocal(identifier: string, password: string): Promise<string | null> {
  const id = String(identifier ?? '').trim().toLowerCase().slice(0, 254);
  type Row = { user_id: string; email: string; password_hash: string };
  const row = id.includes('@')
    ? await queryOne<Row>('select user_id, email, password_hash from local_credentials where lower(email) = $1', [id])
    : await queryOne<Row>(
        `select c.user_id, c.email, c.password_hash
           from profiles p join local_credentials c on c.user_id = p.id
          where lower(p.username) = $1`,
        [id],
      );
  const ok = await verifyPassword(String(password ?? '').slice(0, 200), row?.password_hash ?? (await DUMMY_HASH));
  if (!row || !ok) return null;
  await ensureProfile(row.user_id, row.email);
  return row.user_id;
}

export async function changePasswordLocal(userId: string, current: string, next: string): Promise<void> {
  const row = await queryOne<{ password_hash: string }>('select password_hash from local_credentials where user_id = $1', [
    userId,
  ]);
  if (!row || !(await verifyPassword(current, row.password_hash))) {
    throw new AppError(401, 'WRONG_PASSWORD', 'Your current password is incorrect.');
  }
  await query('update local_credentials set password_hash = $2 where user_id = $1', [
    userId,
    await hashPassword(passwordSchema.parse(next)),
  ]);
}
