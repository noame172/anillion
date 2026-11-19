/**
 * The editable game file: data/questions.txt. Every question with every one of its answers.
 *
 *   npm run questions export   write data/questions.txt from data/seed.json (overwrites unsaved edits!)
 *   npm run questions check    show what your edits changed (nothing is written)
 *   npm run questions apply    write your edits into data/seed.json
 *
 * Then `npm run db:sync` copies data/seed.json to the Supabase database.
 *
 * File format:
 *   == Category | Question text
 *   Answer name | rarity | alias one ; alias two
 *   Another answer | rare
 * rarity is common, rare, epic or ultra (the starting tier, used until players give real data).
 * Aliases are optional other spellings that are also accepted. Lines starting with # and blank lines are ignored.
 */
import fs from 'node:fs';
import path from 'node:path';
import { addSharedNames, isCharacterQuestion } from './shared-names.mjs';
import { countUltra, ensureUltra, ULTRAS_PER_QUESTION } from './ultra.mjs';

const SEED = path.join('data', 'seed.json');
const LIST = path.join('data', 'questions.txt');
const TIERS = new Set(['common', 'rare', 'epic', 'ultra']);

const HEADER = `# Animellion questions and answers.
#
# Each question starts with a line   == Category | Question text
# and is followed by one line per accepted answer:   Answer name | rarity | alias one ; alias two
#   rarity: common, rare, epic or ultra (aliases are optional)
#
# To REMOVE a question: delete its "==" line and all of its answer lines.
# To ADD a question: add a "==" line and answer lines under it (at least one answer).
# To REMOVE an answer: delete its line. To ADD one: add a line. To change how rare it is: change the word.
# Lines starting with # and blank lines are ignored. Keep the " | " separators.
#
# When you are done, tell Claude to sync. The changes go into the Supabase database.
`;

export function readSeed() {
  return JSON.parse(fs.readFileSync(SEED, 'utf8'));
}

export function writeSeed(result) {
  const lines = ['['];
  result.forEach((q, qi) => {
    lines.push('  {');
    lines.push(`    "text": ${JSON.stringify(q.text)},`);
    lines.push(`    "category": ${JSON.stringify(q.category)},`);
    if (q.description) lines.push(`    "description": ${JSON.stringify(q.description)},`);
    lines.push('    "answers": [');
    q.answers.forEach((a, i) => lines.push(`      ${JSON.stringify(a)}${i < q.answers.length - 1 ? ',' : ''}`));
    lines.push('    ]');
    lines.push(`  }${qi < result.length - 1 ? ',' : ''}`);
  });
  lines.push(']', '');
  fs.writeFileSync(SEED, lines.join('\n'));
}

export function writeList(seed) {
  const bad = (s) => s.includes(' | ') || s.includes(' ; ') || /[\r\n]/.test(s) || s !== s.trim();
  const out = [HEADER];
  for (const q of seed) {
    if (bad(q.category) || /[\r\n]/.test(q.text) || q.category.includes('|')) throw new Error(`Cannot write "${q.text}": category or text has a forbidden character`);
    out.push(`== ${q.category} | ${q.text}`);
    if (q.description) out.push(`> ${q.description}`);
    for (const [name, tier, ...aliases] of q.answers) {
      if (bad(name) || aliases.some(bad)) throw new Error(`Cannot write answer "${name}" in "${q.text}": it contains " | " or " ; "`);
      out.push(aliases.length ? `${name} | ${tier} | ${aliases.join(' ; ')}` : `${name} | ${tier}`);
    }
    out.push('');
  }
  fs.writeFileSync(LIST, out.join('\n'));
}

function readList() {
  const questions = [];
  const problems = [];
  let cur = null;
  fs.readFileSync(LIST, 'utf8')
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const line = raw.trim();
      const where = `line ${i + 1}`;
      if (!line || line === '#' || line.startsWith('# ')) return;
      if (line.startsWith('==')) {
        const rest = line.slice(2).trim();
        const cut = rest.indexOf('|');
        const category = cut === -1 ? '' : rest.slice(0, cut).trim();
        const text = cut === -1 ? '' : rest.slice(cut + 1).trim();
        if (!category || !text) return problems.push(`${where}: expected "== Category | Question text": ${raw}`), (cur = null);
        if (text.length < 5 || text.length > 200) problems.push(`${where}: the question must be 5-200 characters: ${text}`);
        cur = { text, category, answers: [] };
        questions.push(cur);
        return;
      }
      if (line.startsWith('>')) {
        if (cur) cur.description = line.slice(1).trim();
        return;
      }
      if (!cur) return problems.push(`${where}: an answer with no question above it: ${raw}`);
      const parts = line.split(' | ').map((s) => s.trim());
      const [name, tier, aliasText] = parts;
      if (!name || name.length > 80) return problems.push(`${where}: answer name must be 1-80 characters: ${raw}`);
      if (!TIERS.has(tier)) return problems.push(`${where}: rarity must be common, rare, epic or ultra: ${raw}`);
      if (parts.length > 3) return problems.push(`${where}: too many " | " parts: ${raw}`);
      const aliases = (aliasText ?? '').split(' ; ').map((s) => s.trim()).filter(Boolean);
      cur.answers.push([name, tier, ...aliases]);
    });
  const seen = new Set();
  for (const q of questions) {
    if (seen.has(q.text)) problems.push(`"${q.text}" appears more than once`);
    seen.add(q.text);
    if (!q.answers.length) problems.push(`"${q.text}" has no answers`);
  }
  return { questions, problems };
}

