import { beforeEach, describe, expect, it, vi } from 'vitest';

// A stand-in for the request cookie jar, so the real viewer code can run under test.
const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

import { NextRequest } from 'next/server';
import { SignJWT } from 'jose';
import { query } from '@/lib/db/client';
import { loginLocal, registerLocal } from '@/lib/auth/local';
import { changeUsername, deleteAccount } from '@/lib/auth/profile';
import { signToken, verifyToken } from '@/lib/auth/tokens';
import { GUEST_COOKIE, SESSION_COOKIE, getViewer, requireAdmin, requireUser, setLocalSession } from '@/lib/auth/viewer';
import { addAnswer, resolveUnknown } from '@/lib/admin/questions';
import { createGame, updateGame } from '@/lib/admin/games';
import { getAnalytics, suspiciousActivity, updateUser } from '@/lib/admin/users';
import { mergeGuestIntoUser } from '@/lib/game/merge';
import { answerBodySchema } from '@/lib/game/schemas';
import { getResultForDate, nextQuestion, startSession, submitAnswer, type Viewer } from '@/lib/game/session';
import { matchAnswer } from '@/lib/game/validate';
import { allTimeLeaderboard, dailyLeaderboard } from '@/lib/leaderboard';
import { getHistory, getProfile } from '@/lib/profile-data';
import { api, assertSameOrigin } from '@/lib/security/http';
import { rateLimit } from '@/lib/security/ratelimit';
import { at, freshDb, guest, makeStandardQuestions, makeUser, plus } from './helpers';

const DAY1 = at('2026-03-10T12:00:00Z');

beforeEach(async () => {
  jar.clear();
  await freshDb();
});

async function finish(viewer: Viewer, letter: string, start = DAY1) {
  let now = start;
  let state = await startSession(viewer, now);
  while (!state.completed) {
    now = plus(now, 1000);
    const n = state.current!.text.match(/(\d+)$/)![1];
    const res = await submitAnswer(viewer, { questionId: state.current!.id, text: `${letter}${n}` }, now);
    if (res.status !== 'accepted') throw new Error(res.status);
    state = res.state.completed ? res.state : await nextQuestion(viewer, (now = plus(now, 500)));
  }
  return state;
}

describe('accounts', () => {
  const creds = { email: 'Ash@Example.test', password: 'correct horse battery', username: 'ash_k' };

  it('registers, never stores the password, and logs in case-insensitively', async () => {
    const id = await registerLocal(creds);
    const [row] = await query('select email, password_hash from local_credentials');
    expect(row.email).toBe('ash@example.test');
    expect(row.password_hash).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(JSON.stringify(row)).not.toContain(creds.password);
    expect(await loginLocal('ASH@example.test', creds.password)).toBe(id);
  });

  it('logs in with the username instead of the email', async () => {
    const id = await registerLocal(creds);
    expect(await loginLocal('ash_k', creds.password)).toBe(id);
    expect(await loginLocal('ASH_K', creds.password)).toBe(id);
    expect(await loginLocal('ash_k', 'wrong password')).toBeNull();
    expect(await loginLocal('ash_x', creds.password)).toBeNull();
  });

  it('rejects wrong passwords and unknown emails the same way', async () => {
    await registerLocal(creds);
    expect(await loginLocal(creds.email, 'wrong password')).toBeNull();
    expect(await loginLocal('nobody@example.test', creds.password)).toBeNull();
    expect(await loginLocal('not-an-email', creds.password)).toBeNull();
  });

  it('refuses duplicate emails and usernames, weak passwords and bad usernames', async () => {
    await registerLocal(creds);
    await expect(registerLocal({ ...creds, username: 'other' })).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
    await expect(registerLocal({ ...creds, email: 'b@example.test', username: 'ASH_K' })).rejects.toMatchObject({
      code: 'USERNAME_TAKEN',
    });
    await expect(registerLocal({ email: 'c@example.test', password: 'short', username: 'cccc' })).rejects.toThrow();
    await expect(
      registerLocal({ email: 'd@example.test', password: 'long enough pw', username: '<script>' }),
    ).rejects.toThrow();
  });

  it('changes usernames with uniqueness enforced', async () => {
    const a = await registerLocal(creds);
    await registerLocal({ email: 'b@example.test', password: 'long enough pw', username: 'brock' });
    await expect(changeUsername(a, 'Brock')).rejects.toMatchObject({ code: 'USERNAME_TAKEN' });
    expect(await changeUsername(a, 'misty_w')).toBe('misty_w');
  });

  it('deletes an account and detaches its game history', async () => {
    await makeStandardQuestions(7);
    const id = await registerLocal(creds);
    const viewer: Viewer = { kind: 'user', id, role: 'user', username: 'ash_k' };
    await finish(viewer, 'c');
    await deleteAccount(id);
    expect(await query('select 1 from profiles')).toHaveLength(0);
    expect(await query('select 1 from local_credentials')).toHaveLength(0);
    expect(await query('select user_id from game_sessions')).toEqual([{ user_id: null }]);
    expect(await loginLocal(creds.email, creds.password)).toBeNull();
  });
});

