import { getViewer } from '@/lib/auth/viewer';
import { forbidden } from '@/lib/errors';
import { getAllAnswers } from '@/lib/game/answers';
import { dateSchema } from '@/lib/game/schemas';
import { api } from '@/lib/security/http';
import { limitFor } from '@/lib/security/ratelimit';

export const dynamic = 'force-dynamic';

/** The full answer list for a game. Only served to a player who has finished that game. */
export const GET = api(async (req) => {
  const viewer = await getViewer();
  await limitFor('gameRead', viewer.id);
  const date = dateSchema.parse(req.nextUrl.searchParams.get('date'));
  const questions = await getAllAnswers(viewer, date);
  if (!questions) throw forbidden('Finish this game to see every answer.');
  return { questions };
});
