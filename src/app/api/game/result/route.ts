import { getViewer } from '@/lib/auth/viewer';
import { notFound } from '@/lib/errors';
import { dateSchema } from '@/lib/game/schemas';
import { getResultForDate } from '@/lib/game/session';
import { getStreak } from '@/lib/profile-data';
import { api } from '@/lib/security/http';
import { limitFor } from '@/lib/security/ratelimit';

export const dynamic = 'force-dynamic';

export const GET = api(async (req) => {
  const viewer = await getViewer();
  await limitFor('gameRead', viewer.id);
  const date = dateSchema.parse(req.nextUrl.searchParams.get('date'));
  const state = await getResultForDate(viewer, date);
  if (!state) throw notFound('No result for that day.');
  return { state, streak: await getStreak(viewer) };
});
