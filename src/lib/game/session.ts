import { query, queryOne, tx } from '@/lib/db/client';
import { advisoryLock, playerLock } from '@/lib/db/locks';
import { AppError, conflict } from '@/lib/errors';
import { getTodayGame, getGameByDate, nextGameAt, type DailyGame } from './daily';
import { formForScore, progressToNext, type Form, type Progress } from './forms';
import { lookupRarity } from './rarity';
import { recomputeProfileStats } from './streak';
import { pointsForTier, type Tier } from './tiers';
import { matchAnswer, recordUnknown } from './validate';

export type Viewer =
  | { kind: 'user'; id: string; role: 'user' | 'admin'; username: string }
  | { kind: 'guest'; id: string };

/** Allowance for network delay on an answer sent right at the buzzer. */
export const GRACE_MS = 1500;

export type AnsweredRow = {
  position: number;
  question: string;
  answer: string | null;
  tier: Tier | null;
  points: number;
  /** Percentage of players who gave this answer when the game was frozen; null = not enough data yet. */
  share: number | null;
  provisional: boolean;
  timedOut: boolean;
};

export type GameState = {
  sessionId: string;
  date: string;
  gameNumber: number;
  total: number;
  /** Questions already resolved. */
  position: number;
  score: number;
  form: Form;
  progress: Progress;
  phase: 'question' | 'between' | 'done';
  current: { id: string; text: string; category: string; timeLeftMs: number; limitSec: number } | null;
  answers: AnsweredRow[];
  validAnswers: number;
  completed: boolean;
  nextGameAt: string;
};

export type SubmitResult =
  | { status: 'accepted'; result: AnsweredRow; state: GameState }
  | { status: 'unrecognised'; timeLeftMs: number }
  /** Close to an accepted answer: nothing is scored until the player sends the suggested name. */
  | { status: 'suggestion'; suggestion: string; timeLeftMs: number }
  | { status: 'timeout'; state: GameState };

type SessionRow = {
  id: string;
  user_id: string | null;
  guest_id: string | null;
  game_id: string;
  position: number;
  current_started_at: Date | string | null;
  total_score: number;
  status: 'active' | 'completed';
};

const SESSION_COLS = 'id, user_id, guest_id, game_id, position, current_started_at, total_score, status';

function owner(viewer: Viewer): { clause: string; id: string } {
  return viewer.kind === 'user'
    ? { clause: 'user_id = $2', id: viewer.id }
    : { clause: 'guest_id = $2', id: viewer.id };
}

async function findSession(gameId: string, viewer: Viewer, lock: boolean): Promise<SessionRow | null> {
  const o = owner(viewer);
  return queryOne<SessionRow>(
    `select ${SESSION_COLS} from game_sessions where game_id = $1 and ${o.clause} ${lock ? 'for update' : ''}`,
    [gameId, o.id],
  );
}

function deadlineMs(session: SessionRow, game: DailyGame): number | null {
  if (!session.current_started_at) return null;
  return new Date(session.current_started_at).getTime() + game.config.timeLimitSec * 1000;
}

type Resolution = {
  rawText: string | null;
  answerId: string | null;
  tier: Tier | null;
  points: number;
  share: number | null;
  provisional: boolean;
  timedOut: boolean;
};

/**
 * Record the outcome of the current question and move the session on.
 * Must run inside a transaction holding the session row lock.
 */
