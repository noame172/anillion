import { query, queryOne } from '@/lib/db/client';
import { closestAnswer } from './fuzzy';
import { normalizeAnswer } from './normalize';

/** `exact` is false when the text is only a close misspelling of the answer. */
export type AnswerMatch = { answerId: string; canonical: string; exact: boolean };

/**
 * Match free text to a verified answer for this question: by canonical name
 * or alias (exact), or by a close misspelling of one (not exact: the player is
 * asked to confirm it before it counts).
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
  let id = exact?.answerId ?? null;
  if (!id) {
    // A guess that is exactly a name the administrator has not accepted (an
    // unverified answer or a rejected suggestion) is that name, not a typo.
    const refused = await queryOne(
      `select 1 from answers a where a.question_id = $1 and not a.verified and a.norm = $2
       union all
       select 1 from answer_aliases al join answers a on a.id = al.answer_id
        where al.question_id = $1 and not a.verified and al.norm = $2
       union all
       select 1 from unknown_answers u where u.question_id = $1 and u.norm = $2 and u.status = 'rejected'
       limit 1`,
      [questionId, norm],
    );
    if (!refused) id = closestAnswer(norm, names);
  }
  const hit = id ? names.find((n) => n.answerId === id) : null;
  return hit ? { answerId: hit.answerId, canonical: hit.canonical, exact: Boolean(exact) } : null;
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
