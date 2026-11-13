import { z } from 'zod';
import { query, queryOne, tx } from '@/lib/db/client';
import { AppError, badRequest, notFound } from '@/lib/errors';
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
  return query(
    `select q.id, q.text, q.category, q.active, q.source, q.created_at,
            (select count(*)::int from answers a where a.question_id = q.id and a.verified) as answers,
            (select count(*)::int from answers a where a.question_id = q.id and not a.verified) as unverified,
            (select count(*)::int from unknown_answers u where u.question_id = q.id and u.status = 'pending') as unknown,
            (select coalesce(sum(valid_count), 0)::int from answer_stats st where st.question_id = q.id) as submissions,
            (select max(g.game_date)::text from daily_game_questions dq join daily_games g on g.id = dq.game_id
              where dq.question_id = q.id) as last_used
       from questions q
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
      aliases: aliases.filter((al) => al.answer_id === a.id).map((al) => ({ id: al.id, alias: al.alias })),
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
}

/** Questions used by a game are deactivated rather than deleted, so history stays intact. */
export async function removeQuestion(id: string): Promise<'deleted' | 'deactivated'> {
  const used = await queryOne(
    `select 1 from daily_game_questions where question_id = $1
     union all select 1 from submissions where question_id = $1 limit 1`,
    [id],
  );
  if (used) {
    await query('update questions set active = false where id = $1', [id]);
    return 'deactivated';
  }
  await query('delete from questions where id = $1', [id]);
  return 'deleted';
}

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

export async function addAnswer(questionId: string, input: unknown): Promise<string> {
  const a = answerSchema.parse(input);
  return tx(async () => {
    if (!(await queryOne('select 1 from questions where id = $1', [questionId]))) throw notFound('Question not found.');
    const norm = normalizeAnswer(a.canonical);
    await assertNameFree(questionId, norm);
    const [{ id }] = await query<{ id: string }>(
      `insert into answers (question_id, canonical, norm, verified, provisional_tier, external_ref)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [questionId, a.canonical, norm, a.verified, a.provisionalTier, a.externalRef ?? null],
    );
    for (const alias of a.aliases) {
      const aliasNorm = normalizeAnswer(alias);
      if (!aliasNorm || aliasNorm === norm) continue;
      await query(
        `insert into answer_aliases (answer_id, question_id, alias, norm)
         select $1, $2, $3, $4 where not exists (select 1 from answers where question_id = $2 and norm = $4)
         on conflict (question_id, norm) do nothing`,
        [id, questionId, alias, aliasNorm],
      );
    }
    return id;
  });
}

export async function updateAnswer(id: string, input: unknown) {
  const patch = z
    .object({ canonical: z.string().trim().min(1).max(80), provisionalTier: tierSchema, verified: z.boolean() })
    .partial()
    .parse(input);
  await tx(async () => {
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
}

export async function deleteAnswer(id: string) {
  await query('delete from answers where id = $1', [id]);
}

export async function addAlias(answerId: string, aliasRaw: string): Promise<string> {
  const alias = z.string().trim().min(1).max(80).parse(aliasRaw);
  return tx(async () => {
    const answer = await queryOne<{ question_id: string }>('select question_id from answers where id = $1', [answerId]);
    if (!answer) throw notFound('Answer not found.');
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
