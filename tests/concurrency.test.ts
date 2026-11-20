import crypto from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { addAlias, addAnswer, addAnswers, getQuestion, listQuestions, removeQuestion } from '@/lib/admin/questions';
import { createGame, deleteGame, getGameAdmin, listGames, updateGame } from '@/lib/admin/games';
import { updateUser } from '@/lib/admin/users';
import { changeUsername, ensureProfile } from '@/lib/auth/profile';
import { registerLocal } from '@/lib/auth/local';
import { query, setDb, type Driver } from '@/lib/db/client';
import { uniqueViolation } from '@/lib/db/errors';
import { migrate } from '@/lib/db/migrate';
import { createPgliteDriver } from '@/lib/db/pglite';
import { getTodayGame } from '@/lib/game/daily';
import { mergeGuestIntoUser } from '@/lib/game/merge';
import { lockLiveGame, startSession, submitAnswer } from '@/lib/game/session';
import { matchAnswer } from '@/lib/game/validate';
import { getHistory } from '@/lib/profile-data';
import { getSettings, updateSettings } from '@/lib/settings';
import { at, freshDb, guest, makeQuestion, makeStandardQuestions, makeUser } from './helpers';

const NOW = at('2026-03-10T12:00:00Z');

/** Wrap the test database so every statement is counted. */
function counting(db: Driver) {
  let n = 0;
  setDb({
    ...db,
    query: (sql, params) => (n++, db.query(sql, params)),
    tx: (fn) =>
      db.tx((q) =>
        fn({
          ...q,
          query: (sql, params) => (n++, q.query(sql, params)),
        }),
      ),
  });
  return {
    count: () => n,
    reset: () => void (n = 0),
    stop: () => setDb(db),
  };
}

let db: Driver;
beforeEach(async () => {
  db = await freshDb();
});

describe('queries that must not grow with the amount of data', () => {
  it('adds an answer with 30 aliases in a fixed number of statements', async () => {
    const q = await makeQuestion('Name a hero.', [{ name: 'Seed' }]);
    const spy = counting(db);
    const aliases = Array.from({ length: 30 }, (_, i) => `alias number ${i}`);
    await addAnswer(q.id, { canonical: 'Big Hero', aliases });
    expect(spy.count()).toBeLessThanOrEqual(8);
    spy.stop();
    const detail = await getQuestion(q.id);
    expect(detail.answers.find((a) => a.canonical === 'Big Hero')!.aliases).toHaveLength(30);
  });

  it('bulk-adds hundreds of answers (imports, AI drafts) in a fixed number of statements', async () => {
    const q = await makeQuestion('Name a character.', [{ name: 'Existing' }]);
    const items = Array.from({ length: 600 }, (_, i) => ({
      canonical: `Character ${i}`,
      aliases: [`Char ${i}`, `Chara ${i}`, 'Existing'],
      provisionalTier: 'ultra',
      verified: false,
    }));
    items.push({ canonical: 'existing', aliases: [], provisionalTier: 'ultra', verified: false }); // clashes with an answer
    items.push({ canonical: '!!!', aliases: [], provisionalTier: 'ultra', verified: false }); // no letters
    const spy = counting(db);
    const result = await addAnswers(q.id, items);
    expect(spy.count()).toBeLessThanOrEqual(12);
    spy.stop();
    expect(result).toEqual({ added: 600, skipped: 2 });
    const detail = await getQuestion(q.id);
    expect(detail.answers).toHaveLength(601);
    expect(detail.answers.find((a) => a.canonical === 'Character 7')!.aliases.map((a) => a.alias).sort()).toEqual([
      'Char 7',
      'Chara 7',
    ]);
    // "Existing" was already an answer, so it is never also an alias.
    expect(await query(`select 1 from answer_aliases where norm = 'existing'`)).toHaveLength(0);
  });

  it('checks an exact answer with one statement and only loads every name on a miss', async () => {
    const q = await makeQuestion('Name a hero.', [{ name: 'Mumen Rider', aliases: ['License-less Rider'] }, { name: 'Saitama' }]);
    const spy = counting(db);
    await matchAnswer(q.id, 'saitama');
    expect(spy.count()).toBe(1);
    spy.reset();
    await matchAnswer(q.id, 'License less rider');
    expect(spy.count()).toBe(1);
    spy.reset();
    expect((await matchAnswer(q.id, 'mumon rider'))?.exact).toBe(false);
    expect(spy.count()).toBe(3);
    spy.stop();
  });

  it('lists questions, games and game contents with one statement each and correct counts', async () => {
    const qs = await makeStandardQuestions(8);
    await query(`insert into unknown_answers (question_id, norm, raw_text) values ($1, 'zzz', 'zzz')`, [qs[0].id]);
    await query(`update answers set verified = false where id = $1`, [qs[0].answers.c1]);
    const gameId = await createGame({ date: '2026-03-12', questionIds: qs.slice(0, 7).map((q) => q.id) });

    const spy = counting(db);
    const list = await listQuestions('');
    expect(spy.count()).toBe(1);
    spy.reset();
    const games = await listGames();
    expect(spy.count()).toBe(1);
    spy.reset();
    const detail = await getGameAdmin(gameId);
    expect(spy.count()).toBe(2);
    spy.stop();

    const first = list.find((q: any) => q.id === qs[0].id)!;
    expect(first).toMatchObject({ answers: 3, unverified: 1, unknown: 1, submissions: 0, last_used: '2026-03-12' });
    expect(list.find((q: any) => q.id === qs[7].id)).toMatchObject({ answers: 4, unknown: 0, last_used: null });
    expect(games[0]).toMatchObject({ sessions: 0, completed: 0, avg_score: null });
    expect(detail.questions.map((q: any) => q.answers)).toEqual([3, 4, 4, 4, 4, 4, 4]);
  });

  it('numbers a player\'s games in one statement', async () => {
    await makeStandardQuestions();
    const p = guest();
    await startSession(p, NOW);
    await startSession(p, at('2026-03-11T12:00:00Z'));
    const spy = counting(db);
    const history = await getHistory(p);
    expect(spy.count()).toBe(1);
    spy.stop();
    expect(history.map((h) => [h.date, h.gameNumber])).toEqual([
      ['2026-03-11', 2],
      ['2026-03-10', 1],
    ]);
  });
});

