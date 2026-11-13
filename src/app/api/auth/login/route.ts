import { z } from 'zod';
import { loginLocal } from '@/lib/auth/local';
import { ensureProfile } from '@/lib/auth/profile';
import { supabaseServer } from '@/lib/auth/supabase';
import { readGuestId, setLocalSession } from '@/lib/auth/viewer';
import { config } from '@/lib/config';
import { AppError } from '@/lib/errors';
import { mergeGuestIntoUser } from '@/lib/game/merge';
import { api, clientIp, parseBody } from '@/lib/security/http';
import { limitFor } from '@/lib/security/ratelimit';

export const dynamic = 'force-dynamic';

const schema = z.object({ email: z.string().max(254), password: z.string().max(200) });
// One message for every failure, so the form never confirms that an email is registered.
const failed = () => new AppError(401, 'LOGIN_FAILED', 'Email or password is incorrect.');

export const POST = api(async (req) => {
  const body = await parseBody(req, schema);
  const email = body.email.trim().toLowerCase();
  // Brute-force protection: per address and per email, counted before the password is checked.
  await limitFor('login', `ip:${clientIp(req)}`);
  await limitFor('login', `email:${email}`);

  let userId: string | null;
  if (config.mode === 'dev-local') {
    userId = await loginLocal(email, body.password);
    if (!userId) throw failed();
    await setLocalSession(userId);
  } else {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: body.password });
    if (error || !data.user) throw failed();
    userId = data.user.id;
    await ensureProfile(userId, data.user.email, data.user.user_metadata?.username);
  }

  const guestId = await readGuestId();
  if (guestId) await mergeGuestIntoUser(guestId, userId);
  return { ok: true };
});
