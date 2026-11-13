import { z } from 'zod';
import { config } from '@/lib/config';
import { tx } from '@/lib/db/client';
import { AppError } from '@/lib/errors';
import { addAnswer, createQuestion } from '@/lib/admin/questions';
import { rateLimit } from '@/lib/security/ratelimit';

/**
 * Optional AI helper for administrators. It only DRAFTS questions and answer
 * candidates. Nothing it produces is playable until a person activates the
 * question and verifies each answer, and it never decides rarity or scores.
 */

export const aiEnabled = () => Boolean(config.openaiKey);

const suggestionSchema = z.object({
  text: z.string().trim().min(5).max(200),
  category: z.string().trim().min(1).max(60),
  ambiguity: z.string().trim().max(500).default(''),
  sources: z.array(z.string().trim().max(200)).max(8).default([]),
  answers: z
    .array(
      z.object({
        canonical: z.string().trim().min(1).max(80),
        aliases: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
        note: z.string().trim().max(300).default(''),
      }),
    )
    .max(80),
});
export type AiSuggestion = z.infer<typeof suggestionSchema>;

const SYSTEM = `You help write questions for a daily anime guessing game where players name one valid answer and rarer answers score more.
Return JSON: {"suggestions":[{"text","category","ambiguity","sources":[],"answers":[{"canonical","aliases":[],"note"}]}]}.
Rules: each question must be of the form "Name a ..." with many (20+) objectively checkable answers. List as many valid answers as you are confident about, with common alternative spellings as aliases. In "ambiguity", say plainly what could make an answer debatable (or "" if nothing). In "sources", name where a reviewer can verify the answers. Do not include percentages, popularity or rarity.`;

export async function suggestQuestions(topicRaw: unknown): Promise<AiSuggestion[]> {
  if (!aiEnabled()) throw new AppError(503, 'AI_DISABLED', 'AI suggestions are not configured (OPENAI_API_KEY is not set).');
  const topic = z.string().trim().min(2).max(120).parse(topicRaw);
  // Cost control: one shared daily budget for the whole site.
  await rateLimit('ai:global', config.aiDailyLimit, 86_400);

  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.openaiKey}` },
      body: JSON.stringify({
        model: config.openaiModel,
        response_format: { type: 'json_object' },
        max_tokens: 3000,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Suggest 3 questions about: ${topic}` },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new AppError(502, 'AI_UNREACHABLE', 'Could not reach the AI service.');
  }
  if (!res.ok) throw new AppError(502, 'AI_ERROR', `The AI service returned an error (${res.status}).`);
  try {
    const content = (await res.json())?.choices?.[0]?.message?.content ?? '{}';
    const parsed = z.object({ suggestions: z.array(z.unknown()) }).parse(JSON.parse(content));
    // Keep only well-formed suggestions; model output is untrusted input.
    return parsed.suggestions.flatMap((s) => {
      const r = suggestionSchema.safeParse(s);
      return r.success ? [r.data] : [];
    });
  } catch {
    throw new AppError(502, 'AI_BAD_OUTPUT', 'The AI service returned something unusable. Try again.');
  }
}

/** Save a suggestion as an inactive question with unverified answers, for human review. */
export async function saveSuggestionAsDraft(input: unknown): Promise<string> {
  const s = suggestionSchema.parse(input);
  return tx(async () => {
    const id = await createQuestion(
      {
        text: s.text,
        category: s.category,
        active: false,
        description: [s.ambiguity && `Possible ambiguity: ${s.ambiguity}`, s.sources.length && `Check against: ${s.sources.join('; ')}`]
          .filter(Boolean)
          .join(' ')
          .slice(0, 500),
      },
      'ai',
    );
    for (const a of s.answers) {
      await addAnswer(id, { canonical: a.canonical, aliases: a.aliases, verified: false, provisionalTier: 'common' }).catch(
        (err) => {
          if (!(err instanceof AppError)) throw err;
        },
      );
    }
    return id;
  });
}
