import { query, queryOne } from '@/lib/db/client';
import { getGameByDate, type DailyGame } from './daily';
import type { Viewer } from './session';
import { pointsForTier, type Tier } from './tiers';

export type ListedAnswer = { name: string; tier: Tier; points: number; share: number | null };
export type QuestionSummary = {
  position: number;
  question: string;
  /** The answer this player gave, if any. */
  yours: string | null;
  /** How many answers the full list holds. */
  count: number;
};
export type QuestionAnswers = { position: number; answers: ListedAnswer[] };

/**
 * The player's finished session for a game, with the game itself. Only a player who has
 * finished that game may see its answer list: until then it stays on the server.
 */
async function finishedGame(viewer: Viewer, date: string): Promise<{ game: DailyGame; sessionId: string } | null> {
  const game = await getGameByDate(date);
  if (!game) return null;
  const col = viewer.kind === 'user' ? 'user_id' : 'guest_id';
  const session = await queryOne<{ id: string }>(
    `select id from game_sessions where game_id = $1 and ${col} = $2 and status = 'completed'`,
    [game.id, viewer.id],
  );
  return session ? { game, sessionId: session.id } : null;
}

/** One line per prompt: cheap to load, so the results page opens straight away. */
export async function getAnswerSummaries(viewer: Viewer, date: string): Promise<QuestionSummary[] | null> {
  const found = await finishedGame(viewer, date);
  if (!found) return null;
  const { game, sessionId } = found;
  const counts = await query<{ question_id: string; n: number }>(
    `select a.question_id, count(*)::int as n
       from daily_game_questions dq join answers a on a.question_id = dq.question_id and a.verified
      where dq.game_id = $1 group by a.question_id`,
    [game.id],
  );
  const mine = await query<{ question_id: string; canonical: string | null }>(
    `select s.question_id, a.canonical from submissions s left join answers a on a.id = s.answer_id where s.session_id = $1`,
    [sessionId],
  );
  const countBy = new Map(counts.map((c) => [c.question_id, c.n]));
  const mineBy = new Map(mine.map((m) => [m.question_id, m.canonical]));
  return game.questions.map((q) => ({
    position: q.position,
    question: q.text,
    yours: mineBy.get(q.id) ?? null,
    count: countBy.get(q.id) ?? 0,
  }));
}

/** The full answer list for one prompt, loaded when the player opens it. */
export async function getQuestionAnswers(viewer: Viewer, date: string, position: number): Promise<QuestionAnswers | null> {
  const found = await finishedGame(viewer, date);
  const question = found?.game.questions.find((q) => q.position === position);
  if (!found || !question) return null;
  const rows = await query<{ name: string; tier: Tier; share: number | null }>(
    `select a.canonical as name, coalesce(rs.tier, a.provisional_tier) as tier, rs.share::float8 as share
       from answers a
       left join rarity_snapshots rs on rs.game_id = $1 and rs.answer_id = a.id
      where a.question_id = $2 and a.verified`,
    [found.game.id, question.id],
  );
  return {
    position,
    answers: rows
      .map((r) => ({ name: r.name, tier: r.tier, points: pointsForTier(r.tier), share: r.share }))
      // Most popular first, then rarer, then alphabetical.
      .sort((a, b) => (b.share ?? -1) - (a.share ?? -1) || a.points - b.points || a.name.localeCompare(b.name)),
  };
}
