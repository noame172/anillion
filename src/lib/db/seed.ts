import fs from 'node:fs';
import path from 'node:path';
import type { Driver, Queryable } from './client';
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

/** Add one question's answers and aliases in two bulk statements. Anything already present is skipped. */
async function addAnswers(q: Queryable, questionId: string, item: SeedQuestion) {
  const answers: { canonical: string; norm: string; tier: string }[] = [];
  const aliases: { answer: string; alias: string; norm: string }[] = [];
  const taken = new Set<string>();
  for (const [canonical, tier] of item.answers) {
    const norm = normalizeAnswer(canonical);
    if (!norm || taken.has(norm)) continue;
    taken.add(norm);
    answers.push({ canonical, norm, tier });
  }
  for (const [canonical, , ...rest] of item.answers) {
    const own = normalizeAnswer(canonical);
    for (const alias of rest) {
      const norm = normalizeAnswer(alias);
      // An alias never shadows another answer's name or an earlier alias.
      if (!norm || taken.has(norm)) continue;
      taken.add(norm);
      aliases.push({ answer: own, alias, norm });
    }
  }
  const CHUNK = 2000;
  for (let i = 0; i < answers.length; i += CHUNK) {
    await q.query(
      `insert into answers (question_id, canonical, norm, verified, provisional_tier)
       select $1, x.canonical, x.norm, true, x.tier
         from jsonb_to_recordset($2::jsonb) as x(canonical text, norm text, tier text)
       on conflict (question_id, norm) do nothing`,
      [questionId, JSON.stringify(answers.slice(i, i + CHUNK))],
    );
  }
  for (let i = 0; i < aliases.length; i += CHUNK) {
    await q.query(
      `insert into answer_aliases (answer_id, question_id, alias, norm)
       select a.id, $1, x.alias, x.norm
         from jsonb_to_recordset($2::jsonb) as x(answer text, alias text, norm text)
         join answers a on a.question_id = $1 and a.norm = x.answer
        where not exists (select 1 from answers b where b.question_id = $1 and b.norm = x.norm)
       on conflict (question_id, norm) do nothing`,
      [questionId, JSON.stringify(aliases.slice(i, i + CHUNK))],
    );
  }
}

/**
 * Insert starter questions with their verified answers.
 * Questions that exist already are left alone, except that a question this
 * seed created earlier gets any answers it is missing (so a longer seed file
 * tops up an older database). Returns the number of new questions.
 */
export async function seed(db: Driver, data: SeedQuestion[] = loadSeedFile()): Promise<number> {
  let added = 0;
  await db.tx(async (q) => {
    for (const item of data) {
      const found = await q.query<{ id: string; source: string }>('select id, source from questions where text = $1', [item.text]);
      let questionId: string;
      if (found.length) {
        if (found[0].source !== 'seed') continue;
        questionId = found[0].id;
      } else {
        const [{ id }] = await q.query<{ id: string }>(
          `insert into questions (text, category, description, source) values ($1, $2, $3, 'seed') returning id`,
          [item.text, item.category, item.description ?? null],
        );
        questionId = id;
        added++;
      }
      await addAnswers(q, questionId, item);
    }
  });
  return added;
}

export async function seedIfEmpty(db: Driver) {
  const [{ n }] = await db.query<{ n: number }>('select count(*)::int as n from questions');
  if (n === 0) await seed(db);
}
