import { getViewer } from '@/lib/auth/viewer';
import { getTodayGame, nextGameAt } from '@/lib/game/daily';
import { getState } from '@/lib/game/session';
import { streakInfo } from '@/lib/profile-data';
import { api, clientIp } from '@/lib/security/http';
import { limitFor } from '@/lib/security/ratelimit';

export const dynamic = 'force-dynamic';

export const GET = api(async (req) => {
  await limitFor('gameReadIp', clientIp(req));
  const viewer = await getViewer();
  // These reads do not depend on each other, so they run side by side: on a database that is a
  // network hop away, each one in turn is what made this page slow.
  const [, game, streak, nextAt] = await Promise.all([
    limitFor('gameRead', viewer.id),
    getTodayGame(),
    streakInfo(viewer),
    nextGameAt(),
  ]);
  return {
    available: Boolean(game),
    date: game?.date ?? null,
    gameNumber: game?.number ?? null,
    questionCount: game?.questionCount ?? null,
    timeLimitSec: game?.config.timeLimitSec ?? null,
    state: game ? await getState(viewer) : null,
    streak: streak.current,
    freezes: streak.freezes,
    frozen: streak.frozen,
    nextGameAt: nextAt,
    viewer: viewer.kind === 'user' ? { kind: 'user', username: viewer.username, role: viewer.role } : { kind: 'guest' },
  };
});
