import { getViewer } from '@/lib/auth/viewer';
import { startSession } from '@/lib/game/session';
import { api } from '@/lib/security/http';
import { limitFor } from '@/lib/security/ratelimit';

export const dynamic = 'force-dynamic';

export const POST = api(async () => {
  const viewer = await getViewer();
  await limitFor('gameRead', viewer.id);
  return startSession(viewer);
});
