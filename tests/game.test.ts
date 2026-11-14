import { beforeEach, describe, expect, it } from 'vitest';
import { query, tx } from '@/lib/db/client';
import { gameDateFor, getTodayGame, nextRolloverAt } from '@/lib/game/daily';
import { computeRarity, lookupRarity } from '@/lib/game/rarity';
import { getResultForDate, getState, nextQuestion, startSession, submitAnswer, type GameState } from '@/lib/game/session';
import { streakFromDates } from '@/lib/game/streak';
import { matchAnswer } from '@/lib/game/validate';
import { updateSettings } from '@/lib/settings';
import { at, freshDb, guest, makeQuestion, makeStandardQuestions, makeUser, plus } from './helpers';

const DAY1 = at('2026-03-10T12:00:00Z');
const DAY2 = at('2026-03-11T12:00:00Z');

beforeEach(async () => {
  await freshDb();
});

describe('database guards', () => {
  it('rolls a failed transaction back', async () => {
    await expect(
      tx(async () => {
        await query(`insert into settings (key, value) values ('x', '1'::jsonb)`);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await query(`select 1 from settings where key = 'x'`)).toHaveLength(0);
  });
});

describe('answer validation', () => {
  it('accepts canonical names and aliases regardless of case and spacing', async () => {
    const q = await makeQuestion('Name a Dragon Ball character.', [
      { name: 'Goku', aliases: ['Son Goku', 'Kakarot'] },
      { name: 'Krillin', aliases: ['Kuririn'] },
    ]);
    const goku = q.answers.Goku;
    for (const text of ['Goku', 'goku', '  GOKU  ', 'son   goku', 'KAKAROT', 'Gokú']) {
      expect((await matchAnswer(q.id, text))?.answerId, text).toBe(goku);
    }
    expect((await matchAnswer(q.id, 'kuririn'))?.canonical).toBe('Krillin');
  });

  it('rejects answers that are wrong, from another question, unverified or malformed', async () => {
    const db = await makeQuestion('Name a Dragon Ball character.', [{ name: 'Goku' }, { name: 'Pilaf', verified: false }]);
    await makeQuestion('Name a Naruto character.', [{ name: 'Naruto' }]);
    for (const text of ['Naruto', 'Luffy', 'Pilaf', '', '   ', '!!!', 'a'.repeat(500), "'; drop table answers; --"]) {
      expect(await matchAnswer(db.id, text), text).toBeNull();
    }
    expect(await query('select 1 from answers')).not.toHaveLength(0);
  });
});

describe('rarity', () => {
  const answers = [
    { answerId: 'a', count: 150, provisionalTier: 'ultra' as const },
    { answerId: 'b', count: 24, provisionalTier: 'ultra' as const },
    { answerId: 'c', count: 16, provisionalTier: 'common' as const },
    { answerId: 'd', count: 5, provisionalTier: 'common' as const },
    { answerId: 'e', count: 2, provisionalTier: 'common' as const },
    { answerId: 'f', count: 3, provisionalTier: 'common' as const },
    { answerId: 'g', count: 0, provisionalTier: 'common' as const },
  ];
  const thresholds = { common: 10, rare: 3, epic: 1 };

  it('uses real submission shares once the sample is large enough', () => {
    const r = computeRarity(answers, thresholds, 100); // 200 submissions
    expect(r.get('a')).toEqual({ tier: 'common', share: 75, provisional: false });
    expect(r.get('b')).toMatchObject({ tier: 'common', share: 12 });
    expect(r.get('c')).toMatchObject({ tier: 'rare', share: 8 });
    expect(r.get('d')).toMatchObject({ tier: 'epic', share: 2.5 });
    expect(r.get('f')).toMatchObject({ tier: 'epic', share: 1.5 });
    expect(r.get('e')).toMatchObject({ tier: 'ultra', share: 1 });
    expect(r.get('g')).toMatchObject({ tier: 'ultra', share: 0 }); // second of the two allowed ultras
  });

  it('allows at most 2 ultras per question, or 3 above 1000 answers', () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ answerId: `x${String(i).padStart(4, '0')}`, count: i < 5 ? 1 : 0, provisionalTier: 'ultra' as const }));
    const ultras = (r: ReturnType<typeof computeRarity>) => [...r.values()].filter((v) => v.tier === 'ultra').length;
    // Provisional: only 2 of 50 admin-set ultras survive.
    expect(ultras(computeRarity(many(50), thresholds, 1000))).toBe(2);
    expect(ultras(computeRarity(many(1001), thresholds, 1_000_000))).toBe(3);
    // Player data: 1000 answers each at or below 1%, only the 2 rarest found by players are ultra.
    const real = Array.from({ length: 60 }, (_, i) => ({ answerId: `r${i}`, count: i < 40 ? 1 : 0, provisionalTier: 'common' as const }));
    const r = computeRarity(real, { common: 10, rare: 3, epic: 1 }, 10);
    expect(ultras(r)).toBe(2);
    expect(r.get('r50')!.tier).toBe('epic');
  });

  it('falls back to provisional tiers below the minimum sample', () => {
    const r = computeRarity(answers, thresholds, 1000);
    expect(r.get('a')).toEqual({ tier: 'ultra', share: null, provisional: true });
    expect(r.get('c')).toEqual({ tier: 'common', share: null, provisional: true });
  });

  it('freezes rarity for a published game', async () => {
    const [q] = await makeStandardQuestions(1);
    await updateSettings({ questionsPerGame: 1, minSample: 10 });
    await query(`insert into answer_stats (question_id, answer_id, valid_count) values ($1, $2, 95), ($1, $3, 5)`, [
      q.id,
      q.answers.c1,
      q.answers.u1,
    ]);
    const game = (await getTodayGame(DAY1))!;
    expect(await lookupRarity(game.id, q.answers.u1)).toEqual({ tier: 'rare', share: 5, provisional: false });

    // Later statistics and threshold changes must not move this game's scores.
    await query('update answer_stats set valid_count = 5000 where answer_id = $1', [q.answers.u1]);
    await updateSettings({ thresholds: { common: 50, rare: 40, epic: 30 } });
    expect(await lookupRarity(game.id, q.answers.u1)).toEqual({ tier: 'rare', share: 5, provisional: false });

    // An answer approved after the freeze is scored with its provisional tier.
    const [late] = await query<{ id: string }>(
      `insert into answers (question_id, canonical, norm, verified, provisional_tier) values ($1, 'Late', 'late', true, 'epic') returning id`,
      [q.id],
    );
    expect(await lookupRarity(game.id, late.id)).toEqual({ tier: 'epic', share: null, provisional: true });
  });
});

