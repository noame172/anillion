import { z } from 'zod';
import { loginLocal } from '@/lib/auth/local';
import { ensureProfile } from '@/lib/auth/profile';
import { supabaseServer } from '@/lib/auth/supabase';
import { readGuestId, setLocalSession } from '@/lib/auth/viewer';
import { config } from '@/lib/config';
import { queryOne } from '@/lib/db/client';
import { AppError } from '@/lib/errors';
import { mergeGuestIntoUser } from '@/lib/game/merge';
import { api, clientIp, parseBody } from '@/lib/security/http';
import { limitFor } from '@/lib/security/ratelimit';

export const dynamic = 'force-dynamic';

/** `identifier` is an email address or a username. */
const schema = z.object({ identifier: z.string().trim().min(1).max(254), password: z.string().max(200) });
// One message for every failure, so the form never confirms that an account exists.
const failed = () => new AppError(401, 'LOGIN_FAILED', 'Those login details are incorrect.');

export const POST = api(async (req) => {
  const body = await parseBody(req, schema);
  const identifier = body.identifier.toLowerCase();
  // Brute-force protection, counted before the password is checked: per address, and per
  // account. Email and username resolve to the same account, so they share one allowance.
  const ip = clientIp(req);
  await limitFor('loginIp', ip);
  const account = identifier.includes('@')
    ? await queryOne<{ id: string }>(
        config.mode === 'dev-local'
          ? 'select user_id as id from local_credentials where lower(email) = $1'
          : 'select id from auth.users where lower(email) = $1',
        [identifier],
      )
    : await queryOne<{ id: string }>('select id from profiles where lower(username) = $1', [identifier]);
  // The tight limit is per account AND address: someone elsewhere typing wrong passwords for a
  // public username must not be able to lock the real owner out.
  const subject = account ? `user:${account.id}` : `id:${identifier}`;
  await limitFor('login', `${subject}:${ip}`);
  await limitFor('loginAccount', subject);

  let userId: string | null;
  if (config.mode === 'dev-local') {
    userId = await loginLocal(identifier, body.password);
    if (!userId) throw failed();
    await setLocalSession(userId);
  } else {
    // Supabase signs in by email, so a username is first resolved to its account's email.
    const email = identifier.includes('@')
      ? identifier
      : (
          await queryOne<{ email: string }>(
            `select u.email from profiles p join auth.users u on u.id = p.id where lower(p.username) = $1`,
            [identifier],
          )
        )?.email;
    const supabase = await supabaseServer();
    if (!email) {
      // Do the same slow call a real account would, so response time does not reveal which
      // usernames and emails exist.
      await supabase.auth.signInWithPassword({ email: 'no-such-account@example.invalid', password: body.password });
      throw failed();
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: body.password });
    if (error || !data.user) throw failed();
    userId = data.user.id;
    await ensureProfile(userId, data.user.email, data.user.user_metadata?.username, Boolean(data.user.email_confirmed_at));
  }

  const guestId = await readGuestId();
  if (guestId) await mergeGuestIntoUser(guestId, userId);
  return { ok: true };
});
