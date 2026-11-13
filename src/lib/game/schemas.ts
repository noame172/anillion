import { z } from 'zod';
import { MAX_ANSWER_LENGTH } from './normalize';

/**
 * The only fields a player may send with an answer. Anything else in the body
 * (points, tier, share, user ids...) is stripped before it reaches game logic.
 */
export const answerBodySchema = z.object({
  questionId: z.uuid(),
  text: z.string().trim().min(1, 'Type an answer first.').max(MAX_ANSWER_LENGTH, 'That answer is too long.'),
});

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date.');
