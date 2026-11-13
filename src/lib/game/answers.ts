import { query, queryOne } from '@/lib/db/client';
import { getGameByDate } from './daily';
import type { Viewer } from './session';
import { pointsForTier, type Tier } from './tiers';

export type ListedAnswer = { name: string; tier: Tier; points: number; share: number | null };
export type QuestionAnswers = {
  position: number;
  question: string;
  /** The answer this player gave, if any. */
  yours: string | null;
  answers: ListedAnswer[];
};

/**
 * Every accepted answer for a game, with the rarity frozen for that game.
 * Only for a player who has finished that game: until then the list stays
 * on the server. Returns null when it is not available to this viewer.
 */
export async function getAllAnswers(viewer: Viewer, date: string): Promise<QuestionAnswers[] | null> {
  const game = await getGameByDate(date);
  if (!game) return null;
  const col = viewer.kind === 'user' ? 'user_id' : 'guest_id';
  const session = await queryOne<{ id: string }>(
    `select id from game_sessions where game_id = $1 and ${col} = $2 and status = 'completed'`,
    [game.id, viewer.id],
  );
  if (!session) return null;

  const rows = await query<{ question_id: string; id: string; name: string; tier: Tier; share: number | null }>(
    `select a.question_id, a.id, a.canonical as name,
            coalesce(rs.tier, a.provisional_tier) as tier, rs.share::float8 as share
       from daily_game_questions dq
       join answers a on a.question_id = dq.question_id and a.verified
       left join rarity_snapshots rs on rs.game_id = dq.game_id and rs.answer_id = a.id
      where dq.game_id = $1`,
    [game.id],
  );
  const mine = await query<{ question_id: string; answer_id: string | null }>(
    'select question_id, answer_id from submissions where session_id = $1',
    [session.id],
  );
  const mineByQuestion = new Map(mine.map((m) => [m.question_id, m.answer_id]));

  return game.questions.map((q) => {
    const list = rows.filter((r) => r.question_id === q.id);
    const yoursId = mineByQuestion.get(q.id);
    return {
      position: q.position,
      question: q.text,
      yours: list.find((r) => r.id === yoursId)?.name ?? null,
      answers: list
        .map((r) => ({ name: r.name, tier: r.tier, points: pointsForTier(r.tier), share: r.share }))
        // Most popular first, then alphabetical.
        .sort((a, b) => (b.share ?? -1) - (a.share ?? -1) || a.points - b.points || a.name.localeCompare(b.name)),
    };
  });
}
