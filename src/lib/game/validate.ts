import { query } from '@/lib/db/client';
import { closestAnswer } from './fuzzy';
import { normalizeAnswer } from './normalize';

export type AnswerMatch = { answerId: string; canonical: string };

/**
 * Match free text to a verified answer for this question: by canonical name
 * or alias, or by a close misspelling of one. This is the only way an answer
 * is ever accepted.
 */
export async function matchAnswer(questionId: string, raw: string): Promise<AnswerMatch | null> {
  const norm = normalizeAnswer(raw);
  if (!norm) return null;
  const names = await query<{ answerId: string; canonical: string; norm: string }>(
    `select a.id as "answerId", a.canonical, a.norm
       from answers a where a.question_id = $1 and a.verified
     union all
     select a.id, a.canonical, al.norm
       from answer_aliases al join answers a on a.id = al.answer_id
      where al.question_id = $1 and a.question_id = $1 and a.verified`,
    [questionId],
  );
  const exact = names.find((n) => n.norm === norm);
  const id = exact?.answerId ?? closestAnswer(norm, names);
  const hit = id ? names.find((n) => n.answerId === id) : null;
  return hit ? { answerId: hit.answerId, canonical: hit.canonical } : null;
}

/** Remember an unrecognised answer so an administrator can review it. */
export async function recordUnknown(questionId: string, raw: string): Promise<void> {
  const norm = normalizeAnswer(raw);
  if (!norm) return;
  await query(
    `insert into unknown_answers (question_id, norm, raw_text) values ($1, $2, $3)
     on conflict (question_id, norm)
     do update set count = unknown_answers.count + 1, last_seen_at = now()`,
    [questionId, norm, raw.trim().slice(0, 80)],
  );
}