describe('settings lookups', () => {
  it('are answered from a short cache, and a save is visible immediately', async () => {
    const spy = counting(db);
    await getSettings();
    await getSettings();
    await getSettings();
    expect(spy.count()).toBe(1);
    await updateSettings({ timeLimitSec: 20 });
    spy.reset();
    expect((await getSettings()).timeLimitSec).toBe(20);
    spy.stop();
  });
});

describe('simultaneous requests', () => {
  it('lets only one of two identical answer names win, and the loser gets a clear error', async () => {
    const q = await makeQuestion('Name a hero.', []);
    const results = await Promise.allSettled([
      addAnswer(q.id, { canonical: 'Saitama' }),
      addAnswer(q.id, { canonical: 'SAITAMA!' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ code: 'NAME_TAKEN' });
  });

  it('never lets a name belong to an answer and to another answer\'s alias at the same time', async () => {
    const q = await makeQuestion('Name a hero.', [{ name: 'Alpha' }]);
    await Promise.allSettled([
      addAnswer(q.id, { canonical: 'Genos' }),
      addAlias(q.answers.Alpha, 'genos'),
      addAnswer(q.id, { canonical: 'Other', aliases: ['Genos'] }),
    ]);
    const owners = await query<{ norm: string; n: number }>(
      `select norm, count(*)::int as n from (
         select norm from answers where question_id = $1
         union all select norm from answer_aliases where question_id = $1) t
       group by norm having count(*) > 1`,
      [q.id],
    );
    expect(owners).toEqual([]);
  });

  it('lets a second game for the same date fail cleanly instead of with a database error', async () => {
    const qs = await makeStandardQuestions();
    const ids = qs.map((q) => q.id);
    const results = await Promise.allSettled([
      createGame({ date: '2026-04-01', questionIds: ids }),
      createGame({ date: '2026-04-01', questionIds: ids }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: 'DATE_TAKEN' });
  });

  it('turns two sign-ups with the same email or username into clear conflicts', async () => {
    const a = { email: 'same@example.test', password: 'correct horse battery', username: 'first_one' };
    const sameEmail = await Promise.allSettled([registerLocal(a), registerLocal({ ...a, username: 'second_one' })]);
    expect(sameEmail.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((sameEmail.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: 'EMAIL_TAKEN' });

    const b = { password: 'correct horse battery', username: 'shared_name' };
    const sameName = await Promise.allSettled([
      registerLocal({ ...b, email: 'one@example.test' }),
      registerLocal({ ...b, email: 'two@example.test' }),
    ]);
    expect(sameName.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((sameName.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: 'USERNAME_TAKEN' });
  });

  it('recognises a unique-violation raised by the database driver', async () => {
    await makeUser('taken_name');
    const err = await query(`insert into profiles (id, username) values (gen_random_uuid(), 'TAKEN_NAME')`).catch((e) => e);
    // (the profile needs an auth user, so this fails on the foreign key first; use the username index directly)
    expect(err).toBeInstanceOf(Error);
    const dup = await (async () => {
      const id = crypto.randomUUID();
      await query('insert into auth.users (id, email) values ($1, $2)', [id, 'x@example.test']);
      return query('insert into profiles (id, username) values ($1, $2)', [id, 'taken_NAME']).catch((e) => e);
    })();
    expect(uniqueViolation(dup)).toContain('username');
  });

  it('gives parallel first requests and name clashes a profile each, with distinct usernames', async () => {
    const ids = await Promise.all(
      Array.from({ length: 4 }, async (_, i) => {
        const id = crypto.randomUUID();
        await query('insert into auth.users (id, email) values ($1, $2)', [id, `p${i}@example.test`]);
        return id;
      }),
    );
    // Four people choosing the same name, each request sent twice at once.
    await Promise.all(ids.flatMap((id) => [ensureProfile(id, undefined, 'popular'), ensureProfile(id, undefined, 'popular')]));
    const rows = await query<{ id: string; username: string }>('select id, username from profiles');
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.username.toLowerCase())).size).toBe(4);
  });

  it('rejects a username change that loses the race with a clean conflict', async () => {
    const a = await makeUser('user_a');
    await makeUser('user_b');
    await expect(changeUsername(a.id, 'USER_B')).rejects.toMatchObject({ code: 'USERNAME_TAKEN' });
  });

  it('never lets two administrators demote each other and leave the site with none', async () => {
    const a = await makeUser('admin_a', 'admin');
    const b = await makeUser('admin_b', 'admin');
    const results = await Promise.allSettled([
      updateUser(a.id, b.id, { role: 'user' }),
      updateUser(b.id, a.id, { role: 'user' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const admins = await query(`select 1 from profiles where role = 'admin' and not suspended`);
    expect(admins).toHaveLength(1);
    // Suspending or demoting the last active administrator is refused as well.
    const helper = await makeUser('helper');
    const [{ id: onlyAdmin }] = await query<{ id: string }>(`select id from profiles where role = 'admin'`);
    await expect(updateUser(helper.id, onlyAdmin, { suspended: true })).rejects.toMatchObject({ status: 400 });
    await expect(updateUser(helper.id, onlyAdmin, { role: 'user' })).rejects.toMatchObject({ status: 400 });
  });

  it('keeps both administrators\' settings changes when they save at the same time', async () => {
    await Promise.all([updateSettings({ timeLimitSec: 45 }), updateSettings({ questionsPerGame: 9 })]);
    expect(await getSettings()).toMatchObject({ timeLimitSec: 45, questionsPerGame: 9 });
  });

  it('serialises a guest merge with the account starting the same game', async () => {
    await makeStandardQuestions();
    const user = await makeUser('both_ways');
    const g = guest();
    await startSession(g, NOW);
    const results = await Promise.allSettled([startSession(user, NOW), mergeGuestIntoUser(g.id, user.id, NOW)]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const rows = await query(`select 1 from game_sessions where user_id = $1`, [user.id]);
    expect(rows).toHaveLength(1);
  });

  it('refuses to start a session on a game that is not live', async () => {
    await makeStandardQuestions();
    const game = (await getTodayGame(NOW))!;
    await expect(lockLiveGame(game.id)).resolves.toBeUndefined();
    await updateGame(game.id, { action: 'unpublish' });
    await expect(lockLiveGame(game.id)).rejects.toMatchObject({ code: 'NO_GAME' });
  });

  it('will not delete a game once anyone has started it, or a question a game uses', async () => {
    const qs = await makeStandardQuestions();
    const game = (await getTodayGame(NOW))!;
    await startSession(guest(), NOW);
    await expect(deleteGame(game.id)).rejects.toMatchObject({ code: 'GAME_LOCKED' });
    expect(await removeQuestion(qs[0].id)).toBe('deactivated');
    const extra = await makeQuestion('Unused question text.', [{ name: 'x' }]);
    expect(await removeQuestion(extra.id)).toBe('deleted');
  });

  it('treats an answer deleted or unverified at the last moment as not on the list', async () => {
    await makeStandardQuestions();
    const p = guest();
    const state = await startSession(p, NOW);
    const questionId = state.current!.id;
    const n = state.current!.text.match(/\d+/)![0];
    await query(`update answers set verified = false where question_id = $1 and canonical = $2`, [questionId, `u${n}`]);
    const res = await submitAnswer(p, { questionId, text: `u${n}` }, NOW);
    expect(res.status).toBe('unrecognised');
  });
});

describe('migrations', () => {
  it('apply once even when two deploys run them at the same time', async () => {
    const fresh = await createPgliteDriver();
    await Promise.all([migrate(fresh, { stubSupabase: true }), migrate(fresh, { stubSupabase: true })]);
    const rows = await fresh.query<{ name: string }>('select name from _migrations order by name');
    expect(rows.map((r) => r.name)).toEqual(['0001_schema.sql', '0002_rls.sql', '0003_migrations_rls.sql', '0004_beta_tester.sql']);
    await fresh.close();
  });
});
