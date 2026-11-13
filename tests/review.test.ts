import crypto from 'node:crypto';
import fs from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { ensureProfile } from '@/lib/auth/profile';
import { query } from '@/lib/db/client';
import { closestAnswer } from '@/lib/game/fuzzy';
import { nextQuestion, startSession, submitAnswer } from '@/lib/game/session';
import { matchAnswer } from '@/lib/game/validate';
import { at, freshDb, guest, makeQuestion } from './helpers';

describe('near-miss spelling: things that are not typos', () => {
  const list = [
    { answerId: 'db', norm: 'dragon ball' },
    { answerId: 'lupin3', norm: 'lupin iii' },
    { answerId: 'rider', norm: 'license less rider' },
  ];

  it('rejects a guess that only adds or drops a whole word', () => {
    expect(closestAnswer('dragon ball z', list)).toBeNull();
    expect(closestAnswer('dragon ball gt', list)).toBeNull();
    expect(closestAnswer('dragn ball', list)).toBe('db');
  });

  it('treats roman numerals like numbers', () => {
    expect(closestAnswer('lupin ii', list)).toBeNull();
    expect(closestAnswer('lupan iii', list)).toBe('lupin3');
  });

  it('still accepts a typo that also changes the spacing', () => {
    expect(closestAnswer('licenseless ridr', list)).toBe('rider');
  });

  it('never credits a guess that is exactly a name the admin has not accepted', async () => {
    await freshDb();
    const q = await makeQuestion('Name an Evangelion character.', [
      { name: 'Asuka' },
      { name: 'Asuna', verified: false },
      { name: 'Sasuke' },
    ]);
    expect(await matchAnswer(q.id, 'Asuna')).toBeNull();
    await query(
      `insert into unknown_answers (question_id, norm, raw_text, status) values ($1, 'sosuke', 'Sosuke', 'rejected')`,
      [q.id],
    );
    expect(await matchAnswer(q.id, 'Sosuke')).toBeNull();
    expect((await matchAnswer(q.id, 'Sasuuke'))?.canonical).toBe('Sasuke');
  });
});

describe('profiles created at sign-in', () => {
  beforeEach(async () => {
    await freshDb();
  });

  async function newUser(email: string) {
    const id = crypto.randomUUID();
    await query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
    return id;
  }

  it('does not publish the email name as the username', async () => {
    const id = await newUser('john.doe@example.test');
    await ensureProfile(id, 'john.doe@example.test');
    const [p] = await query('select username from profiles where id = $1', [id]);
    expect(p.username).toMatch(/^player\d{4,}$/);
  });

  it('keeps a username the player chose', async () => {
    const id = await newUser('a@example.test');
    await ensureProfile(id, 'a@example.test', 'chosen_name');
    const [p] = await query('select username from profiles where id = $1', [id]);
    expect(p.username).toBe('chosen_name');
  });

  it('only promotes a listed admin email once the email is verified', async () => {
    const before = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = 'boss@example.test';
    try {
      const id = await newUser('boss@example.test');
      await ensureProfile(id, 'boss@example.test', 'boss', false);
      expect((await query('select role from profiles where id = $1', [id]))[0].role).toBe('user');
      await ensureProfile(id, 'boss@example.test', 'boss', true);
      expect((await query('select role from profiles where id = $1', [id]))[0].role).toBe('admin');
    } finally {
      if (before === undefined) delete process.env.ADMIN_EMAILS;
      else process.env.ADMIN_EMAILS = before;
    }
  });
});

describe('database permissions', () => {
  it('gives the public API roles no view over profiles and no default table access', () => {
    const sql = fs.readFileSync('supabase/migrations/0002_rls.sql', 'utf8');
    expect(sql).not.toMatch(/create view/i);
    expect(sql).toMatch(/alter default privileges in schema public revoke all on tables from anon, authenticated/i);
  });
});

describe('did you mean', () => {
  it('suggests the accepted name for a near miss, and scores only when that name is sent', async () => {
    await freshDb();
    for (let i = 1; i <= 7; i++) {
      await makeQuestion(`Name hero number ${i}.`, [{ name: 'Mumen Rider', tier: 'epic' }, { name: 'Saitama' }]);
    }
    const now = at('2026-03-10T12:00:00Z');
    const p = guest();
    const state = await startSession(p, now);
    const questionId = state.current!.id;

    const miss = await submitAnswer(p, { questionId, text: 'mumon rider' }, now);
    expect(miss).toMatchObject({ status: 'suggestion', suggestion: 'Mumen Rider' });
    // Nothing was scored and the question is still open.
    expect((await nextQuestion(p, now)).score).toBe(0);
    expect((await nextQuestion(p, now)).phase).toBe('question');

    const hit = await submitAnswer(p, { questionId, text: 'Mumen Rider' }, now);
    expect(hit).toMatchObject({ status: 'accepted', result: { answer: 'Mumen Rider', points: 75 } });
  });

  it('marks exact and near-miss matches apart', async () => {
    await freshDb();
    const q = await makeQuestion('Name a hero.', [{ name: 'Mumen Rider', aliases: ['Mumen'] }]);
    expect(await matchAnswer(q.id, 'MUMEN')).toMatchObject({ canonical: 'Mumen Rider', exact: true });
    expect(await matchAnswer(q.id, 'mumon rider')).toMatchObject({ canonical: 'Mumen Rider', exact: false });
  });
});