describe('daily game', () => {
  it('computes the game date from server time, timezone and rollover hour', () => {
    expect(gameDateFor(at('2026-03-10T23:59:59Z'), 'UTC', 0)).toBe('2026-03-10');
    expect(gameDateFor(at('2026-03-11T00:00:00Z'), 'UTC', 0)).toBe('2026-03-11');
    // Jerusalem is UTC+2 in early March; rollover at 05:00 local = 03:00 UTC.
    expect(gameDateFor(at('2026-03-10T02:59:59Z'), 'Asia/Jerusalem', 5)).toBe('2026-03-09');
    expect(gameDateFor(at('2026-03-10T03:00:00Z'), 'Asia/Jerusalem', 5)).toBe('2026-03-10');
    expect(nextRolloverAt(at('2026-03-10T12:00:00Z'), 'Asia/Jerusalem', 5).toISOString()).toBe('2026-03-11T03:00:00.000Z');
    expect(nextRolloverAt(at('2026-03-10T12:00:00Z'), 'UTC', 0).toISOString()).toBe('2026-03-11T00:00:00.000Z');
  });

  it('gives every player the same seven questions, and a new set the next day', async () => {
    await makeStandardQuestions(14);
    const [a, b] = await Promise.all([getTodayGame(DAY1), getTodayGame(DAY1)]);
    expect(a!.id).toBe(b!.id);
    expect(a!.questions).toHaveLength(7);
    expect(a!.questions.map((q) => q.id)).toEqual(b!.questions.map((q) => q.id));
    expect(await query('select 1 from daily_games')).toHaveLength(1);

    const next = await getTodayGame(DAY2);
    expect(next!.id).not.toBe(a!.id);
    expect(next!.number).toBe(2);
    const overlap = next!.questions.filter((q) => a!.questions.some((x) => x.id === q.id));
    expect(overlap).toHaveLength(0);
  });

  it('uses a scheduled game instead of generating one', async () => {
    const qs = await makeStandardQuestions(8);
    const picked = [qs[7], qs[0], qs[3]];
    const [{ id }] = await query<{ id: string }>(
      `insert into daily_games (game_date, status, question_count) values ('2026-03-10', 'published', 3) returning id`,
    );
    for (const [i, q] of picked.entries()) {
      await query('insert into daily_game_questions (game_id, question_id, position) values ($1, $2, $3)', [id, q.id, i]);
    }
    const game = await getTodayGame(DAY1);
    expect(game!.id).toBe(id);
    expect(game!.questions.map((q) => q.id)).toEqual(picked.map((q) => q.id));
  });

  it('does not serve a draft, or anything when generation is off', async () => {
    await makeStandardQuestions(7);
    await updateSettings({ autoGenerate: false });
    expect(await getTodayGame(DAY1)).toBeNull();
    await query(`insert into daily_games (game_date, status, question_count) values ('2026-03-10', 'draft', 7)`);
    await updateSettings({ autoGenerate: true });
    expect(await getTodayGame(DAY1)).toBeNull();
  });
});

