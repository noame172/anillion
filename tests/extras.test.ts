import { beforeEach, describe, expect, it } from 'vitest';
import { getAllAnswers } from '@/lib/game/answers';
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
    expect(await getAllAnswers(p, '2026-03-10')).toBeNull();
    await startSession(p, DAY1);
    expect(await getAllAnswers(p, '2026-03-10')).toBeNull();
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
    const all = await getAllAnswers(p, '2026-03-10');
    expect(all).toHaveLength(7);
    const first = all![0];
    expect(first.position).toBe(0);
    expect(first.yours).toMatch(/^u\d$/);
    expect(first.answers.map((a) => a.tier).sort()).toEqual(['common', 'epic', 'rare', 'ultra']);
    expect(first.answers.find((a) => a.tier === 'ultra')).toMatchObject({ points: 100, share: null });
    // Another player who has not finished still gets nothing.
    expect(await getAllAnswers(guest(), '2026-03-10')).toBeNull();
  });
});

describe('starter questions', () => {
  it('has no name claimed by two answers of the same question', async () => {
    const { findSeedCollisions, loadSeedFile } = await import('@/lib/db/seed');
    expect(findSeedCollisions(loadSeedFile())).toEqual([]);
  });
});
