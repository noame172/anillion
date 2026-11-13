export const MAX_ANSWER_LENGTH = 80;

/**
 * Canonical comparison form of an answer: case, accents, punctuation and
 * spacing are ignored. Returns '' for input that is empty or too long.
 */
export function normalizeAnswer(raw: string): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_ANSWER_LENGTH) return '';
  return trimmed
    .normalize('NFKD') // splits accents off letters and folds full-width forms
    .replace(/\p{M}/gu, '') // drop the accents
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ') // punctuation and symbols → space
    .replace(/\s+/g, ' ')
    .trim();
}
