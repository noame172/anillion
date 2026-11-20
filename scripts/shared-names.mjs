/**
 * Shared names. In a character question several characters often share a surname or a first name
 * ("Hori" for Kyouko, Kyousuke, Souta and Yuriko Hori). Typing just that name is accepted and counts as
 * the character who is worth the FEWEST points; when several are worth the same, the one listed first
 * (the most popular) wins. So "Hori" scores like Kyouko Hori, a Common answer.
 *
 * `answers` is a question's list of [name, tier, ...aliases], most popular first.
 * Only a name that is a word of at least two answers' names is added, and never one that is already
 * an answer or an alias in the question.
 */
const RANK = { common: 0, rare: 1, epic: 2, ultra: 3 };
const SKIP = new Set(['the', 'and', 'von', 'van', 'der', 'del', 'san', 'sama', 'kun', 'chan', 'sensei', 'jr', 'sr', 'mrs', 'miss', 'lord', 'king', 'queen', 'dr', 'mr', 'captain', 'general', 'prince', 'princess']);

// Descriptions, not names ("mother", "student", "police officer", species and objects). Never accepted alone.
const GENERIC = new Set(`haha chichi otoko onna onnanoko seito shounen shougakusei koukousei kankoukyaku keikan hakase josei danshi dansei dansi obaa
  sobo sofu souryo senin kenshi majutsushi mensetsukan musume shokuin shinjin taiin yuujin youkai yousei zoku kaijuu jinzouningen hanzaisha kagaku kanbu
  kankoshi rouyakunin tsuma tsumibito murabito senpai enshutsu haiyuu gakki saibou producer operator announcer coach classmate couple pet radio host man
  mask metal tank tanktop top knight goblin orc gorilla zombie parasite mosquito devil oni kumo fan flash flower star killer might gallery eye glass crown
  emperor slayer armored android majo majin kaiou kaioushin iii all will wise pot hitotsume kamen hatter trinity crossroad forger darlian mercury
  sailor mob`.split(/\s+/));

export const norm = (s) =>
  String(s)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** True for the character questions this rule applies to ("Name a Horimiya character."). */
export const isCharacterQuestion = (text) =>
  / character\.$/.test(text) || /^Name an? .* (member|Hashira)/.test(text) || /^Name an? (Japanese voice actor|manga artist|anime director)\.$/.test(text);

/** Returns { answers, added }: a new list with the shared names added, and how many were added. */
export function addSharedNames(answers) {
  const taken = new Set();
  for (const [name, , ...aliases] of answers) for (const n of [name, ...aliases]) taken.add(norm(n));
  // word -> indexes of the answers whose own name contains it
  const owners = new Map();
  answers.forEach(([name], i) => {
    const words = norm(name).split(' ');
    if (words.length < 2) return;
    for (const w of new Set(words)) {
      if (w.length < 3 || SKIP.has(w) || GENERIC.has(w) || !/^\p{L}+$/u.test(w)) continue;
      if (!owners.has(w)) owners.set(w, []);
      owners.get(w).push(i);
    }
  });
  const out = answers.map((a) => [...a]);
  let added = 0;
  for (const [word, idx] of owners) {
    if (idx.length < 2 || taken.has(word)) continue;
    // fewest points first, then the most popular (earliest in the list)
    const best = idx.reduce((a, b) => (RANK[out[b][1]] < RANK[out[a][1]] ? b : a));
    out[best].push(word.replace(/^./u, (c) => c.toUpperCase()));
    taken.add(word);
    added++;
  }
  return { answers: out, added };
}

/**
 * Series names. A player who types "Dr. Stone" for "Name a winter 2025 anime" means the series, but the
 * list only holds the season, "Dr. STONE SCIENCE FUTURE". So for questions whose answers are anime or
 * manga titles, the beginning of a title is accepted when it is exactly another known title ("Dr. STONE").
 * As with shared character names, when several answers in the question share that beginning it counts
 * as the one worth the fewest points (ties: the first, most popular one).
 */
const TITLE_CATEGORIES = new Set(['Genre', 'Era', 'Length', 'Source', 'Format', 'Manga', 'Light Novels', 'Anime']);
export const isTitleQuestion = (q) => TITLE_CATEGORIES.has(q.category) || q.category.startsWith('Studio:');

// Words that are titles on their own but would make a poor shortcut for a longer title.
const TITLE_STOP = new Set(['love', 'free', 'black', 'space', 'school', 'high', 'new', 'game', 'the', 'rock', 'girl', 'girls', 'boy', 'boys', 'kiss', 'red', 'blue', 'white', 'summer', 'winter', 'spring', 'autumn', 'captain', 'scarlet', 'monster', 'magic', 'robot', 'tiger', 'dragon', 'master', 'mobile', 'kids', 'reborn']);

/** Returns { questions, added }: the questions with series names added to their title answers. */
export function addSeriesNames(questions) {
  const known = new Set();
  for (const q of questions) if (isTitleQuestion(q)) for (const [name] of q.answers) known.add(norm(name));
  let added = 0;
  const out = questions.map((q) => {
    if (!isTitleQuestion(q)) return q;
    const taken = new Set();
    for (const [name, , ...aliases] of q.answers) for (const n of [name, ...aliases]) taken.add(norm(n));
    const owners = new Map(); // norm of the series name -> { text, indexes }
    q.answers.forEach(([name], i) => {
      // Movies, OVAs and specials are not the series itself: "Detective Conan" must not score as a Conan movie.
      if (/(movie|film|ova|oad|special|specials|recap|gekijouban)/i.test(name)) return;
      const words = name.trim().split(/\s+/);
      for (let k = words.length - 1; k >= 1; k--) {
        const text = words.slice(0, k).join(' ').replace(/[\s:\-–,]+$/u, '').trim();
        const n = norm(text);
        const oneWord = n.split(' ').length === 1;
        if (!n || n === norm(name) || taken.has(n) || !known.has(n)) continue;
        if (oneWord && (n.length < 6 || TITLE_STOP.has(n))) continue;
        if (!oneWord && n.length < 6) continue;
        if (!owners.has(n)) owners.set(n, { text, indexes: [] });
        owners.get(n).indexes.push(i);
      }
    });
    const answers = q.answers.map((a) => [...a]);
    // A leading "The" is optional: "Seven Deadly Sins" for "The Seven Deadly Sins".
    answers.forEach((a) => {
      const m = a[0].match(/^(?:the|a|an)\s+(.{3,})$/i);
      if (!m) return;
      const n = norm(m[1]);
      if (n.length < 4 || taken.has(n)) return;
      a.push(m[1].trim());
      taken.add(n);
      added++;
    });
    if (!owners.size) return { ...q, answers };
    for (const [n, { text, indexes }] of owners) {
      const best = indexes.reduce((a, b) => (RANK[answers[b][1]] < RANK[answers[a][1]] ? b : a));
      answers[best].push(text);
      taken.add(n);
      added++;
    }
    return { ...q, answers };
  });
  return { questions: out, added };
}
