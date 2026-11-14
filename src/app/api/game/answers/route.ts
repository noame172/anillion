import { z } from 'zod';
import { getViewer } from '@/lib/auth/viewer';
import { forbidden } from '@/lib/errors';
import { getAnswerSummaries, getQuestionAnswers } from '@/lib/game/answers';
import { dateSchema } from '@/lib/game/schemas';
import { api, clientIp } from '@/lib/security/http';
import { limitFor } from '@/lib/security/ratelimit';

export const dynamic = 'force-dynamic';

/**
 * Answers for a finished game, only for a player who has finished it.
 * Without `position` it returns one short line per prompt; with `position` it returns
 * that prompt's full answer list, so the page only loads what the player opens.
 */
export const GET = api(async (req) => {
  await limitFor('gameReadIp', clientIp(req));
  const viewer = await getViewer();
  await limitFor('gameRead', viewer.id);
  const date = dateSchema.parse(req.nextUrl.searchParams.get('date'));
  const position = req.nextUrl.searchParams.get('position');
  const denied = () => forbidden('Finish this game to see every answer.');
  if (position === null) {
    const questions = await getAnswerSummaries(viewer, date);
    if (!questions) throw denied();
    return { questions };
  }
  const n = z.coerce.number().int().min(0).max(30).parse(position);
  const list = await getQuestionAnswers(viewer, date, n);
  if (!list) throw denied();
  return list;
});
