import { getViewer } from '@/lib/auth/viewer';
import { passBodySchema } from '@/lib/game/schemas';
import { passQuestion } from '@/lib/game/session';
import { api, clientIp, parseBody } from '@/lib/security/http';
import { limitFor } from '@/lib/security/ratelimit';

export const dynamic = 'force-dynamic';

/** "Pass": skip the current prompt for 0 points. Shares the answer rate limits. */
export const POST = api(async (req) => {
  await limitFor('answerIp', clientIp(req));
  const viewer = await getViewer();
  await limitFor('answer', viewer.id);
  const body = await parseBody(req, passBodySchema);
  return passQuestion(viewer, body);
});
