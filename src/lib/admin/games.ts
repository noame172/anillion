import { z } from 'zod';
import { query, queryOne, tx } from '@/lib/db/client';
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
            (select count(*)::int from game_sessions s where s.game_id = g.id) as sessions,
            (select count(*)::int from game_sessions s where s.game_id = g.id and s.status = 'completed') as completed,
            (select round(avg(total_score))::int from game_sessions s where s.game_id = g.id and s.status = 'completed') as avg_score
       from daily_games g order by g.game_date desc limit 120`,
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
    `select q.id, q.text, q.category, q.active, dq.position,
            (select count(*)::int from answers a where a.question_id = q.id and a.verified) as answers
       from daily_game_questions dq join questions q on q.id = dq.question_id
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
  return tx(async () => {
    if (await queryOne('select 1 from daily_games where game_date = $1', [date])) {
      throw new AppError(409, 'DATE_TAKEN', 'A game already exists for that date.');
    }
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
  const sessions = await queryOne('select 1 from game_sessions where game_id = $1 limit 1', [id]);
  if (sessions) throw new AppError(409, 'GAME_LOCKED', 'A game that has been played cannot be deleted.');
  await query('delete from daily_games where id = $1', [id]);
}

export async function todayDate(now = new Date()) {
  const s = await getSettings();
  return gameDateFor(now, s.timezone, s.rolloverHour);
}
