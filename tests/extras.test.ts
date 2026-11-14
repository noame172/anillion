import { beforeEach, describe, expect, it } from 'vitest';
import { getAnswerSummaries, getQuestionAnswers } from '@/lib/game/answers';
import { formForTier, formPath } from '@/lib/game/forms';
import { closestAnswer, similarity } from '@/lib/game/fuzzy';
import { nextQuestion, startSession, submitAnswer } from '@/lib/game/session';
import { matchAnswer } from '@/lib/game/validate';
import { at, freshDb, guest, makeQuestion, makeStandardQuestions } from './helpers';

const DAY1 = at('2026-03-10T12:00:00Z');

describe('near-miss spelling', () => {
  it('scores similarity as the share of characters that match', () => {
    expect(similarity('mumen rider', 'mumen rider')).toBe(1);
    expect(similarity('mumon rider', 'mumen rider')).toBeCloseTo(10 / 11);
    expect(similarity('goku', 'gohu')).toBe(0.75);
    expect(similarity('', 'abc')).toBe(0);
  });

  it('picks the closest answer at 80% or better, and nothing when unsure', () => {
    const list = [
      { answerId: 'mumen', norm: 'mumen rider' },
      { answerId: 'saitama', norm: 'saitama' },
      { answerId: 'a17', norm: 'android 17' },
      { answerId: 'kira', norm: 'kiras' },
      { answerId: 'kida', norm: 'kidas' },
    ];
    expect(closestAnswer('mumon rider', list)).toBe('mumen');
    expect(closestAnswer('saitamma', list)).toBe('saitama');
    expect(closestAnswer('genos', list)).toBeNull();
    // Numbers must match exactly: "android 18" is a different character.
    expect(closestAnswer('android 18', list)).toBeNull();
    expect(closestAnswer('andriod 17', list)).toBe('a17');
    // Equally close to two different answers: accept neither.
    expect(closestAnswer('kizas', list)).toBeNull();
  });

  it('accepts a spelling that is at least 80% the same as an answer or alias', async () => {
    await freshDb();
    const q = await makeQuestion('Name a One Punch Man character.', [
      { name: 'Mumen Rider', aliases: ['License-less Rider'] },
      { name: 'Saitama' },
      { name: 'Tatsumaki', verified: false },
    ]);
    expect((await matchAnswer(q.id, 'mumon rider'))?.canonical).toBe('Mumen Rider');
    expect((await matchAnswer(q.id, 'licenseless ridr'))?.canonical).toBe('Mumen Rider');
    expect((await matchAnswer(q.id, 'Saitma'))?.canonical).toBe('Saitama');
    expect(await matchAnswer(q.id, 'Sonic')).toBeNull();
    // Unverified answers stay out, however close the spelling.
    expect(await matchAnswer(q.id, 'Tatsumaki')).toBeNull();
    expect(await matchAnswer(q.id, 'Tatsumakki')).toBeNull();
  });
});

describe('hero form for an answer', () => {
  it('maps an answer tier to a form, with every form on the way', () => {
    expect(formForTier('common')).toBe('base');
    expect(formForTier('rare')).toBe('ascended');
    expect(formForTier('epic')).toBe('azure');
    expect(formForTier('ultra')).toBe('ultra');
    expect(formForTier(null)).toBe('base');
    expect(formPath('base')).toEqual(['base']);
    expect(formPath('ultra')).toEqual(['base', 'ascended', 'azure', 'ultra']);
  });
});

describe('all answers after the game', () => {
  beforeEach(async () => {
    await freshDb();
    await makeStandardQuestions();
  });

  it('is locked until the player has finished that game', async () => {
    const p = guest();
    expect(await getAnswerSummaries(p, '2026-03-10')).toBeNull();
    await startSession(p, DAY1);
    expect(await getAnswerSummaries(p, '2026-03-10')).toBeNull();
    expect(await getQuestionAnswers(p, '2026-03-10', 0)).toBeNull();
  });

  it('lists every verified answer with its frozen tier once the game is done', async () => {
    const p = guest();
    let state = await startSession(p, DAY1);
    for (let i = 0; i < 7; i++) {
      const n = state.current!.text.match(/\d+/)![0];
      const res = await submitAnswer(p, { questionId: state.current!.id, text: `u${n}` }, DAY1);
      if (res.status !== 'accepted') throw new Error('expected accepted');
      state = i < 6 ? await nextQuestion(p, DAY1) : res.state;
    }
    const all = await getAnswerSummaries(p, '2026-03-10');
    expect(all).toHaveLength(7);
    expect(all![0]).toMatchObject({ position: 0, count: 4 });
    expect(all![0].yours).toMatch(/^u\d$/);
    // The summary carries no answer lists; each one is fetched separately.
    expect(JSON.stringify(all)).not.toContain('"tier"');
    const first = (await getQuestionAnswers(p, '2026-03-10', 0))!;
    expect(first.answers.map((a) => a.tier).sort()).toEqual(['common', 'epic', 'rare', 'ultra']);
    expect(first.answers.find((a) => a.tier === 'ultra')).toMatchObject({ points: 100, share: null });
    expect(await getQuestionAnswers(p, '2026-03-10', 99)).toBeNull();
    // Another player who has not finished still gets nothing.
    expect(await getAnswerSummaries(guest(), '2026-03-10')).toBeNull();
    expect(await getQuestionAnswers(guest(), '2026-03-10', 0)).toBeNull();
  });
});

describe('starter questions', () => {
  it('has no name claimed by two answers of the same question', async () => {
    const { findSeedCollisions, loadSeedFile } = await import('@/lib/db/seed');
    expect(findSeedCollisions(loadSeedFile())).toEqual([]);
  });
});

describe('starter catalogue', () => {
  it('is large, loads in a few bulk statements, and tops up an older database', async () => {
    const { loadSeedFile, seed } = await import('@/lib/db/seed');
    const { query } = await import('@/lib/db/client');
    const data = loadSeedFile();
    await freshDb();
    const started = Date.now();
    expect(await seed(await (await import('@/lib/db/client')).getDb(), data)).toBe(data.length);
    expect(Date.now() - started).toBeLessThan(20_000);

    const [{ n }] = await query<{ n: number }>(`select count(*)::int as n from answers`);
    expect(n).toBeGreaterThan(10_000);
    const long = await query<{ n: number }>(
      `select count(a.id)::int as n from questions q join answers a on a.question_id = q.id
        where q.text = 'Name an anime with more than 100 episodes.'`,
    );
    expect(long[0].n).toBeGreaterThan(250);
    for (const q of data) expect(q.answers.length, q.text).toBeGreaterThanOrEqual(15);

    // Running it again changes nothing; deleting some answers and running again restores them.
    const db = await (await import('@/lib/db/client')).getDb();
    expect(await seed(db, data)).toBe(0);
    await query(`delete from answers where norm = 'naruto uzumaki'`);
    await seed(db, data);
    expect(await query(`select 1 from answers where norm = 'naruto uzumaki'`)).toHaveLength(1);
    const [{ n: after }] = await query<{ n: number }>(`select count(*)::int as n from answers`);
    expect(after).toBe(n);
  });
});
