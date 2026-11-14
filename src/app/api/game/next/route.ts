import { getViewer } from '@/lib/auth/viewer';
import { nextQuestion } from '@/lib/game/session';
import { api, clientIp } from '@/lib/security/http';
import { limitFor } from '@/lib/security/ratelimit';

export const dynamic = 'force-dynamic';

export const POST = api(async (req) => {
  await limitFor('gameReadIp', clientIp(req));
  const viewer = await getViewer();
  await limitFor('gameRead', viewer.id);
  return nextQuestion(viewer);
});
