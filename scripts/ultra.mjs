/**
 * Every question must have ultra answers: they are what the game is about (100 points each).
 * `answers` is a question's list of [name, tier, ...aliases], most popular first. If it has fewer than
 * `want` ultra answers, the least popular answers that are not ultra yet become ultra until it does.
 * The game allows at most 2 ultras per question (3 above 1000 answers), so 2 is the target.
 */
export const ULTRAS_PER_QUESTION = 2;

export function countUltra(answers) {
  return answers.filter((a) => a[1] === 'ultra').length;
}

/** Returns { answers, promoted }: a new list with enough ultras, and how many answers were promoted. */
export function ensureUltra(answers, want = ULTRAS_PER_QUESTION) {
  let missing = Math.min(want, answers.length) - countUltra(answers);
  if (missing <= 0) return { answers, promoted: 0 };
  const out = answers.map((a) => [...a]);
  let promoted = 0;
  for (let i = out.length - 1; i >= 0 && missing > 0; i--) {
    if (out[i][1] === 'ultra') continue;
    out[i][1] = 'ultra';
    missing--;
    promoted++;
  }
  return { answers: out, promoted };
}