function diff() {
  const seed = readSeed();
  const { questions, problems } = readList();
  const inSeed = new Map(seed.map((q) => [q.text, q]));
  const inList = new Map(questions.map((q) => [q.text, q]));
  const changed = [];
  for (const q of questions) {
    const old = inSeed.get(q.text);
    if (!old) continue;
    const a = new Map(old.answers.map((x) => [x[0], x]));
    const b = new Map(q.answers.map((x) => [x[0], x]));
    const added = [...b.keys()].filter((k) => !a.has(k));
    const removed = [...a.keys()].filter((k) => !b.has(k));
    const edited = [...b.keys()].filter((k) => a.has(k) && JSON.stringify(a.get(k)) !== JSON.stringify(b.get(k)));
    if (old.category !== q.category || added.length || removed.length || edited.length) {
      changed.push({ text: q.text, category: old.category !== q.category ? q.category : null, added, removed, edited });
    }
  }
  return {
    seed,
    problems,
    questions,
    removed: seed.filter((q) => !inList.has(q.text)),
    added: questions.filter((q) => !inSeed.has(q.text)),
    changed,
  };
}

function report(d) {
  const show = (title, items, fmt) => {
    if (!items.length) return;
    console.log(`\n${title} (${items.length}):`);
    for (const x of items) console.log(`  ${fmt(x)}`);
  };
  show('Questions removed', d.removed, (q) => `${q.category} | ${q.text} (${q.answers.length} answers)`);
  show('Questions added', d.added, (q) => `${q.category} | ${q.text} (${q.answers.length} answers)`);
  show('Questions with changed answers or category', d.changed, (c) => {
    const bits = [];
    if (c.category) bits.push(`category -> ${c.category}`);
    if (c.added.length) bits.push(`+${c.added.length} answers`);
    if (c.removed.length) bits.push(`-${c.removed.length} answers`);
    if (c.edited.length) bits.push(`${c.edited.length} edited`);
    return `${c.text}: ${bits.join(', ')}`;
  });
  if (!d.removed.length && !d.added.length && !d.changed.length) console.log('\nThe file matches data/seed.json. No changes.');
  const noUltra = d.questions.filter((q) => countUltra(q.answers) < ULTRAS_PER_QUESTION);
  show(`Questions with fewer than ${ULTRAS_PER_QUESTION} ultra answers (apply fixes these)`, noUltra, (q) => `${q.text} (${countUltra(q.answers)})`);
}

/** Give every question its ultra answers, and accept shared character names. Returns the fixed list and counts. */
function withUltras(questions) {
  let fixed = 0;
  let shared = 0;
  const out = questions.map((q) => {
    let answers = q.answers;
    const ultra = ensureUltra(answers);
    answers = ultra.answers;
    if (isCharacterQuestion(q.text)) {
      const names = addSharedNames(answers);
      answers = names.answers;
      shared += names.added;
    }
    if (ultra.promoted) fixed++;
    return answers === q.answers ? q : { ...q, answers };
  });
  return { questions: out, fixed, shared };
}

const cmd = process.argv[2];
if (cmd === 'export') {
  const seed = readSeed();
  writeList(seed);
  console.log(`Wrote ${seed.length} questions and ${seed.reduce((n, q) => n + q.answers.length, 0)} answers to ${LIST}`);
} else if (cmd === 'check' || cmd === 'apply') {
  const d = diff();
  if (d.problems.length) {
    console.log('Problems in data/questions.txt:');
    for (const p of d.problems.slice(0, 40)) console.log(`  ${p}`);
    process.exit(1);
  }
  report(d);
  if (cmd === 'apply') {
    const { questions, fixed, shared } = withUltras(d.questions);
    writeSeed(questions);
    if (fixed || shared) writeList(questions); // keep the list file in step with the ultras that were added
    console.log(`\nUpdated ${SEED}: ${questions.length} questions.${fixed ? ` ${fixed} question(s) got ultra answers added (the least popular answers).` : ''}${shared ? ` ${shared} shared name(s) added (a surname or first name several characters share counts as the one worth the fewest points).` : ''} Now run: npm run db:sync`);
  }
} else if (cmd === 'ultra') {
  // Give every question in data/seed.json its ultra answers, then rewrite the list file.
  const { questions, fixed, shared } = withUltras(readSeed());
  writeSeed(questions);
  writeList(questions);
  console.log(`${fixed} question(s) got ultra answers added, ${shared} shared name(s) added. Now run: npm run db:sync -- --apply`);
} else {
  console.log('Usage: npm run questions export | check | apply | ultra');
  process.exit(1);
}
