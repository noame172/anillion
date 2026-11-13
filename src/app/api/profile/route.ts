import { z } from 'zod';
import { changeUsername, deleteAccount } from '@/lib/auth/profile';
import { supabaseServer } from '@/lib/auth/supabase';
import { clearLocalSession, requireUser } from '@/lib/auth/viewer';
import { config } from '@/lib/config';
import { query } from '@/lib/db/client';
import { badRequest } from '@/lib/errors';
import { getHistory, getProfile } from '@/lib/profile-data';
import { api, parseBody } from '@/lib/security/http';
import { limitFor } from '@/lib/security/ratelimit';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  const user = await requireUser();
  // Everything is looked up by the verified session's user id; there is no id parameter to tamper with.
  return { profile: await getProfile(user.id), history: await getHistory(user), mode: config.mode };
});

const patchSchema = z.object({
  username: z.string().optional(),
  avatarUrl: z.union([z.url({ protocol: /^https$/ }).max(500), z.literal('')]).optional(),
});

export const PATCH = api(async (req) => {
  const user = await requireUser();
  await limitFor('profileWrite', user.id);
  const body = await parseBody(req, patchSchema);
  if (body.username !== undefined) await changeUsername(user.id, body.username);
  if (body.avatarUrl !== undefined) {
    await query('update profiles set avatar_url = $2 where id = $1', [user.id, body.avatarUrl || null]);
  }
  return { profile: await getProfile(user.id) };
});

export const DELETE = api(async (req) => {
  const user = await requireUser();
  await limitFor('profileWrite', user.id);
  const body = await parseBody(req, z.object({ confirm: z.string() }));
  if (body.confirm !== 'DELETE') throw badRequest('Type DELETE to confirm.');
  if (config.mode === 'supabase') await (await supabaseServer()).auth.signOut();
  else await clearLocalSession();
  await deleteAccount(user.id);
  return { ok: true };
});
