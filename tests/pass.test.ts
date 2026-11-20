import crypto from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { query } from '@/lib/db/client';
import { nextQuestion, passQuestion, startSession, submitAnswer } from '@/lib/game/session';
import { at, freshDb, guest, makeStandardQuestions, makeUser, plus } from './helpers';

const DAY1 = at('2026-03-10T12:00:00Z');

beforeEach(async () => {
  await freshDb();
  await makeStandardQuestions(7);
});

describe('passing a prompt', () => {
  it('scores 0 like a timeout, moves on, and records the pass', async () => {
    const viewer = guest();
    const state = await startSession(viewer, DAY1);
    const res = await passQuestion(viewer, { questionId: state.current!.id }, plus(DAY1, 2000));
    expect(res.status).toBe('passed');
    expect(res.state).toMatchObject({ position: 1, score: 0, phase: 'between' });
    expect(res.state.answers).toHaveLength(1);
    expect(res.state.answers[0]).toMatchObject({ points: 0, tier: null, answer: null, timedOut: true });
    const [row] = await query<{ raw_text: string; timed_out: boolean; points: number }>('select raw_text, timed_out, points from submissions');
    expect(row).toEqual({ raw_text: '[pass]', timed_out: true, points: 0 });
    // A pass never feeds the rarity statistics.
    expect(await query('select 1 from answer_stats')).toHaveLength(0);
  });

  it('only passes the current prompt, once', async () => {
    const viewer = guest();
    const first = await startSession(viewer, DAY1);
    const id = first.current!.id;
    await passQuestion(viewer, { questionId: id }, plus(DAY1, 1000));
    await expect(passQuestion(viewer, { questionId: id }, plus(DAY1, 1500))).rejects.toMatchObject({ code: 'ALREADY_ANSWERED' });
    await expect(submitAnswer(viewer, { questionId: id, text: 'c1' }, plus(DAY1, 1600))).rejects.toMatchObject({ code: 'ALREADY_ANSWERED' });
    // The next prompt's timer has not started, so there is nothing to pass yet.
    await expect(passQuestion(viewer, { questionId: crypto.randomUUID() }, plus(DAY1, 2000))).rejects.toMatchObject({ code: 'NOT_STARTED' });
    const second = await nextQuestion(viewer, plus(DAY1, 3000));
    await expect(passQuestion(viewer, { questionId: crypto.randomUUID() }, plus(DAY1, 3500))).rejects.toMatchObject({ code: 'NOT_CURRENT_QUESTION' });
    expect(second.current!.id).not.toBe(id);
    expect(await query('select 1 from submissions')).toHaveLength(1);
  });

  it('after time has run out the prompt just times out', async () => {
    const viewer = guest();
    const state = await startSession(viewer, DAY1);
    const res = await passQuestion(viewer, { questionId: state.current!.id }, plus(DAY1, 3_600_000));
    expect(res.status).toBe('timeout');
    expect(res.state.answers).toHaveLength(1);
  });

  it('can be mixed with answers, and passing everything still finishes the game', async () => {
    const user = await makeUser('passer');
    let now = DAY1;
    let state = await startSession(user, now);
    const n = state.current!.text.match(/(\d+)$/)![1]; // prompts come in a random order
    const accepted = await submitAnswer(user, { questionId: state.current!.id, text: `u${n}` }, (now = plus(now, 1000)));
    expect(accepted.status).toBe('accepted');
    state = await nextQuestion(user, (now = plus(now, 500)));
    while (!state.completed) {
      const res = await passQuestion(user, { questionId: state.current!.id }, (now = plus(now, 1000)));
      state = res.state;
      if (!state.completed) state = await nextQuestion(user, (now = plus(now, 500)));
    }
    expect(state).toMatchObject({ completed: true, score: 100, validAnswers: 1 });
    const [p] = await query('select games_played, total_points from profiles where id = $1', [user.id]);
    expect(p).toEqual({ games_played: 1, total_points: 100 });
  });

  it('cannot pass a finished game', async () => {
    const viewer = guest();
    let now = DAY1;
    let state = await startSession(viewer, now);
    while (!state.completed) {
      state = (await passQuestion(viewer, { questionId: state.current!.id }, (now = plus(now, 1000)))).state;
      if (!state.completed) state = await nextQuestion(viewer, (now = plus(now, 500)));
    }
    await expect(passQuestion(viewer, { questionId: crypto.randomUUID() }, plus(now, 1000))).rejects.toMatchObject({ code: 'GAME_OVER' });
  });
});
