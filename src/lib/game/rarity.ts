import { query, queryOne } from '@/lib/db/client';
import { maxUltra, tierForShare, type Thresholds, type Tier } from './tiers';

export type Rarity = { tier: Tier; share: number | null; provisional: boolean };

export type AnswerRarityInput = { answerId: string; count: number; provisionalTier: Tier };

/**
 * Rarity for every answer of one question.
 * With enough data it comes from real submission shares; otherwise the
 * administrator's provisional tier is used and marked as such.
 */
export function computeRarity(
  answers: AnswerRarityInput[],
  thresholds: Thresholds,
  minSample: number,
): Map<string, Rarity> {
  const total = answers.reduce((sum, a) => sum + a.count, 0);
  const out = new Map<string, Rarity>();
  for (const a of answers) {
    if (total >= minSample && total > 0) {
      const share = Math.round((a.count / total) * 100_000) / 1000;
      out.set(a.answerId, { tier: tierForShare(share, thresholds), share, provisional: false });
    } else {
      out.set(a.answerId, { tier: a.provisionalTier, share: null, provisional: true });
    }
  }
  // Keep ultra rare. With player data, the rarest answers players actually found keep it
  // (an answer nobody has given yet is not proven rare); with provisional tiers, the
  // first ones in a stable order do. The rest drop to epic.
  const ultras = answers
    .filter((a) => out.get(a.answerId)!.tier === 'ultra')
    .sort((x, y) => (x.count === 0 ? 1 : 0) - (y.count === 0 ? 1 : 0) || x.count - y.count || x.answerId.localeCompare(y.answerId));
  for (const a of ultras.slice(maxUltra(answers.length))) out.set(a.answerId, { ...out.get(a.answerId)!, tier: 'epic' });
  return out;
}

/** Freeze rarity for every question of a game from the statistics gathered so far. */
export async function buildSnapshot(gameId: string, thresholds: Thresholds, minSample: number): Promise<void> {
  const rows = await query<{ question_id: string; answer_id: string; count: number; tier: Tier }>(
    `select a.question_id, a.id as answer_id, coalesce(st.valid_count, 0)::int as count, a.provisional_tier as tier
       from daily_game_questions dq
       join answers a on a.question_id = dq.question_id and a.verified
       left join answer_stats st on st.answer_id = a.id
      where dq.game_id = $1`,
    [gameId],
  );
  const byQuestion = new Map<string, AnswerRarityInput[]>();
  for (const r of rows) {
    const list = byQuestion.get(r.question_id) ?? [];
    list.push({ answerId: r.answer_id, count: r.count, provisionalTier: r.tier });
    byQuestion.set(r.question_id, list);
  }
  const snapshot: object[] = [];
  for (const [questionId, list] of byQuestion) {
    for (const [answerId, r] of computeRarity(list, thresholds, minSample)) {
      snapshot.push({ question_id: questionId, answer_id: answerId, share: r.share, tier: r.tier, provisional: r.provisional });
    }
  }
  await query('delete from rarity_snapshots where game_id = $1', [gameId]);
  if (!snapshot.length) return;
  await query(
    `insert into rarity_snapshots (game_id, question_id, answer_id, share, tier, provisional)
     select $1, x.question_id, x.answer_id, x.share, x.tier, x.provisional
       from jsonb_to_recordset($2::jsonb)
         as x(question_id uuid, answer_id uuid, share numeric, tier text, provisional boolean)`,
    [gameId, JSON.stringify(snapshot)],
  );
}

/** Frozen rarity of an answer in a game. Answers added after the freeze use their provisional tier. */
export async function lookupRarity(gameId: string, answerId: string): Promise<Rarity> {
  const snap = await queryOne<{ tier: Tier; share: number | null; provisional: boolean }>(
    `select tier, share::float8 as share, provisional from rarity_snapshots where game_id = $1 and answer_id = $2`,
    [gameId, answerId],
  );
  if (snap) return snap;
  const answer = await queryOne<{ tier: Tier }>('select provisional_tier as tier from answers where id = $1', [answerId]);
  return { tier: answer?.tier ?? 'common', share: null, provisional: true };
}
