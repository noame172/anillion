import { getViewer } from '@/lib/auth/viewer';
import { getTodayGame, nextGameAt } from '@/lib/game/daily';
import { getState } from '@/lib/game/session';
import { getStreak } from '@/lib/profile-data';
import { api, clientIp } from '@/lib/security/http';
import { limitFor } from '@/lib/security/ratelimit';

export const dynamic = 'force-dynamic';

export const GET = api(async (req) => {
  await limitFor('gameReadIp', clientIp(req));
  const viewer = await getViewer();
  await limitFor('gameRead', viewer.id);
  const game = await getTodayGame();
  return {
    available: Boolean(game),
    date: game?.date ?? null,
    gameNumber: game?.number ?? null,
    questionCount: game?.questionCount ?? null,
    timeLimitSec: game?.config.timeLimitSec ?? null,
    state: game ? await getState(viewer) : null,
    streak: await getStreak(viewer),
    nextGameAt: await nextGameAt(),
    viewer: viewer.kind === 'user' ? { kind: 'user', username: viewer.username, role: viewer.role } : { kind: 'guest' },
  };
});
