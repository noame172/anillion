import { getViewer } from '@/lib/auth/viewer';
import { startSession } from '@/lib/game/session';
import { api, clientIp } from '@/lib/security/http';
import { limitFor } from '@/lib/security/ratelimit';

export const dynamic = 'force-dynamic';

export const POST = api(async (req) => {
  // Per address as well as per player: a script that drops its cookie gets a new guest id each time.
  await limitFor('gameStartIp', clientIp(req));
  const viewer = await getViewer({ create: true });
  await limitFor('gameRead', viewer.id);
  return startSession(viewer);
});
