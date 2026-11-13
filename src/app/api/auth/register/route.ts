import { z } from 'zod';
import { registerLocal } from '@/lib/auth/local';
import { emailSchema, ensureProfile, passwordSchema, usernameSchema, usernameTaken } from '@/lib/auth/profile';
import { supabaseServer } from '@/lib/auth/supabase';
import { readGuestId, setLocalSession } from '@/lib/auth/viewer';
import { config } from '@/lib/config';
import { AppError } from '@/lib/errors';
import { mergeGuestIntoUser } from '@/lib/game/merge';
import { api, clientIp, parseBody } from '@/lib/security/http';
import { limitFor } from '@/lib/security/ratelimit';

export const dynamic = 'force-dynamic';

const schema = z.object({ email: emailSchema, password: passwordSchema, username: usernameSchema });

export const POST = api(async (req) => {
  await limitFor('register', `ip:${clientIp(req)}`);
  const body = await parseBody(req, schema);
  const guestId = await readGuestId();

  if (config.mode === 'dev-local') {
    const userId = await registerLocal(body);
    await setLocalSession(userId);
    if (guestId) await mergeGuestIntoUser(guestId, userId);
    return { ok: true, needsVerification: false };
  }

  if (await usernameTaken(body.username)) throw new AppError(409, 'USERNAME_TAKEN', 'That username is taken.');
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signUp({
    email: body.email,
    password: body.password,
    options: { data: { username: body.username }, emailRedirectTo: `${config.siteUrl}/auth/callback` },
  });
  if (error) throw new AppError(400, 'SIGNUP_FAILED', 'Could not create the account. Check your details and try again.');
  // With email confirmation on there is no session yet; guest progress is merged at first login.
  if (data.session && data.user) {
    await ensureProfile(data.user.id, data.user.email, body.username, Boolean(data.user.email_confirmed_at));
    if (guestId) await mergeGuestIntoUser(guestId, data.user.id);
  }
  return { ok: true, needsVerification: !data.session };
});
