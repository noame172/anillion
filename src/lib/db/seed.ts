import fs from 'node:fs';
import path from 'node:path';
import type { Driver } from './client';
import { normalizeAnswer } from '@/lib/game/normalize';

type SeedQuestion = {
  text: string;
  category: string;
  description?: string;
  /** [canonical, provisional tier, ...aliases] */
  answers: [string, string, ...string[]][];
};

export function loadSeedFile(file = path.join(process.cwd(), 'data', 'seed.json')): SeedQuestion[] {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Names that would be ambiguous inside one question (same normalised text for two answers). */
export function findSeedCollisions(seed: SeedQuestion[]): string[] {
  const problems: string[] = [];
  for (const q of seed) {
    const seen = new Map<string, string>();
    for (const [canonical, , ...aliases] of q.answers) {
      for (const name of [canonical, ...aliases]) {
        const norm = normalizeAnswer(name);
        if (!norm) problems.push(`${q.text}: "${name}" normalises to nothing`);
        const owner = seen.get(norm);
        if (owner && owner !== canonical) problems.push(`${q.text}: "${name}" is used by ${owner} and ${canonical}`);
        seen.set(norm, canonical);
      }
    }
  }
  return problems;
}

/** Insert starter questions and verified answers. Existing question texts are left alone. */
export async function seed(db: Driver, data: SeedQuestion[] = loadSeedFile()): Promise<number> {
  let added = 0;
  await db.tx(async (q) => {
    for (const item of data) {
      const exists = await q.query('select 1 from questions where text = $1', [item.text]);
      if (exists.length) continue;
      const [{ id: questionId }] = await q.query<{ id: string }>(
        `insert into questions (text, category, description, source) values ($1, $2, $3, 'seed') returning id`,
        [item.text, item.category, item.description ?? null],
      );
      added++;
      for (const [canonical, tier, ...aliases] of item.answers) {
        const rows = await q.query<{ id: string }>(
          `insert into answers (question_id, canonical, norm, verified, provisional_tier)
           values ($1, $2, $3, true, $4) on conflict (question_id, norm) do nothing returning id`,
          [questionId, canonical, normalizeAnswer(canonical), tier],
        );
        if (!rows.length) continue;
        for (const alias of aliases) {
          const norm = normalizeAnswer(alias);
          if (!norm || norm === normalizeAnswer(canonical)) continue;
          // An alias never shadows another answer's canonical name.
          await q.query(
            `insert into answer_aliases (answer_id, question_id, alias, norm)
             select $1, $2, $3, $4
             where not exists (select 1 from answers where question_id = $2 and norm = $4)
             on conflict (question_id, norm) do nothing`,
            [rows[0].id, questionId, alias, norm],
          );
        }
      }
    }
  });
  return added;
}

export async function seedIfEmpty(db: Driver) {
  const [{ n }] = await db.query<{ n: number }>('select count(*)::int as n from questions');
  if (n === 0) await seed(db);
}
