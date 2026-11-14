import { z } from 'zod';
import { query, queryOne, tx } from '@/lib/db/client';
import { uniqueViolation } from '@/lib/db/errors';
import { AppError, badRequest, notFound } from '@/lib/errors';
import { clearGameCache } from '@/lib/game/daily';
import { normalizeAnswer } from '@/lib/game/normalize';
import { computeRarity } from '@/lib/game/rarity';
import { TIERS, type Tier } from '@/lib/game/tiers';
import { getSettings } from '@/lib/settings';

export const tierSchema = z.enum(TIERS);

export const questionSchema = z.object({
  text: z.string().trim().min(5).max(200),
  category: z.string().trim().min(1).max(60).default('General'),
  description: z.string().trim().max(500).nullish(),
  type: z.string().trim().min(1).max(30).default('open'),
  active: z.boolean().default(true),
});

export const answerSchema = z.object({
  canonical: z.string().trim().min(1).max(80),
  provisionalTier: tierSchema.default('common'),
  verified: z.boolean().default(true),
  aliases: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  externalRef: z.string().max(100).nullish(),
});

export async function audit(actorId: string | null, action: string, detail: unknown = {}) {
  await query('insert into audit_log (actor_id, action, detail) values ($1, $2, $3::jsonb)', [
    actorId,
    action,
    JSON.stringify(detail),
  ]);
}

export async function listQuestions(search = '') {
  // Each count is computed once for all questions and joined, not once per question row.
  return query(
    `select q.id, q.text, q.category, q.active, q.source, q.created_at,
            coalesce(a.verified, 0) as answers,
            coalesce(a.unverified, 0) as unverified,
            coalesce(u.pending, 0) as unknown,
            coalesce(st.submissions, 0) as submissions,
            lu.last_used
       from questions q
       left join (select question_id,
                         (count(*) filter (where verified))::int as verified,
                         (count(*) filter (where not verified))::int as unverified
                    from answers group by question_id) a on a.question_id = q.id
       left join (select question_id, count(*)::int as pending
                    from unknown_answers where status = 'pending' group by question_id) u on u.question_id = q.id
       left join (select question_id, sum(valid_count)::int as submissions
                    from answer_stats group by question_id) st on st.question_id = q.id
       left join (select dq.question_id, max(g.game_date)::text as last_used
                    from daily_game_questions dq join daily_games g on g.id = dq.game_id
                   group by dq.question_id) lu on lu.question_id = q.id
      where ($1 = '' or q.text ilike '%' || $1 || '%' or q.category ilike '%' || $1 || '%')
      order by q.active desc, q.category, q.text
      limit 500`,
    [search.trim().slice(0, 100)],
  );
}

/** Full detail for one question, including live rarity (what a game frozen right now would use). */
export async function getQuestion(id: string) {
  const question = await queryOne('select * from questions where id = $1', [id]);
  if (!question) throw notFound('Question not found.');
  const answers = await query<{
    id: string;
    canonical: string;
    verified: boolean;
    provisional_tier: Tier;
    external_ref: string | null;
    count: number;
  }>(
    `select a.id, a.canonical, a.verified, a.provisional_tier, a.external_ref,
            coalesce(st.valid_count, 0)::int as count
       from answers a left join answer_stats st on st.answer_id = a.id
      where a.question_id = $1
      order by coalesce(st.valid_count, 0) desc, a.canonical`,
    [id],
  );
  const aliases = await query<{ id: string; answer_id: string; alias: string }>(
    'select id, answer_id, alias from answer_aliases where question_id = $1 order by alias',
    [id],
  );
  const settings = await getSettings();
  const verified = answers.filter((a) => a.verified);
  const rarity = computeRarity(
    verified.map((a) => ({ answerId: a.id, count: a.count, provisionalTier: a.provisional_tier })),
    settings.thresholds,
    settings.minSample,
  );
  const total = verified.reduce((sum, a) => sum + a.count, 0);
  const aliasesByAnswer = new Map<string, { id: string; alias: string }[]>();
  for (const al of aliases) {
    const list = aliasesByAnswer.get(al.answer_id) ?? [];
    list.push({ id: al.id, alias: al.alias });
    aliasesByAnswer.set(al.answer_id, list);
  }
  // How each answer's frozen share moved across past games.
  const history = await query(
    `select g.game_date::text as date, rs.answer_id, rs.share::float8 as share, rs.tier, rs.provisional
       from rarity_snapshots rs join daily_games g on g.id = rs.game_id
      where rs.question_id = $1 order by g.game_date desc limit 2000`,
    [id],
  );
  return {
    question,
    totalSubmissions: total,
    minSample: settings.minSample,
    usingPlayerData: total >= settings.minSample,
    answers: answers.map((a) => ({
      id: a.id,
      canonical: a.canonical,
      verified: a.verified,
      provisionalTier: a.provisional_tier,
      externalRef: a.external_ref,
      count: a.count,
      share: total ? Math.round((a.count / total) * 10000) / 100 : null,
      liveTier: rarity.get(a.id)?.tier ?? null,
      liveProvisional: rarity.get(a.id)?.provisional ?? true,
      aliases: aliasesByAnswer.get(a.id) ?? [],
    })),
    history,
  };
}

