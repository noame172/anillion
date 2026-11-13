import { getViewer } from '@/lib/auth/viewer';
import { answerBodySchema } from '@/lib/game/schemas';
import { submitAnswer } from '@/lib/game/session';
import { api, clientIp, parseBody } from '@/lib/security/http';
import { limitFor } from '@/lib/security/ratelimit';

export const dynamic = 'force-dynamic';

export const POST = api(async (req) => {
  const viewer = await getViewer();
  await limitFor('answerIp', clientIp(req));
  await limitFor('answer', viewer.id);
  const body = await parseBody(req, answerBodySchema);
  // Score, tier and rarity are decided entirely on the server from the database.
  return submitAnswer(viewer, body);
});
