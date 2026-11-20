import { getViewer } from '@/lib/auth/viewer';
import { notFound } from '@/lib/errors';
import { dateSchema } from '@/lib/game/schemas';
import { getResultForDate } from '@/lib/game/session';
import { dayStanding } from '@/lib/leaderboard';
import { streakInfo } from '@/lib/profile-data';
import { api, clientIp } from '@/lib/security/http';
import { limitFor } from '@/lib/security/ratelimit';

export const dynamic = 'force-dynamic';

export const GET = api(async (req) => {
  await limitFor('gameReadIp', clientIp(req));
  const viewer = await getViewer();
  await limitFor('gameRead', viewer.id);
  const date = dateSchema.parse(req.nextUrl.searchParams.get('date'));
  const state = await getResultForDate(viewer, date);
  if (!state) throw notFound('No result for that day.');
  const streak = await streakInfo(viewer);
  const standing = state.completed ? await dayStanding(state.sessionId) : null;
  return { state, streak: streak.current, freezes: streak.freezes, frozen: streak.frozen, standing };
});
