import { z } from 'zod';
import { changePasswordLocal } from '@/lib/auth/local';
import { passwordSchema } from '@/lib/auth/profile';
import { supabaseServer } from '@/lib/auth/supabase';
import { requireUser } from '@/lib/auth/viewer';
import { config } from '@/lib/config';
import { AppError } from '@/lib/errors';
import { api, parseBody } from '@/lib/security/http';
import { limitFor } from '@/lib/security/ratelimit';

export const dynamic = 'force-dynamic';

const RECENT_LOGIN_MS = 10 * 60 * 1000;

const schema = z.object({ current: z.string().max(200).optional(), next: passwordSchema });

/** Change the password of the signed-in user (also the last step of a reset link). */
export const POST = api(async (req) => {
  const user = await requireUser();
  await limitFor('profileWrite', user.id);
  const body = await parseBody(req, schema);
  if (config.mode === 'dev-local') {
    await changePasswordLocal(user.id, body.current ?? '', body.next);
  } else {
    const supabase = await supabaseServer();
    const { data } = await supabase.auth.getUser();
    // A session that has just signed in (including the one a reset link creates) may set a new
    // password directly. An older one must prove it knows the current password, so a borrowed
    // or stolen session cannot take the account over.
    const signedInAt = Date.parse(data.user?.last_sign_in_at ?? '') || 0;
    if (Date.now() - signedInAt > RECENT_LOGIN_MS) {
      if (!body.current || !data.user?.email) {
        throw new AppError(400, 'CURRENT_REQUIRED', 'Enter your current password to change it.');
      }
      const check = await supabase.auth.signInWithPassword({ email: data.user.email, password: body.current });
      if (check.error) throw new AppError(400, 'CURRENT_WRONG', 'Your current password is not correct.');
    }
    const { error } = await supabase.auth.updateUser({ password: body.next });
    if (error) throw new AppError(400, 'PASSWORD_FAILED', 'Could not update the password. Try a different one.');
  }
  return { ok: true };
});