describe('identity and authorisation', () => {
  it('treats missing, forged and wrong-kind cookies as a guest', async () => {
    const user = await makeUser('realuser', 'admin');
    await expect(requireUser()).rejects.toMatchObject({ status: 401 });

    // Unsigned / wrong-secret token claiming to be the admin.
    const forged = await new SignJWT({ k: 'user' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setExpirationTime('1d')
      .sign(new TextEncoder().encode('attacker-secret-attacker-secret-1234'));
    jar.set(SESSION_COOKIE, forged);
    await expect(requireUser()).rejects.toMatchObject({ status: 401 });
    expect((await getViewer()).kind).toBe('guest');

    // A genuine guest token cannot be replayed as a login session.
    jar.set(SESSION_COOKIE, await signToken('guest', user.id, 1));
    await expect(requireUser()).rejects.toMatchObject({ status: 401 });
    expect(await verifyToken('garbage', 'user')).toBeNull();
  });

  it('gives guests a stable signed identity', async () => {
    const first = await getViewer();
    expect(first.kind).toBe('guest');
    expect(jar.has(GUEST_COOKIE)).toBe(true);
    expect((await getViewer()).id).toBe(first.id);
  });

  it('lets only administrators through requireAdmin, using the role stored in the database', async () => {
    await expect(requireAdmin()).rejects.toMatchObject({ status: 401 });
    const user = await makeUser('regular');
    await setLocalSession(user.id);
    expect(await requireUser()).toMatchObject({ id: user.id, role: 'user' });
    await expect(requireAdmin()).rejects.toMatchObject({ status: 403 });

    const admin = await makeUser('boss', 'admin');
    await setLocalSession(admin.id);
    expect(await requireAdmin()).toMatchObject({ id: admin.id, role: 'admin' });

    // Demotion takes effect immediately; the cookie carries no role.
    await query(`update profiles set role = 'user' where id = $1`, [admin.id]);
    await expect(requireAdmin()).rejects.toMatchObject({ status: 403 });
  });

  it('locks suspended accounts out', async () => {
    const user = await makeUser('banned');
    await setLocalSession(user.id);
    await query('update profiles set suspended = true where id = $1', [user.id]);
    await expect(getViewer()).rejects.toMatchObject({ status: 403 });
  });

  it('stops admins changing their own role and validates role values', async () => {
    const admin = await makeUser('boss', 'admin');
    const user = await makeUser('regular');
    await expect(updateUser(admin.id, admin.id, { role: 'user' })).rejects.toMatchObject({ status: 400 });
    await expect(updateUser(admin.id, user.id, { role: 'superuser' })).rejects.toThrow();
    await updateUser(admin.id, user.id, { suspended: true });
    expect(await query('select suspended, role from profiles where id = $1', [user.id])).toEqual([
      { suspended: true, role: 'user' },
    ]);
  });
});

describe('request hardening', () => {
  const request = (headers: Record<string, string>, method = 'POST') =>
    new NextRequest('http://anillion.test/api/game/answer', { method, headers });

  it('blocks cross-site state-changing requests', () => {
    expect(() => assertSameOrigin(request({ host: 'anillion.test', origin: 'http://anillion.test' }))).not.toThrow();
    expect(() => assertSameOrigin(request({ host: 'anillion.test', origin: 'https://evil.test' }))).toThrow();
    expect(() => assertSameOrigin(request({ host: 'anillion.test', origin: 'null' }))).toThrow();
  });

  it('strips score fields a client tries to send with an answer', () => {
    const parsed = answerBodySchema.parse({
      questionId: '7b0a8a1e-0d2f-4c59-9d0e-0a0a0a0a0a0a',
      text: '  Goku ',
      points: 100,
      tier: 'ultra',
      share: 0.1,
      userId: 'someone-else',
      score: 9999,
    });
    expect(parsed).toEqual({ questionId: '7b0a8a1e-0d2f-4c59-9d0e-0a0a0a0a0a0a', text: 'Goku' });
    expect(() => answerBodySchema.parse({ questionId: 'nope', text: 'x' })).toThrow();
    expect(() => answerBodySchema.parse({ questionId: '7b0a8a1e-0d2f-4c59-9d0e-0a0a0a0a0a0a', text: 'a'.repeat(81) })).toThrow();
  });

  it('turns errors into safe responses without leaking internals', async () => {
    const boom = api(async () => {
      await query('select * from table_that_does_not_exist');
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await boom(request({ host: 'anillion.test' }, 'GET'), { params: Promise.resolve({}) });
    spy.mockRestore();
    expect(res.status).toBe(500);
    const body = JSON.stringify(await res.json());
    expect(body).not.toMatch(/table_that_does_not_exist|select|relation/i);

    const cross = api(async () => ({ ok: true }));
    const blocked = await cross(request({ host: 'anillion.test', origin: 'https://evil.test' }), {
      params: Promise.resolve({}),
    });
    expect(blocked.status).toBe(403);
  });

  it('enforces rate limits per key and window', async () => {
    const t = at('2026-03-10T12:00:10Z');
    for (let i = 0; i < 5; i++) await rateLimit('login:ip:1.2.3.4', 5, 900, t);
    await expect(rateLimit('login:ip:1.2.3.4', 5, 900, t)).rejects.toMatchObject({ status: 429, code: 'RATE_LIMITED' });
    await expect(rateLimit('login:ip:5.6.7.8', 5, 900, t)).resolves.toBeUndefined();
    // A new window starts clean.
    await expect(rateLimit('login:ip:1.2.3.4', 5, 900, plus(t, 900_000))).resolves.toBeUndefined();
  });
});

describe('player data separation', () => {
  beforeEach(async () => {
    await makeStandardQuestions(7);
  });

  it('only ever returns the caller’s own history and results', async () => {
    const alice = await makeUser('alice');
    const bob = await makeUser('bob');
    await finish(alice, 'u');
    expect(await getHistory(alice)).toHaveLength(1);
    expect(await getHistory(bob)).toHaveLength(0);
    expect(await getResultForDate(bob, '2026-03-10', DAY1)).toBeNull();
    expect((await getProfile(alice.id, DAY1))!.totalPoints).toBe(700);
    expect((await getProfile(bob.id, DAY1))!.totalPoints).toBe(0);
  });

  it('moves a guest game onto a new account exactly once', async () => {
    const g = guest();
    await finish(g, 'r'); // 350
    const user = await makeUser('newbie');
    expect(await mergeGuestIntoUser(g.id, user.id, DAY1)).toBe(1);
    expect(await mergeGuestIntoUser(g.id, user.id, DAY1)).toBe(0);
    expect(await getProfile(user.id, DAY1)).toMatchObject({ gamesPlayed: 1, totalPoints: 350, streak: 1 });
    // The account now owns today's game and cannot play it again; neither can the old guest identity.
    expect(await startSession(user, plus(DAY1, 60_000))).toMatchObject({ completed: true, score: 350 });
    expect(await startSession(g, plus(DAY1, 60_000))).toMatchObject({ completed: true, score: 350 });
    expect(await query('select 1 from game_sessions')).toHaveLength(1);
  });

  it('never swaps an account’s game for a better guest attempt', async () => {
    const user = await makeUser('steady');
    await finish(user, 'c'); // 175
    const g = guest();
    await finish(g, 'u'); // 700
    expect(await mergeGuestIntoUser(g.id, user.id, DAY1)).toBe(0);
    expect((await getProfile(user.id, DAY1))!.totalPoints).toBe(175);
  });

  it('builds leaderboards from stored scores, excluding guests and suspended accounts', async () => {
    const top = await makeUser('top');
    const mid = await makeUser('mid');
    const banned = await makeUser('banned');
    await finish(top, 'u');
    await finish(mid, 'r');
    await finish(banned, 'u');
    await finish(guest(), 'u');
    await query('update profiles set suspended = true where id = $1', [banned.id]);
    const daily = await dailyLeaderboard('2026-03-10');
    expect(daily.map((r) => [r.rank, r.username, r.score, r.form])).toEqual([
      [1, 'top', 700, 'ultra'],
      [2, 'mid', 350, 'azure'],
    ]);
    expect((await allTimeLeaderboard()).map((r) => r.username)).toEqual(['top', 'mid']);
    // Rows expose public fields only.
    expect(Object.keys(daily[0]).sort()).toEqual(['avatarUrl', 'form', 'rank', 'score', 'username']);
  });
});

describe('administration', () => {
  it('reviews unknown answers into the accepted list', async () => {
    const [q] = await makeStandardQuestions(1);
    await query(`insert into unknown_answers (question_id, norm, raw_text) values ($1, 'new guy', 'New Guy'), ($1, 'see one', 'see one')`, [q.id]);
    const unknown = await query<{ id: string; norm: string }>('select id, norm from unknown_answers');
    expect(await matchAnswer(q.id, 'new guy')).toBeNull();
    await resolveUnknown(unknown.find((u) => u.norm === 'new guy')!.id, { action: 'approve', tier: 'epic' });
    expect(await matchAnswer(q.id, 'NEW GUY')).toMatchObject({ canonical: 'New Guy' });
    await resolveUnknown(unknown.find((u) => u.norm === 'see one')!.id, { action: 'alias', answerId: q.answers.c1 });
    expect((await matchAnswer(q.id, 'see one'))?.answerId).toBe(q.answers.c1);
  });

  it('keeps one owner per name within a question', async () => {
    const [q] = await makeStandardQuestions(1);
    await expect(addAnswer(q.id, { canonical: 'C1' })).rejects.toMatchObject({ code: 'NAME_TAKEN' });
    await expect(addAnswer(q.id, { canonical: 'Common 1' })).rejects.toMatchObject({ code: 'NAME_TAKEN' });
  });

  it('schedules games, and locks them once players have started', async () => {
    const qs = await makeStandardQuestions(8);
    const ids = qs.slice(0, 7).map((q) => q.id);
    const id = await createGame({ date: '2026-03-10', questionIds: ids });
    await expect(createGame({ date: '2026-03-10' })).rejects.toMatchObject({ code: 'DATE_TAKEN' });
    await expect(createGame({ date: '2026-03-12', questionIds: [ids[0], ids[0]] })).rejects.toThrow();

    // Drafts are invisible to players until published.
    await expect(startSession(guest(), DAY1)).rejects.toMatchObject({ code: 'NO_GAME' });
    await updateGame(id, { questionIds: [...ids].reverse() });
    await updateGame(id, { action: 'publish' });
    const state = await startSession(guest(), DAY1);
    expect(state.current!.id).toBe(ids[6]);

    await expect(updateGame(id, { questionIds: ids })).rejects.toMatchObject({ code: 'GAME_LOCKED' });
    await expect(updateGame(id, { action: 'unpublish' })).rejects.toMatchObject({ code: 'GAME_LOCKED' });
  });

  it('produces analytics from real rows', async () => {
    await makeStandardQuestions(7);
    const user = await makeUser('counted');
    await finish(user, 'r');
    await startSession(guest(), DAY1);
    const a = await getAnalytics(DAY1);
    expect(a.totals).toEqual({ users: 1, gamesStarted: 2, gamesCompleted: 1, averageScore: 350, completionRate: 50 });
    expect(a).toMatchObject({ dau: 2, mau: 2 });
    expect(a.topAnswers).toHaveLength(7);
    const s = await suspiciousActivity();
    expect(s.fastSessions).toHaveLength(1); // 7 answers in ~10 simulated seconds
  });
});
