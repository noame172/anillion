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

export type SyncPlan = {
  /** Questions in the file that the database does not have yet. */
  add: string[];
  /** Questions the file no longer has. One that was ever used in a daily game or answered is only switched off. */
  remove: { text: string; action: 'delete' | 'deactivate' }[];
  /** Switched-off questions that the file has again. */
  reactivate: string[];
  /** Questions whose category in the file differs from the database. */
  recategorise: string[];
  /** Existing questions whose answers differ from the file (answers added, removed or re-rated). */
  topUp: string[];
  /** Totals over all existing questions: answers added, removed, given another rarity, and aliases removed. */
  answers: { added: number; removed: number; retiered: number; aliasesAdded: number; aliasesRemoved: number };
};

/** Bring one question's answers and aliases in line with the file. Returns what differed. */
async function mirrorAnswers(q: Queryable, questionId: string, item: SeedQuestion, apply: boolean) {
  const want = new Map<string, { tier: string }>();
  const wantAlias = new Set<string>();
  for (const [canonical, tier] of item.answers) {
    const norm = normalizeAnswer(canonical);
    if (norm && !want.has(norm)) want.set(norm, { tier });
  }
  for (const [, , ...rest] of item.answers) {
    for (const alias of rest) {
      const norm = normalizeAnswer(alias);
      if (norm && !want.has(norm)) wantAlias.add(norm);
    }
  }
  const have = await q.query<{ id: string; norm: string; provisional_tier: string }>(
    'select id, norm, provisional_tier from answers where question_id = $1',
    [questionId],
  );
  const haveAliases = await q.query<{ norm: string }>('select norm from answer_aliases where question_id = $1', [questionId]);
  const haveNorms = new Set(have.map((a) => a.norm));
  const removed = have.filter((a) => !want.has(a.norm));
  const retiered = have.filter((a) => want.has(a.norm) && want.get(a.norm)!.tier !== a.provisional_tier);
  const added = [...want.keys()].filter((n) => !haveNorms.has(n)).length;
  const staleAliases = haveAliases.filter((a) => !wantAlias.has(a.norm));
  const haveAliasNorms = new Set(haveAliases.map((a) => a.norm));
  // Aliases the file has that the database lacks (an alias nobody else owns, so it can be added).
  const aliasesAdded = [...wantAlias].filter((n) => !haveAliasNorms.has(n) && !haveNorms.has(n)).length;
  const diff = { added, removed: removed.length, retiered: retiered.length, aliasesAdded, aliasesRemoved: staleAliases.length };
  const changed = added + removed.length + retiered.length + aliasesAdded + staleAliases.length > 0;
  if (apply && changed) {
    for (const a of removed) await q.query('delete from answers where id = $1', [a.id]);
    if (staleAliases.length) {
      await q.query('delete from answer_aliases where question_id = $1 and norm = any($2::text[])', [questionId, staleAliases.map((a) => a.norm)]);
    }
    for (const a of retiered) {
      await q.query('update answers set provisional_tier = $2 where id = $1', [a.id, want.get(a.norm)!.tier]);
    }
    await addAnswers(q, questionId, item);
  }
  return { changed, diff };
}

/**
 * Make the database's seeded questions match the file. Questions with another source (written in the
 * admin screens) are never touched. For the others the file is the master: answers, aliases and starting
 * rarities the file lacks or has different are added, removed or changed in the database too.
 * With `apply: false` nothing is written and the plan is returned.
 */
export async function syncSeed(db: Driver, data: SeedQuestion[], { apply }: { apply: boolean }): Promise<SyncPlan> {
  const plan: SyncPlan = {
    add: [],
    remove: [],
    reactivate: [],
    recategorise: [],
    topUp: [],
    answers: { added: 0, removed: 0, retiered: 0, aliasesAdded: 0, aliasesRemoved: 0 },
  };
  // Step 1: read the database and work out the plan. Nothing is written here.
  // Step 2 (apply only): carry the plan out one question at a time, each in its own short transaction.
  // One huge transaction used to be lost entirely when the connection dropped half way through.
  const steps: ((q: Queryable) => Promise<void>)[] = [];

  const rows = await db.query<{ id: string; text: string; category: string; source: string; active: boolean; used: boolean }>(
    `select q.id, q.text, q.category, q.source, q.active,
            (exists (select 1 from daily_game_questions where question_id = q.id)
             or exists (select 1 from submissions where question_id = q.id)) as used
       from questions q`,
  );
  const byText = new Map(rows.map((r) => [r.text, r]));
  const inFile = new Set(data.map((d) => d.text));

  for (const item of data) {
    const row = byText.get(item.text);
    if (!row) {
      plan.add.push(item.text);
      steps.push(async (q) => {
        // A retry after a dropped connection must not create the question twice.
        const found = await q.query<{ id: string }>(`select id from questions where text = $1 and source = 'seed'`, [item.text]);
        const id =
          found[0]?.id ??
          (
            await q.query<{ id: string }>(
              `insert into questions (text, category, description, source) values ($1, $2, $3, 'seed') returning id`,
              [item.text, item.category, item.description ?? null],
            )
          )[0].id;
        await addAnswers(q, id, item);
      });
      continue;
    }
    if (row.source !== 'seed') continue; // written by hand in the admin screens: leave alone
    if (!row.active) {
      plan.reactivate.push(item.text);
      steps.push(async (q) => void (await q.query('update questions set active = true where id = $1', [row.id])));
    }
    if (row.category !== item.category) {
      plan.recategorise.push(item.text);
      steps.push(async (q) => void (await q.query('update questions set category = $2 where id = $1', [row.id, item.category])));
    }
    const { changed, diff } = await mirrorAnswers(db, row.id, item, false);
    if (changed) {
      plan.topUp.push(item.text);
      plan.answers.added += diff.added;
      plan.answers.removed += diff.removed;
      plan.answers.retiered += diff.retiered;
      plan.answers.aliasesAdded += diff.aliasesAdded;
      plan.answers.aliasesRemoved += diff.aliasesRemoved;
      steps.push(async (q) => void (await mirrorAnswers(q, row.id, item, true)));
    }
  }

  for (const row of rows) {
    if (row.source !== 'seed' || inFile.has(row.text)) continue;
    if (row.used) {
      if (!row.active) continue; // already switched off
      plan.remove.push({ text: row.text, action: 'deactivate' });
      steps.push(async (q) => void (await q.query('update questions set active = false where id = $1', [row.id])));
    } else {
      plan.remove.push({ text: row.text, action: 'delete' });
      steps.push(async (q) => void (await q.query('delete from questions where id = $1', [row.id])));
    }
  }

  if (apply) {
    for (const step of steps) await withRetry(() => db.tx(step));
  }
  return plan;
}

const TRANSIENT = new Set(['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', '57P01', '08006', '08003']);

/** Run a step again a few times when the connection dropped, which happens on slow or flaky links. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const e = err as { code?: string; message?: string };
      const transient = (e.code && TRANSIENT.has(e.code)) || /connection terminated|timeout|reset/i.test(e.message ?? '');
      if (!transient || i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

export async function seedIfEmpty(db: Driver) {
  const [{ n }] = await db.query<{ n: number }>('select count(*)::int as n from questions');
  if (n === 0) await seed(db);
}
