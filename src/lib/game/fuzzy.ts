/** Share of matching characters a guess needs to count as a misspelling of an answer. */
export const FUZZY_MIN = 0.8;

/** Edit distance: single-character inserts, deletes and swaps needed to turn a into b. */
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

/** 0-1: how alike two normalised strings are. 1 = identical. */
export function similarity(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  return 1 - distance(a, b) / Math.max(a.length, b.length);
}

const ROMAN = /^(?:i{1,3}|iv|vi{0,3}|ix|x)$/;

/** The numbers in a name, arabic or roman, in order. "lupin iii" and "lupin ii" differ here. */
const numerals = (s: string) =>
  s
    .split(' ')
    .flatMap((t) => (ROMAN.test(t) ? [t] : (t.match(/\d+/g) ?? [])))
    .join(' ');

/** True when one name is the other with whole words added: "dragon ball z" vs "dragon ball". */
function differsByWholeWords(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a.split(' '), b.split(' ')] : [b.split(' '), a.split(' ')];
  if (short.length === long.length) return false;
  const rest = [...long];
  for (const word of short) {
    const i = rest.indexOf(word);
    if (i === -1) return false;
    rest.splice(i, 1);
  }
  return true;
}

/**
 * The answer a misspelt guess most likely means, or null.
 * Numbers must match exactly ("Android 17" is not "Android 18"), a guess that only
 * adds or drops whole words is a different title ("Dragon Ball Z"), and a guess
 * equally close to two different answers is accepted as neither.
 */
export function closestAnswer(norm: string, candidates: { answerId: string; norm: string }[]): string | null {
  const wantNumerals = numerals(norm);
  let best = 0;
  let winner: string | null = null;
  let tied = false;
  for (const c of candidates) {
    // Cheap bound: strings this different in length cannot reach the threshold.
    if (Math.min(norm.length, c.norm.length) / Math.max(norm.length, c.norm.length) < FUZZY_MIN) continue;
    if (numerals(c.norm) !== wantNumerals) continue;
    if (differsByWholeWords(norm, c.norm)) continue;
    const score = similarity(norm, c.norm);
    if (score < FUZZY_MIN) continue;
    if (score > best) {
      best = score;
      winner = c.answerId;
      tied = false;
    } else if (score === best && c.answerId !== winner) {
      tied = true;
    }
  }
  return tied ? null : winner;
}
