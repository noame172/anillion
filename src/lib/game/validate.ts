import { query, queryOne } from '@/lib/db/client';
import { normalizeAnswer } from './normalize';

export type AnswerMatch = { answerId: string; canonical: string };

/**
 * Match free text to a verified answer for this question, by canonical name
 * or alias. This is the only way an answer is ever accepted.
 */
export async function matchAnswer(questionId: string, raw: string): Promise<AnswerMatch | null> {
  const norm = normalizeAnswer(raw);
  if (!norm) return null;
  return queryOne<AnswerMatch>(
    `select a.id as "answerId", a.canonical
       from answers a
      where a.question_id = $1 and a.verified
        and (a.norm = $2 or exists (
              select 1 from answer_aliases al
               where al.answer_id = a.id and al.question_id = $1 and al.norm = $2))
      limit 1`,
    [questionId, norm],
  );
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