/** Answer the running question, then start the next one a second later. */
async function play(viewer: Parameters<typeof startSession>[0], answersInOrder: string[], start = DAY1) {
  let now = start;
  let state: GameState = await startSession(viewer, now);
  for (const text of answersInOrder) {
    now = plus(now, 1000);
    const res = await submitAnswer(viewer, { questionId: state.current!.id, text }, now);
    if (res.status !== 'accepted') throw new Error(`expected accepted for ${text}, got ${res.status}`);
    state = res.state;
    if (!state.completed) state = await nextQuestion(viewer, (now = plus(now, 1000)));
  }
  return state;
}

/** The answer of a given tier letter for whichever question is currently showing. */
const answerFor = (state: GameState, letter: string) => `${letter}${state.current!.text.match(/(\d+)$/)![1]}`;

describe('game session', () => {
  beforeEach(async () => {
    await makeStandardQuestions(7);
  });

  it('scores a full game with fixed tier points and the right final form', async () => {
    const viewer = guest();
    let now = DAY1;
    let state = await startSession(viewer, now);
    expect(state).toMatchObject({ score: 0, form: 'base', phase: 'question', total: 7, position: 0 });
    const letters = ['c', 'r', 'e', 'u', 'u', 'u', 'u']; // 25+50+75+100*4 = 550
    const expected = [25, 75, 150, 250, 350, 450, 550];
    const forms = ['base', 'base', 'base', 'ascended', 'azure', 'azure', 'ultra'];
    for (let i = 0; i < 7; i++) {
      now = plus(now, 2000);
      const res = await submitAnswer(viewer, { questionId: state.current!.id, text: answerFor(state, letters[i]) }, now);
      expect(res.status).toBe('accepted');
      if (res.status !== 'accepted') return;
      expect(res.state.score).toBe(expected[i]);
      expect(res.state.form).toBe(forms[i]);
      expect(res.state.current).toBeNull();
      state = res.state.completed ? res.state : await nextQuestion(viewer, (now = plus(now, 500)));
    }
    expect(state).toMatchObject({ completed: true, phase: 'done', score: 550, form: 'ultra', validAnswers: 7 });
    const [row] = await query('select total_score, final_form, status from game_sessions');
    expect(row).toMatchObject({ total_score: 550, final_form: 'ultra', status: 'completed' });
  });

  it('never reveals later questions or any accepted-answer list', async () => {
    const viewer = guest();
    const state = await startSession(viewer, DAY1);
    const json = JSON.stringify(state);
    const texts = (await query<{ text: string }>('select text from questions')).map((q) => q.text);
    expect(texts.filter((t) => json.includes(t))).toEqual([state.current!.text]);
    expect(json).not.toMatch(/"(c|r|e|u)\d"/);
  });

  it('lets wrong answers be retried without penalty until one is valid', async () => {
    const viewer = guest();
    const state = await startSession(viewer, DAY1);
    for (const text of ['nope', 'still wrong', 'nope']) {
      const res = await submitAnswer(viewer, { questionId: state.current!.id, text }, plus(DAY1, 3000));
      expect(res).toMatchObject({ status: 'unrecognised', timeLeftMs: 27000 });
    }
    const ok = await submitAnswer(viewer, { questionId: state.current!.id, text: answerFor(state, 'r') }, plus(DAY1, 5000));
    expect(ok).toMatchObject({ status: 'accepted', result: { points: 50, tier: 'rare' } });
    expect(await query(`select count from unknown_answers where norm = 'nope'`)).toEqual([{ count: 2 }]);
    expect(await query('select 1 from submissions')).toHaveLength(1);
  });

  it('pays a question only once', async () => {
    const viewer = guest();
    const state = await startSession(viewer, DAY1);
    const input = { questionId: state.current!.id, text: answerFor(state, 'u') };
    await submitAnswer(viewer, input, plus(DAY1, 1000));
    await expect(submitAnswer(viewer, input, plus(DAY1, 1500))).rejects.toMatchObject({ code: 'ALREADY_ANSWERED' });
    await expect(
      submitAnswer(viewer, { ...input, text: answerFor(state, 'c') }, plus(DAY1, 1600)),
    ).rejects.toMatchObject({ code: 'ALREADY_ANSWERED' });
    expect((await getState(viewer, plus(DAY1, 2000)))!.score).toBe(100);
  });

  it('scores once when the same answer arrives twice at the same moment', async () => {
    const viewer = guest();
    const state = await startSession(viewer, DAY1);
    const input = { questionId: state.current!.id, text: answerFor(state, 'u') };
    const results = await Promise.allSettled([
      submitAnswer(viewer, input, plus(DAY1, 1000)),
      submitAnswer(viewer, input, plus(DAY1, 1000)),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await query('select 1 from submissions')).toHaveLength(1);
    expect((await getState(viewer, plus(DAY1, 2000)))!.score).toBe(100);
    expect(await query('select valid_count from answer_stats')).toEqual([{ valid_count: 1 }]);
  });

  it('closes a question at 0 points when the 30 second timer runs out', async () => {
    const viewer = guest();
    const state = await startSession(viewer, DAY1);
    expect(state.current).toMatchObject({ timeLeftMs: 30000, limitSec: 30 });
    // Inside the limit (plus a small network grace) an answer still counts...
    const other = guest();
    const s2 = await startSession(other, DAY1);
    expect(
      await submitAnswer(other, { questionId: s2.current!.id, text: answerFor(s2, 'c') }, plus(DAY1, 30_900)),
    ).toMatchObject({ status: 'accepted' });
    // ...after it, the question is lost even if the answer is right.
    const late = await submitAnswer(viewer, { questionId: state.current!.id, text: answerFor(state, 'u') }, plus(DAY1, 32_000));
    expect(late.status).toBe('timeout');
    if (late.status !== 'timeout') return;
    expect(late.state).toMatchObject({ score: 0, position: 1, phase: 'between', current: null });
    expect(late.state.answers[0]).toMatchObject({ points: 0, timedOut: true, answer: null });
  });

  it('does not burn later questions while the player is away', async () => {
    const viewer = guest();
    await startSession(viewer, DAY1);
    const back = await getState(viewer, plus(DAY1, 3_600_000));
    expect(back).toMatchObject({ position: 1, phase: 'between', current: null });
    const next = await nextQuestion(viewer, plus(DAY1, 3_600_500));
    expect(next).toMatchObject({ position: 1, phase: 'question' });
    expect(next.current!.timeLeftMs).toBe(30000);
  });

  it('only accepts answers for the question whose timer is running', async () => {
    const viewer = guest();
    const state = await startSession(viewer, DAY1);
    const others = await query<{ id: string }>('select id from questions where id <> $1', [state.current!.id]);
    await expect(
      submitAnswer(viewer, { questionId: others[0].id, text: 'c1' }, plus(DAY1, 1000)),
    ).rejects.toMatchObject({ code: 'NOT_CURRENT_QUESTION' });
    await submitAnswer(viewer, { questionId: state.current!.id, text: answerFor(state, 'c') }, plus(DAY1, 1000));
    // Timer for question 2 has not been started yet.
    await expect(
      submitAnswer(viewer, { questionId: others[0].id, text: 'c1' }, plus(DAY1, 2000)),
    ).rejects.toMatchObject({ code: expect.stringMatching(/NOT_STARTED|NOT_CURRENT_QUESTION/) });
    expect((await getState(viewer, plus(DAY1, 2500)))!.score).toBe(25);
  });

  it('cannot be restarted or replayed once finished', async () => {
    const viewer = guest();
    const first = await startSession(viewer, DAY1);
    const done = await play(viewer, ['c', 'c', 'c', 'c', 'c', 'c', 'c'].map((l, i) => l + '?'), DAY1).catch(() => null);
    expect(done).toBeNull(); // 'c?' is not an answer; nothing was scored
    const again = await startSession(viewer, plus(DAY1, 1000));
    expect(again.sessionId).toBe(first.sessionId);

    const other = guest();
    let state = await startSession(other, DAY1);
    let now = DAY1;
    while (!state.completed) {
      now = plus(now, 1000);
      const res = await submitAnswer(other, { questionId: state.current!.id, text: answerFor(state, 'c') }, now);
      if (res.status !== 'accepted') throw new Error(res.status);
      state = res.state.completed ? res.state : await nextQuestion(other, (now = plus(now, 500)));
    }
    expect(state.score).toBe(175);
    const restarted = await startSession(other, plus(now, 5000));
    expect(restarted).toMatchObject({ completed: true, score: 175, phase: 'done', current: null });
    const q = await query<{ id: string }>('select id from questions limit 1');
    await expect(submitAnswer(other, { questionId: q[0].id, text: 'u1' }, plus(now, 6000))).rejects.toMatchObject({
      code: 'GAME_OVER',
    });
    expect(await query('select 1 from game_sessions where guest_id = $1', [other.id])).toHaveLength(1);
  });

  it("rejects an answer for yesterday's unfinished game after the rollover", async () => {
    await makeStandardQuestions(7); // enough questions for a second day
    const viewer = guest();
    const state = await startSession(viewer, at('2026-03-10T23:59:50Z'));
    await expect(
      submitAnswer(viewer, { questionId: state.current!.id, text: answerFor(state, 'u') }, at('2026-03-11T00:00:05Z')),
    ).rejects.toMatchObject({ code: 'GAME_ENDED' });
    expect(await query('select 1 from submissions')).toHaveLength(0);
    // Yesterday's result stays readable; today starts clean.
    expect(await getResultForDate(viewer, '2026-03-10', DAY2)).toMatchObject({ score: 0, completed: false });
    expect(await startSession(viewer, DAY2)).toMatchObject({ date: '2026-03-11', score: 0, position: 0 });
  });

  it('keeps players apart: one player cannot see or touch another session', async () => {
    const a = guest();
    const b = guest();
    const sa = await startSession(a, DAY1);
    await submitAnswer(a, { questionId: sa.current!.id, text: answerFor(sa, 'u') }, plus(DAY1, 1000));
    expect(await getState(b, plus(DAY1, 2000))).toBeNull();
    const sb = await startSession(b, plus(DAY1, 2000));
    expect(sb.sessionId).not.toBe(sa.sessionId);
    expect(sb.score).toBe(0);
    expect(await getResultForDate(b, '2026-03-10', plus(DAY1, 3000))).toMatchObject({ score: 0 });
  });

  it('updates profile totals and streaks for registered players', async () => {
    await makeStandardQuestions(7);
    const user = await makeUser('tester');
    const run = async (start: Date) => {
      let now = start;
      let state = await startSession(user, now);
      while (!state.completed) {
        now = plus(now, 1000);
        const res = await submitAnswer(user, { questionId: state.current!.id, text: answerFor(state, 'r') }, now);
        if (res.status !== 'accepted') throw new Error(res.status);
        state = res.state.completed ? res.state : await nextQuestion(user, (now = plus(now, 500)));
      }
    };
    await run(DAY1);
    await run(DAY2);
    const [p] = await query('select games_played, total_points, streak, longest_streak, last_played_date::text as d from profiles');
    expect(p).toEqual({ games_played: 2, total_points: 700, streak: 2, longest_streak: 2, d: '2026-03-11' });
  });
});

describe('streaks', () => {
  it('counts consecutive days ending today or yesterday', () => {
    const days = ['2026-03-07', '2026-03-08', '2026-03-09'];
    expect(streakFromDates(days, '2026-03-09')).toEqual({ current: 3, longest: 3 });
    expect(streakFromDates(days, '2026-03-10')).toEqual({ current: 3, longest: 3 });
    expect(streakFromDates(days, '2026-03-11')).toEqual({ current: 0, longest: 3 });
    expect(streakFromDates([...days, '2026-03-11'], '2026-03-11')).toEqual({ current: 1, longest: 3 });
    expect(streakFromDates([], '2026-03-11')).toEqual({ current: 0, longest: 0 });
  });
});
