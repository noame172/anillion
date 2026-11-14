import { z } from 'zod';
import { query, queryOne, tx } from '@/lib/db/client';
import { isForeignKeyViolation, uniqueViolation } from '@/lib/db/errors';
import { AppError, badRequest, notFound } from '@/lib/errors';
import { gameDateFor, pickQuestions, setGameQuestions } from '@/lib/game/daily';
import { dateSchema } from '@/lib/game/schemas';
import { getSettings } from '@/lib/settings';

const idsSchema = z.array(z.uuid()).min(1).max(30).refine((ids) => new Set(ids).size === ids.length, 'Duplicate questions.');

export const createGameSchema = z.object({ date: dateSchema, questionIds: idsSchema.optional() });
export const updateGameSchema = z.object({
  questionIds: idsSchema.optional(),
  action: z.enum(['publish', 'unpublish']).optional(),
});

export async function listGames() {
  return query(
    `select g.id, g.game_date::text as date, g.status, g.question_count,
            (g.config_snapshot is not null) as frozen,
            coalesce(s.sessions, 0) as sessions,
            coalesce(s.completed, 0) as completed,
            s.avg_score
       from daily_games g
       left join (select game_id,
                         count(*)::int as sessions,
                         (count(*) filter (where status = 'completed'))::int as completed,
                         round(avg(total_score) filter (where status = 'completed'))::int as avg_score
                    from game_sessions group by game_id) s on s.game_id = g.id
      order by g.game_date desc limit 120`,
  );
}

export async function getGameAdmin(id: string) {
  const game = await queryOne(
    `select id, game_date::text as date, status, question_count, (config_snapshot is not null) as frozen, config_snapshot
       from daily_games where id = $1`,
    [id],
  );
  if (!game) throw notFound('Game not found.');
  const questions = await query(
    `select q.id, q.text, q.category, q.active, dq.position, coalesce(a.answers, 0) as answers
       from daily_game_questions dq
       join questions q on q.id = dq.question_id
       left join (select question_id, count(*)::int as answers from answers where verified group by question_id) a
              on a.question_id = q.id
      where dq.game_id = $1 order by dq.position`,
    [id],
  );
  return { game, questions };
}

async function assertQuestionsUsable(ids: string[]) {
  const ok = await query<{ id: string }>(
    `select q.id from questions q
      where q.active and exists (select 1 from answers a where a.question_id = q.id and a.verified)
        and q.id in (select (jsonb_array_elements_text($1::jsonb))::uuid)`,
    [JSON.stringify(ids)],
  );
  if (ok.length !== ids.length) throw badRequest('Every question must be active and have at least one verified answer.');
}

/** Create a draft game for a date. Without explicit questions, the least recently used ones are suggested. */
export async function createGame(input: unknown): Promise<string> {
  const { date, questionIds } = createGameSchema.parse(input);
  const settings = await getSettings();
  const taken = () => new AppError(409, 'DATE_TAKEN', 'A game already exists for that date.');
  try {
    return await tx(async () => {
      if (await queryOne('select 1 from daily_games where game_date = $1', [date])) throw taken();
      const ids = questionIds ?? (await pickQuestions(date, settings.questionsPerGame));
      if (!ids.length) throw badRequest('There are no usable questions yet.');
      await assertQuestionsUsable(ids);
      const [{ id }] = await query<{ id: string }>(
        `insert into daily_games (game_date, status, question_count) values ($1, 'draft', $2) returning id`,
        [date, ids.length],
      );
      await setGameQuestions(id, ids);
      return id;
    });
  } catch (err) {
    // Another request (or the automatic daily game) took the date between the check and the insert.
    if (uniqueViolation(err)) throw taken();
    // A question was deleted while the game was being built.
    if (isForeignKeyViolation(err)) throw badRequest('One of those questions no longer exists.');
    throw err;
  }
}

/**
 * Edit, publish or unpublish a game. Once a game has been served to players
 * (frozen) its questions are locked, and a game with sessions cannot be pulled.
 */
export async function updateGame(id: string, input: unknown) {
  const patch = updateGameSchema.parse(input);
  await tx(async () => {
    const game = await queryOne<{ status: string; frozen: boolean; sessions: number }>(
      `select status, (config_snapshot is not null) as frozen,
              (select count(*)::int from game_sessions s where s.game_id = g.id) as sessions
         from daily_games g where id = $1 for update`,
      [id],
    );
    if (!game) throw notFound('Game not found.');
    if (patch.questionIds) {
      if (game.frozen || game.sessions > 0) {
        throw new AppError(409, 'GAME_LOCKED', 'This game is already live; its questions can no longer change.');
      }
      await assertQuestionsUsable(patch.questionIds);
      await setGameQuestions(id, patch.questionIds);
    }
    if (patch.action === 'publish') {
      await query(`update daily_games set status = 'published', published_at = now() where id = $1`, [id]);
    }
    if (patch.action === 'unpublish') {
      if (game.sessions > 0) {
        throw new AppError(409, 'GAME_LOCKED', 'Players have already started this game; it cannot be unpublished.');
      }
      await query(`delete from rarity_snapshots where game_id = $1`, [id]);
      await query(`update daily_games set status = 'draft', published_at = null, config_snapshot = null where id = $1`, [id]);
    }
  });
}

export async function deleteGame(id: string) {
  const locked = () => new AppError(409, 'GAME_LOCKED', 'A game that has been played cannot be deleted.');
  try {
    await tx(async () => {
      // Players starting the game take a shared lock on this row, so none can slip in after the check.
      await query('select 1 from daily_games where id = $1 for update', [id]);
      if (await queryOne('select 1 from game_sessions where game_id = $1 limit 1', [id])) throw locked();
      await query('delete from daily_games where id = $1', [id]);
    });
  } catch (err) {
    if (isForeignKeyViolation(err)) throw locked();
    throw err;
  }
}

export async function todayDate(now = new Date()) {
  const s = await getSettings();
  return gameDateFor(now, s.timezone, s.rolloverHour);
}