export async function createQuestion(input: unknown, source = 'manual'): Promise<string> {
  const q = questionSchema.parse(input);
  const [{ id }] = await query<{ id: string }>(
    `insert into questions (text, category, description, type, active, source) values ($1, $2, $3, $4, $5, $6) returning id`,
    [q.text, q.category, q.description ?? null, q.type, q.active, source],
  );
  return id;
}

export async function updateQuestion(id: string, input: unknown) {
  const patch = questionSchema.partial().parse(input);
  const current = await queryOne<any>('select * from questions where id = $1', [id]);
  if (!current) throw notFound('Question not found.');
  const next = { ...current, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
  await query('update questions set text = $2, category = $3, description = $4, type = $5, active = $6 where id = $1', [
    id,
    next.text,
    next.category,
    next.description ?? null,
    next.type,
    next.active,
  ]);
  clearGameCache(); // a live game shows the question text, so do not serve the old wording
}

/** Questions used by a game are deactivated rather than deleted, so history stays intact. */
export async function removeQuestion(id: string): Promise<'deleted' | 'deactivated'> {
  return tx(async () => {
    // Locking the question makes a game that is being built with it wait, so the check below stays true.
    await query('select 1 from questions where id = $1 for update', [id]);
    const used = await queryOne(
      `select 1 from daily_game_questions where question_id = $1
       union all select 1 from submissions where question_id = $1 limit 1`,
      [id],
    );
    if (used) {
      await query('update questions set active = false where id = $1', [id]);
      return 'deactivated' as const;
    }
    await query('delete from questions where id = $1', [id]);
    return 'deleted' as const;
  });
}

/**
 * Serialise every change to one question's names. Without this, two administrators
 * (or two approvals) adding "X" as an answer and as another answer's alias at the
 * same moment would both pass the "name is free" check and leave an ambiguous name.
 */
async function lockQuestion(questionId: string) {
  if (!(await queryOne('select 1 from questions where id = $1 for update', [questionId]))) {
    throw notFound('Question not found.');
  }
}

const nameTaken = () => new AppError(409, 'NAME_TAKEN', 'Another answer already uses that name.');

/** A name may belong to only one answer per question, whether as canonical or alias. */
async function assertNameFree(questionId: string, norm: string, exceptAnswerId?: string) {
  if (!norm) throw badRequest('That name has no letters or numbers in it.');
  const clash = await queryOne<{ canonical: string }>(
    `select a.canonical from answers a
      where a.question_id = $1 and a.id <> $3
        and (a.norm = $2 or exists (select 1 from answer_aliases al where al.answer_id = a.id and al.norm = $2))
      limit 1`,
    [questionId, norm, exceptAnswerId ?? '00000000-0000-0000-0000-000000000000'],
  );
  if (clash) throw new AppError(409, 'NAME_TAKEN', `"${clash.canonical}" already uses that name.`);
}

/** Insert aliases in one statement, skipping any name another answer already owns. */
async function insertAliases(answerId: string, questionId: string, ownNorm: string, aliases: string[]) {
  const rows: { alias: string; norm: string }[] = [];
  const seen = new Set([ownNorm]);
  for (const alias of aliases) {
    const norm = normalizeAnswer(alias);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    rows.push({ alias, norm });
  }
  if (!rows.length) return;
  await query(
    `insert into answer_aliases (answer_id, question_id, alias, norm)
     select $1, $2, x.alias, x.norm from jsonb_to_recordset($3::jsonb) as x(alias text, norm text)
      where not exists (select 1 from answers a where a.question_id = $2 and a.norm = x.norm)
     on conflict (question_id, norm) do nothing`,
    [answerId, questionId, JSON.stringify(rows)],
  );
}

export async function addAnswer(questionId: string, input: unknown): Promise<string> {
  const a = answerSchema.parse(input);
  try {
    return await tx(async () => {
      await lockQuestion(questionId);
      const norm = normalizeAnswer(a.canonical);
      await assertNameFree(questionId, norm);
      const [{ id }] = await query<{ id: string }>(
        `insert into answers (question_id, canonical, norm, verified, provisional_tier, external_ref)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [questionId, a.canonical, norm, a.verified, a.provisionalTier, a.externalRef ?? null],
      );
      await insertAliases(id, questionId, norm, a.aliases);
      return id;
    });
  } catch (err) {
    if (uniqueViolation(err)) throw nameTaken();
    throw err;
  }
}

/**
 * Add many answers to one question with a handful of statements, however many there are.
 * Names that are invalid or already used are skipped and counted. Used by imports.
 */
export async function addAnswers(questionId: string, items: unknown[]): Promise<{ added: number; skipped: number }> {
  const parsed = items.flatMap((i) => {
    const r = answerSchema.safeParse(i);
    return r.success ? [r.data] : [];
  });
  let skipped = items.length - parsed.length;
  const CHUNK = 500;
  const added = await tx(async () => {
    await lockQuestion(questionId);
    const taken = new Set(
      (
        await query<{ norm: string }>(
          `select norm from answers where question_id = $1 union select norm from answer_aliases where question_id = $1`,
          [questionId],
        )
      ).map((r) => r.norm),
    );
    const fresh: { canonical: string; norm: string; tier: string; verified: boolean; ref: string | null; aliases: string[] }[] = [];
    for (const a of parsed) {
      const norm = normalizeAnswer(a.canonical);
      if (!norm || taken.has(norm)) {
        skipped++;
        continue;
      }
      taken.add(norm);
      fresh.push({ canonical: a.canonical, norm, tier: a.provisionalTier, verified: a.verified, ref: a.externalRef ?? null, aliases: a.aliases });
    }
    let count = 0;
    for (let i = 0; i < fresh.length; i += CHUNK) {
      const slice = fresh.slice(i, i + CHUNK);
      const ids = await query<{ id: string; norm: string }>(
        `insert into answers (question_id, canonical, norm, verified, provisional_tier, external_ref)
         select $1, x.canonical, x.norm, x.verified, x.tier, x.ref
           from jsonb_to_recordset($2::jsonb) as x(canonical text, norm text, verified boolean, tier text, ref text)
         returning id, norm`,
        [questionId, JSON.stringify(slice)],
      );
      count += ids.length;
      const idByNorm = new Map(ids.map((r) => [r.norm, r.id]));
      const aliasRows: { answer_id: string; alias: string; norm: string }[] = [];
      for (const a of slice) {
        for (const alias of a.aliases) {
          const norm = normalizeAnswer(alias);
          if (!norm || taken.has(norm)) continue;
          taken.add(norm);
          aliasRows.push({ answer_id: idByNorm.get(a.norm)!, alias, norm });
        }
      }
      if (aliasRows.length) {
        await query(
          `insert into answer_aliases (answer_id, question_id, alias, norm)
           select x.answer_id, $1, x.alias, x.norm
             from jsonb_to_recordset($2::jsonb) as x(answer_id uuid, alias text, norm text)
           on conflict (question_id, norm) do nothing`,
          [questionId, JSON.stringify(aliasRows)],
        );
      }
    }
    return count;
  });
  return { added, skipped };
}

export async function updateAnswer(id: string, input: unknown) {
  const patch = z
    .object({ canonical: z.string().trim().min(1).max(80), provisionalTier: tierSchema, verified: z.boolean() })
    .partial()
    .parse(input);
  try {
    await tx(async () => {
    const owner = await queryOne<{ question_id: string }>('select question_id from answers where id = $1', [id]);
    if (!owner) throw notFound('Answer not found.');
    await lockQuestion(owner.question_id);
    const current = await queryOne<{ question_id: string; canonical: string; verified: boolean; provisional_tier: Tier }>(
      'select question_id, canonical, verified, provisional_tier from answers where id = $1 for update',
      [id],
    );
    if (!current) throw notFound('Answer not found.');
    const canonical = patch.canonical ?? current.canonical;
    const norm = normalizeAnswer(canonical);
    if (patch.canonical) {
      await assertNameFree(current.question_id, norm, id);
      await query('delete from answer_aliases where answer_id = $1 and norm = $2', [id, norm]);
    }
    await query('update answers set canonical = $2, norm = $3, verified = $4, provisional_tier = $5 where id = $1', [
      id,
      canonical,
      norm,
      patch.verified ?? current.verified,
      patch.provisionalTier ?? current.provisional_tier,
    ]);
    });
  } catch (err) {
    if (uniqueViolation(err)) throw nameTaken();
    throw err;
  }
}

export async function deleteAnswer(id: string) {
  await query('delete from answers where id = $1', [id]);
}

export async function addAlias(answerId: string, aliasRaw: string): Promise<string> {
  const alias = z.string().trim().min(1).max(80).parse(aliasRaw);
  return tx(async () => {
    const answer = await queryOne<{ question_id: string }>('select question_id from answers where id = $1', [answerId]);
    if (!answer) throw notFound('Answer not found.');
    await lockQuestion(answer.question_id);
    const norm = normalizeAnswer(alias);
    await assertNameFree(answer.question_id, norm, answerId);
    const existing = await queryOne<{ id: string }>('select id from answer_aliases where question_id = $1 and norm = $2', [
      answer.question_id,
      norm,
    ]);
    if (existing) return existing.id;
    const [{ id }] = await query<{ id: string }>(
      'insert into answer_aliases (answer_id, question_id, alias, norm) values ($1, $2, $3, $4) returning id',
      [answerId, answer.question_id, alias, norm],
    );
    return id;
  });
}

export async function deleteAlias(id: string) {
  await query('delete from answer_aliases where id = $1', [id]);
}

export async function listUnknown(status: 'pending' | 'approved' | 'rejected' = 'pending') {
  return query(
    `select u.id, u.question_id, q.text as question, u.raw_text, u.norm, u.count, u.status, u.last_seen_at
       from unknown_answers u join questions q on q.id = u.question_id
      where u.status = $1 order by u.count desc, u.last_seen_at desc limit 300`,
    [status],
  );
}

export const resolveUnknownSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), canonical: z.string().trim().min(1).max(80).optional(), tier: tierSchema.default('ultra') }),
  z.object({ action: z.literal('alias'), answerId: z.uuid() }),
  z.object({ action: z.literal('reject') }),
]);

/** Review an answer players typed that was not on the list. */
export async function resolveUnknown(id: string, input: unknown) {
  const decision = resolveUnknownSchema.parse(input);
  await tx(async () => {
    const u = await queryOne<{ question_id: string; raw_text: string }>(
      `select question_id, raw_text from unknown_answers where id = $1 for update`,
      [id],
    );
    if (!u) throw notFound('Entry not found.');
    if (decision.action === 'approve') {
      const canonical = decision.canonical ?? u.raw_text;
      const answerId = await addAnswer(u.question_id, { canonical, provisionalTier: decision.tier, verified: true });
      // Keep what players actually typed working as an alias of the corrected name.
      if (normalizeAnswer(canonical) !== normalizeAnswer(u.raw_text)) await addAlias(answerId, u.raw_text);
    } else if (decision.action === 'alias') {
      const target = await queryOne('select 1 from answers where id = $1 and question_id = $2', [
        decision.answerId,
        u.question_id,
      ]);
      if (!target) throw badRequest('That answer belongs to a different question.');
      await addAlias(decision.answerId, u.raw_text);
    }
    await query('update unknown_answers set status = $2 where id = $1', [
      id,
      decision.action === 'reject' ? 'rejected' : 'approved',
    ]);
  });
}
