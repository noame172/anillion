import crypto from 'node:crypto';
import { setDb, query, type Driver } from '@/lib/db/client';
import { createPgliteDriver } from '@/lib/db/pglite';
import { migrate } from '@/lib/db/migrate';
import { normalizeAnswer } from '@/lib/game/normalize';
import type { Viewer } from '@/lib/game/session';

/** Fresh in-memory database with the real migrations applied. */
export async function freshDb(): Promise<Driver> {
  const db = await createPgliteDriver();
  await migrate(db, { stubSupabase: true });
  setDb(db);
  return db;
}

export const guest = (): Viewer => ({ kind: 'guest', id: crypto.randomUUID() });

export async function makeUser(username: string, role: 'user' | 'admin' = 'user'): Promise<Viewer & { kind: 'user' }> {
  const id = crypto.randomUUID();
  await query('insert into auth.users (id, email) values ($1, $2)', [id, `${username}@example.test`]);
  await query('insert into profiles (id, username, role) values ($1, $2, $3)', [id, username, role]);
  return { kind: 'user', id, role, username };
}

export type TestAnswer = { name: string; tier?: string; aliases?: string[]; verified?: boolean };

export async function makeQuestion(text: string, answers: TestAnswer[]): Promise<{ id: string; answers: Record<string, string> }> {
  const [{ id }] = await query<{ id: string }>('insert into questions (text, category) values ($1, $2) returning id', [text, 'Test']);
  const ids: Record<string, string> = {};
  for (const a of answers) {
    const [row] = await query<{ id: string }>(
      `insert into answers (question_id, canonical, norm, verified, provisional_tier) values ($1, $2, $3, $4, $5) returning id`,
      [id, a.name, normalizeAnswer(a.name), a.verified ?? true, a.tier ?? 'common'],
    );
    ids[a.name] = row.id;
    for (const alias of a.aliases ?? []) {
      await query('insert into answer_aliases (answer_id, question_id, alias, norm) values ($1, $2, $3, $4)', [
        row.id,
        id,
        alias,
        normalizeAnswer(alias),
      ]);
    }
  }
  return { id, answers: ids };
}

/** Seven simple questions, each with one answer per tier: c1..c7, r1.., e1.., u1.. */
export async function makeStandardQuestions(count = 7) {
  const out = [];
  for (let i = 1; i <= count; i++) {
    out.push(
      await makeQuestion(`Test question number ${i}`, [
        { name: `c${i}`, tier: 'common', aliases: [`common ${i}`] },
        { name: `r${i}`, tier: 'rare' },
        { name: `e${i}`, tier: 'epic' },
        { name: `u${i}`, tier: 'ultra' },
      ]),
    );
  }
  return out;
}

export const at = (iso: string) => new Date(iso);
export const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);
