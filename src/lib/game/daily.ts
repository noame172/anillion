import { query, queryOne, tx } from '@/lib/db/client';
import { getSettings, type Settings } from '@/lib/settings';
import { buildSnapshot } from './rarity';
import type { Thresholds } from './tiers';

const HOUR = 3_600_000;

/** Wall-clock parts of an instant in a timezone. */
function localParts(at: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), min: get('minute'), s: get('second') };
}

function tzOffsetMs(at: Date, timezone: string): number {
  const p = localParts(at, timezone);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(at.getTime() / 1000) * 1000;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The game date ('YYYY-MM-DD') an instant belongs to. Uses server time only. */
export function gameDateFor(now: Date, timezone: string, rolloverHour: number): string {
  const p = localParts(new Date(now.getTime() - rolloverHour * HOUR), timezone);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** The instant the next daily game becomes available. */
export function nextRolloverAt(now: Date, timezone: string, rolloverHour: number): Date {
  const [y, m, d] = gameDateFor(now, timezone, rolloverHour).split('-').map(Number);
  // Local wall time of the next rollover, converted to UTC (two passes settle DST changes).
  const wall = Date.UTC(y, m - 1, d + 1, rolloverHour);
  let guess = wall - tzOffsetMs(new Date(wall), timezone);
  guess = wall - tzOffsetMs(new Date(guess), timezone);
  return new Date(guess);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export type GameQuestion = { id: string; text: string; category: string; position: number };
export type FrozenConfig = { thresholds: Thresholds; minSample: number; timeLimitSec: number; frozenAt: string };
export type DailyGame = {
  id: string;
  date: string;
  number: number;
  questionCount: number;
  config: FrozenConfig;
  questions: GameQuestion[];
};

type GameRow = { id: string; game_date: string; status: string; question_count: number; config_snapshot: unknown };

function parseConfig(value: unknown): FrozenConfig | null {
  if (!value) return null;
  return (typeof value === 'string' ? JSON.parse(value) : value) as FrozenConfig;
}

/**
 * Freeze a game's rules and rarity. Runs once, the first time the game is
 * served on its day; after that the scores it pays can never move.
 */
async function freeze(game: GameRow, settings: Settings, now: Date): Promise<FrozenConfig> {
  const config: FrozenConfig = {
    thresholds: settings.thresholds,
    minSample: settings.minSample,
    timeLimitSec: settings.timeLimitSec,
    frozenAt: now.toISOString(),
  };
  await buildSnapshot(game.id, config.thresholds, config.minSample);
  await query('update daily_games set config_snapshot = $2::jsonb where id = $1', [game.id, JSON.stringify(config)]);
  return config;
}

/** Pick questions for an unscheduled day: least recently used first, stable per date. */
export async function pickQuestions(date: string, count: number): Promise<string[]> {
  const rows = await query<{ id: string }>(
    `select q.id
       from questions q
       left join (
         select dq.question_id, max(g.game_date) as last_used
           from daily_game_questions dq join daily_games g on g.id = dq.game_id
          group by dq.question_id
       ) u on u.question_id = q.id
      where q.active
        and exists (select 1 from answers a where a.question_id = q.id and a.verified)
      order by u.last_used asc nulls first, md5(q.id::text || $1)
      limit $2`,
    [date, count],
  );
  return rows.map((r) => r.id);
}

export async function setGameQuestions(gameId: string, questionIds: string[]) {
  await query('delete from daily_game_questions where game_id = $1', [gameId]);
  await query(
    `insert into daily_game_questions (game_id, question_id, position)
     select $1, x.id, x.position from jsonb_to_recordset($2::jsonb) as x(id uuid, position int)`,
    [gameId, JSON.stringify(questionIds.map((id, position) => ({ id, position })))],
  );
  await query('update daily_games set question_count = $2 where id = $1', [gameId, questionIds.length]);
}

async function loadGame(row: GameRow, config: FrozenConfig): Promise<DailyGame> {
  const questions = await query<GameQuestion>(
    `select q.id, q.text, q.category, dq.position
       from daily_game_questions dq join questions q on q.id = dq.question_id
      where dq.game_id = $1 order by dq.position`,
    [row.id],
  );
  const n = await queryOne<{ n: number }>(
    `select count(*)::int as n from daily_games where status = 'published' and game_date <= $1`,
    [row.game_date],
  );
  return {
    id: row.id,
    date: row.game_date,
    number: n?.n ?? 1,
    questionCount: questions.length,
    config,
    questions,
  };
}

/** The game for a specific date, only if it has already been played/frozen. */
export async function getGameByDate(date: string): Promise<DailyGame | null> {
  const row = await queryOne<GameRow>(
    `select id, game_date::text as game_date, status, question_count, config_snapshot from daily_games
      where game_date = $1 and status = 'published'`,
    [date],
  );
  const config = row && parseConfig(row.config_snapshot);
  return row && config ? loadGame(row, config) : null;
}

/**
 * Today's game, the same for every player. Scheduled games are used as-is;
 * if nothing was scheduled and auto-generation is on, one is created.
 */
export async function getTodayGame(now: Date = new Date()): Promise<DailyGame | null> {
  const settings = await getSettings();
  const date = gameDateFor(now, settings.timezone, settings.rolloverHour);

  // Fast path: already frozen.
  const ready = await getGameByDate(date);
  if (ready) return ready;

  return tx(async () => {
    let row = await queryOne<GameRow>(
      'select id, game_date::text as game_date, status, question_count, config_snapshot from daily_games where game_date = $1 for update',
      [date],
    );
    if (!row) {
      if (!settings.autoGenerate) return null;
      const ids = await pickQuestions(date, settings.questionsPerGame);
      if (!ids.length) return null;
      // The unique date constraint makes concurrent creators converge on one game.
      const created = await queryOne<GameRow>(
        `insert into daily_games (game_date, status, question_count, published_at)
         values ($1, 'published', $2, $3)
         on conflict (game_date) do nothing
         returning id, game_date::text as game_date, status, question_count, config_snapshot`,
        [date, ids.length, now.toISOString()],
      );
      if (created) {
        await setGameQuestions(created.id, ids);
        row = created;
      } else {
        row = await queryOne<GameRow>(
          'select id, game_date::text as game_date, status, question_count, config_snapshot from daily_games where game_date = $1 for update',
          [date],
        );
      }
    }
    if (!row || row.status !== 'published') return null;
    const config = parseConfig(row.config_snapshot) ?? (await freeze(row, settings, now));
    return loadGame(row, config);
  });
}

/** When the next game unlocks, as an ISO string. */
export async function nextGameAt(now: Date = new Date()): Promise<string> {
  const s = await getSettings();
  return nextRolloverAt(now, s.timezone, s.rolloverHour).toISOString();
}
