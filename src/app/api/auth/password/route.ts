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

const schema = z.object({ current: z.string().max(200).optional(), next: passwordSchema });

/** Change the password of the signed-in user (also the last step of a reset link). */
export const POST = api(async (req) => {
  const user = await requireUser();
  await limitFor('profileWrite', user.id);
  const body = await parseBody(req, schema);
  if (config.mode === 'dev-local') {
    await changePasswordLocal(user.id, body.current ?? '', body.next);
  } else {
    const { error } = await (await supabaseServer()).auth.updateUser({ password: body.next });
    if (error) throw new AppError(400, 'PASSWORD_FAILED', 'Could not update the password. Try a different one.');
  }
  return { ok: true };
});