async function resolveCurrent(session: SessionRow, game: DailyGame, r: Resolution, now: Date): Promise<SessionRow> {
  const question = game.questions[session.position];
  // The unique (session_id, question_id) constraint is the last guard against double scoring.
  await query(
    `insert into submissions (session_id, question_id, raw_text, answer_id, tier, points, share, provisional, timed_out, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [session.id, question.id, r.rawText, r.answerId, r.tier, r.points, r.share, r.provisional, r.timedOut, now.toISOString()],
  );
  const position = session.position + 1;
  const score = session.total_score + r.points;
  const finished = position >= game.questionCount;
  const updated = await queryOne<SessionRow>(
    `update game_sessions
        set position = $2, total_score = $3, current_started_at = null,
            status = $4, completed_at = $5, final_form = $6
      where id = $1 returning ${SESSION_COLS}`,
    [
      session.id,
      position,
      score,
      finished ? 'completed' : 'active',
      finished ? now.toISOString() : null,
      finished ? formForScore(score) : null,
    ],
  );
  if (finished && session.user_id) await recomputeProfileStats(session.user_id, game.date);
  return updated!;
}

const TIMEOUT: Resolution = {
  rawText: null,
  answerId: null,
  tier: null,
  points: 0,
  share: null,
  provisional: false,
  timedOut: true,
};

/** Close the current question at 0 points if its timer has run out. */
async function expireIfLate(session: SessionRow, game: DailyGame, now: Date): Promise<{ session: SessionRow; expired: boolean }> {
  const deadline = deadlineMs(session, game);
  if (session.status !== 'active' || deadline === null || now.getTime() <= deadline + GRACE_MS) {
    return { session, expired: false };
  }
  return { session: await resolveCurrent(session, game, TIMEOUT, now), expired: true };
}

async function buildState(game: DailyGame, session: SessionRow, now: Date): Promise<GameState> {
  const rows = await query<{
    question_id: string;
    canonical: string | null;
    tier: Tier | null;
    points: number;
    share: number | null;
    provisional: boolean;
    timed_out: boolean;
  }>(
    `select s.question_id, a.canonical, s.tier, s.points, s.share::float8 as share, s.provisional, s.timed_out
       from submissions s left join answers a on a.id = s.answer_id
      where s.session_id = $1`,
    [session.id],
  );
  const byQuestion = new Map(rows.map((r) => [r.question_id, r]));
  const answers: AnsweredRow[] = [];
  for (const q of game.questions) {
    const r = byQuestion.get(q.id);
    if (!r) continue;
    answers.push({
      position: q.position,
      question: q.text,
      answer: r.canonical,
      tier: r.tier,
      points: r.points,
      share: r.share,
      provisional: r.provisional,
      timedOut: r.timed_out,
    });
  }

  const completed = session.status === 'completed';
  const deadline = deadlineMs(session, game);
  const live = !completed && deadline !== null;
  // Only the question whose timer is running is ever sent to the client.
  const q = live ? game.questions[session.position] : null;

  return {
    sessionId: session.id,
    date: game.date,
    gameNumber: game.number,
    total: game.questionCount,
    position: session.position,
    score: session.total_score,
    form: formForScore(session.total_score),
    progress: progressToNext(session.total_score),
    phase: completed ? 'done' : live ? 'question' : 'between',
    current: q
      ? {
          id: q.id,
          text: q.text,
          category: q.category,
          timeLeftMs: Math.max(0, deadline! - now.getTime()),
          limitSec: game.config.timeLimitSec,
        }
      : null,
    answers,
    validAnswers: answers.filter((a) => a.points > 0).length,
    completed,
    nextGameAt: await nextGameAt(now),
  };
}

/**
 * Take a shared lock on the game row and confirm it is still live. An administrator
 * unpublishing or deleting a game locks the same row exclusively, so a player can
 * never start a session on a game that is being pulled at that moment.
 */
export async function lockLiveGame(gameId: string): Promise<void> {
  const g = await queryOne<{ live: boolean }>(
    `select (status = 'published' and config_snapshot is not null) as live from daily_games where id = $1 for share`,
    [gameId],
  );
  if (!g?.live) throw new AppError(404, 'NO_GAME', "Today's game is not available yet.");
}

async function requireTodayGame(now: Date): Promise<DailyGame> {
  const game = await getTodayGame(now);
  if (!game) throw new AppError(404, 'NO_GAME', "Today's game is not available yet.");
  return game;
}

/**
 * Start today's game (the "Power Up" button). Safe to call again: it returns
 * the existing session and can never reset a score or reopen a finished game.
 */
export async function startSession(viewer: Viewer, now: Date = new Date()): Promise<GameState> {
  const game = await requireTodayGame(now);
  return tx(async () => {
    await lockLiveGame(game.id);
    // Starting a game and merging a guest game into the account both create this player's session.
    if (viewer.kind === 'user') await advisoryLock(playerLock(viewer.id));
    const col = viewer.kind === 'user' ? 'user_id' : 'guest_id';
    await query(
      `insert into game_sessions (game_id, ${col}, started_at, current_started_at)
       values ($1, $2, $3, $3) on conflict do nothing`,
      [game.id, viewer.id, now.toISOString()],
    );
    const found = await findSession(game.id, viewer, true);
    if (!found) throw new AppError(500, 'SESSION_FAILED', 'Could not start the game.');
    const { session } = await expireIfLate(found, game, now);
    return buildState(game, session, now);
  });
}

/** Start the timer for the next question. Does nothing if one is already running. */
export async function nextQuestion(viewer: Viewer, now: Date = new Date()): Promise<GameState> {
  const game = await requireTodayGame(now);
  return tx(async () => {
    const found = await findSession(game.id, viewer, true);
    if (!found) throw conflict('NO_SESSION', 'Start the game first.');
    let { session } = await expireIfLate(found, game, now);
    if (session.status === 'active' && !session.current_started_at) {
      session = (await queryOne<SessionRow>(
        `update game_sessions set current_started_at = $2 where id = $1 returning ${SESSION_COLS}`,
        [session.id, now.toISOString()],
      ))!;
    }
    return buildState(game, session, now);
  });
}

/** Current state of today's game for this player, or null if they have not started. */
export async function getState(viewer: Viewer, now: Date = new Date()): Promise<GameState | null> {
  const game = await getTodayGame(now);
  if (!game) return null;
  // Most visits find no session at all, or a finished one that can no longer change. Neither
  // needs a lock or a transaction, so answer those with plain reads.
  const peek = await findSession(game.id, viewer, false);
  if (!peek) return null;
  if (peek.status === 'completed') return buildState(game, peek, now);
  return tx(async () => {
    const found = await findSession(game.id, viewer, true);
    if (!found) return null;
    const { session } = await expireIfLate(found, game, now);
    return buildState(game, session, now);
  });
}

/** A player's own result for a past (or today's) game. */
export async function getResultForDate(viewer: Viewer, date: string, now: Date = new Date()): Promise<GameState | null> {
  const game = await getGameByDate(date);
  if (!game) return null;
  const session = await findSession(game.id, viewer, false);
  if (!session) return null;
  const state = await buildState(game, session, now);
  // Past games are read-only: never expose a live question from them.
  return { ...state, current: null, phase: state.completed ? 'done' : 'between' };
}

/**
 * Submit an answer for the question whose timer is running.
 * Unrecognised answers cost nothing and can be retried until time runs out;
 * a near-miss spelling gets a "did you mean" suggestion instead of points;
 * the first valid answer scores once and locks the question.
 */
export async function submitAnswer(
  viewer: Viewer,
  input: { questionId: string; text: string },
  now: Date = new Date(),
): Promise<SubmitResult> {
  const game = await requireTodayGame(now);
  return tx(async () => {
    const found = await findSession(game.id, viewer, true);
    if (!found) {
      const o = owner(viewer);
      const old = await queryOne(
        `select 1 from game_sessions where ${o.clause.replace('$2', '$1')} and status = 'active' limit 1`,
        [o.id],
      );
      if (old) throw conflict('GAME_ENDED', 'That game has ended. A new daily game is ready.');
      throw conflict('NO_SESSION', 'Start the game first.');
    }
    if (found.status === 'completed') throw conflict('GAME_OVER', "You have already finished today's game.");

    const { session, expired } = await expireIfLate(found, game, now);
    const answeredAlready = game.questions.findIndex((q) => q.id === input.questionId);
    if (expired) return { status: 'timeout', state: await buildState(game, session, now) };
    if (answeredAlready !== -1 && answeredAlready < session.position) {
      throw conflict('ALREADY_ANSWERED', 'That question is already answered.');
    }
    if (!session.current_started_at) throw conflict('NOT_STARTED', 'The next question has not started yet.');

    const question = game.questions[session.position];
    if (question.id !== input.questionId) throw conflict('NOT_CURRENT_QUESTION', 'That is not the current question.');

    let match = await matchAnswer(question.id, input.text);
    if (match) {
      // An administrator may have deleted or unverified this answer a moment ago. Hold a shared
      // lock on it so it cannot change before the points are recorded, and re-check it.
      const stillValid = await queryOne('select 1 from answers where id = $1 and verified for share', [match.answerId]);
      if (!stillValid) match = null;
    }
    if (!match) {
      await recordUnknown(question.id, input.text);
      return { status: 'unrecognised', timeLeftMs: Math.max(0, deadlineMs(session, game)! - now.getTime()) };
    }
    if (!match.exact) {
      return {
        status: 'suggestion',
        suggestion: match.canonical,
        timeLeftMs: Math.max(0, deadlineMs(session, game)! - now.getTime()),
      };
    }

    const rarity = await lookupRarity(game.id, match.answerId);
    const points = pointsForTier(rarity.tier);
    const updated = await resolveCurrent(
      session,
      game,
      {
        rawText: input.text.trim().slice(0, 80),
        answerId: match.answerId,
        tier: rarity.tier,
        points,
        share: rarity.share,
        provisional: rarity.provisional,
        timedOut: false,
      },
      now,
    );
    // Today's answers feed future games only; this game's rarity is already frozen.
    await query(
      `insert into answer_stats (question_id, answer_id, valid_count, updated_at) values ($1, $2, 1, $3)
       on conflict (question_id, answer_id)
       do update set valid_count = answer_stats.valid_count + 1, updated_at = excluded.updated_at`,
      [question.id, match.answerId, now.toISOString()],
    );
    const state = await buildState(game, updated, now);
    return { status: 'accepted', result: state.answers[state.answers.length - 1], state };
  });
}
