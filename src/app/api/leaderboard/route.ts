import { gameDateFor } from '@/lib/game/daily';
import { dateSchema } from '@/lib/game/schemas';
import { allTimeLeaderboard, dailyLeaderboard, periodLeaderboard } from '@/lib/leaderboard';
import { api, clientIp } from '@/lib/security/http';
import { limitFor } from '@/lib/security/ratelimit';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export const GET = api(async (req) => {
  await limitFor('gameRead', `ip:${clientIp(req)}`);
  const params = req.nextUrl.searchParams;
  if (params.get('scope') === 'alltime') return { scope: 'alltime', rows: await allTimeLeaderboard() };
  const s = await getSettings();
  const date = params.get('date') ? dateSchema.parse(params.get('date')) : gameDateFor(new Date(), s.timezone, s.rolloverHour);
  const scope = params.get('scope');
  if (scope === 'weekly' || scope === 'monthly') return { scope, date, ...(await periodLeaderboard(scope, date)) };
  return { scope: 'daily', date, rows: await dailyLeaderboard(date) };
});
