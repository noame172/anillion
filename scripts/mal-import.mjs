/**
 * Adds anime from MyAnimeList to the episode-count questions in data/seed.json.
 *
 *   node scripts/mal-import.mjs            fetch (cached), merge, write data/seed.json
 *   node scripts/mal-import.mjs --dry-run  show what would change, write nothing
 *
 * Needs a MyAnimeList API client id in .env as MAL_CLIENT_ID (see .env.example). The id is only ever
 * sent as the X-MAL-CLIENT-ID header; it is never printed or written anywhere.
 *
 * It walks MAL's all-time ranking (500 per request, cached in scripts/.cache), keeps TV series, and
 * adds every title that no existing answer already covers to the question that matches its episode
 * count: "12 episodes or fewer", "exactly 12 episodes", and so on. Existing answers keep their tier;
 * a title that is already there only gains alternative names it did not have. New answers get a
 * starting tier from MAL popularity (real tiers come from player data later).
 *
 * Afterwards: npm run questions export && npm run questions apply, then npm test, then npm run db:sync.
 */
import fs from 'node:fs';
import path from 'node:path';

const SEED = path.join('data', 'seed.json');
const CACHE = path.join('scripts', '.cache');
const API = 'https://api.myanimelist.net/v2/anime/ranking';
const PAGE = 500;
const MAX_PAGES = 60; // 30,000 titles: far more than the ranking holds
const dry = process.argv.includes('--dry-run');

// ---------------------------------------------------------------- key (read, never printed)
function readClientId() {
  const names = ['MAL_CLIENT_ID', 'MAL_API_KEY', 'MYANIMELIST_CLIENT_ID', 'MAL_KEY'];
  for (const n of names) if (process.env[n]?.trim()) return process.env[n].trim();
  for (const file of ['.env', '.env.local']) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && names.includes(m[1]) && m[2]) return m[2].replace(/^["']|["']$/g, '');
    }
  }
  return null;
}

// ---------------------------------------------------------------- names (same folding as the game)
const norm = (s) =>
  String(s)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const LATIN = /^[\p{Script=Latin}\p{N}\s'’.,:;!?&()\-+/×☆★♥♡_"@#%*=~]+$/u;
const isLatin = (s) => typeof s === 'string' && LATIN.test(s.trim()) && /\p{L}/u.test(s);
const clean = (s) => String(s).replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- which question a show belongs to
/** [{ text, test(episodes) }] for every episode-count question in the seed. */
function episodeRules(seed) {
  const rules = [];
  for (const q of seed) {
    let m;
    if ((m = q.text.match(/^Name an anime with exactly (\d+) episodes\.$/))) rules.push({ q, test: (n) => n === Number(m[1]) });
    else if ((m = q.text.match(/^Name an anime with (\d+) episodes or fewer\.$/))) rules.push({ q, test: (n) => n >= 1 && n <= Number(m[1]) });
  }
  return rules;
}

// ---------------------------------------------------------------- MAL access
async function page(offset, clientId) {
  const file = path.join(CACHE, `mal-ranking-${offset}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const url = `${API}?ranking_type=all&limit=${PAGE}&offset=${offset}&fields=num_episodes,media_type,alternative_titles,popularity`;
  for (let attempt = 0; attempt < 6; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers: { 'X-MAL-CLIENT-ID': clientId }, signal: AbortSignal.timeout(30_000) });
    } catch {
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new Error(`MyAnimeList refused the client id (HTTP ${res.status}). Check MAL_CLIENT_ID.`);
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
      continue;
    }
    if (res.status === 400 || res.status === 404) return { data: [] };
    if (!res.ok) throw new Error(`MyAnimeList answered HTTP ${res.status}`);
    const json = await res.json();
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(json));
    await new Promise((r) => setTimeout(r, 1200)); // be gentle: about one request a second
    return json;
  }
  throw new Error('MyAnimeList kept failing; try again later (what was fetched is cached).');
}

function candidate(node) {
  const alt = node.alternative_titles ?? {};
  const english = alt.en && clean(alt.en);
  const romaji = node.title && clean(node.title);
  const name = [english, romaji].find((t) => t && isLatin(t));
  if (!name || name.length > 80) return null;
  const aliases = [english, romaji, ...(alt.synonyms ?? []).map(clean)].filter((t) => t && isLatin(t) && t.length <= 60);
  const head = name.split(/\s*[:：]\s*/)[0]; // "Naruto: Shippuden" is also just "Naruto"
  if (head && head !== name && head.length >= 4) aliases.push(head);
  return { name, aliases: [...new Set(aliases)].slice(0, 6), popularity: node.popularity ?? 1e9, episodes: node.num_episodes ?? 0 };
}

/** Starting tier from MAL popularity rank. Ultra is left to ensureUltra: a question only has a couple. */
const tierFor = (popularity) => (popularity <= 400 ? 'common' : popularity <= 2000 ? 'rare' : 'epic');

// ---------------------------------------------------------------- main
async function main() {
  const clientId = readClientId();
  if (!clientId) {
    console.error('No MyAnimeList client id found. Add MAL_CLIENT_ID=... to .env (see .env.example) and run again.');
    process.exit(1);
  }
  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8'));
  const rules = episodeRules(seed);
  if (!rules.length) throw new Error('No episode-count questions found in data/seed.json.');

  const shows = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const json = await page(i * PAGE, clientId);
    const items = json.data ?? [];
    for (const { node } of items) if (node?.media_type === 'tv' && node.num_episodes > 0) shows.push(node);
    process.stdout.write(`\rMyAnimeList ranking: ${(i + 1) * PAGE} titles read, ${shows.length} TV series kept   `);
    if (items.length < PAGE) break;
  }
  console.log();

  const stats = [];
  for (const rule of rules) {
    const answers = rule.q.answers;
    const owner = new Map(); // normalised name or alias -> index of the answer that uses it
    answers.forEach(([name, , ...aliases], i) => [name, ...aliases].forEach((n) => owner.set(norm(n), i)));
    let added = 0;
    let enriched = 0;
    const fresh = [];
    for (const node of shows.filter((s) => rule.test(s.num_episodes)).sort((a, b) => (a.popularity ?? 1e9) - (b.popularity ?? 1e9))) {
      const c = candidate(node);
      if (!c) continue;
      const names = [c.name, ...c.aliases];
      const hit = names.map((n) => owner.get(norm(n))).find((i) => i !== undefined);
      if (hit !== undefined) {
        // Already there: only teach it the other names this show goes by.
        const extra = names.filter((n) => norm(n).length >= 3 && !owner.has(norm(n))).slice(0, 3);
        for (const n of extra) {
          (hit < answers.length ? answers[hit] : fresh[hit - answers.length]).push(clean(n));
          owner.set(norm(n), hit);
        }
        if (extra.length) enriched++;
        continue;
      }
      const kept = [];
      for (const a of c.aliases) {
        const n = norm(a);
        if (n.length < 3 || owner.has(n) || n === norm(c.name)) continue;
        kept.push(a);
      }
      const entry = [c.name, tierFor(c.popularity), ...kept];
      fresh.push(entry);
      const idx = answers.length + fresh.length - 1;
      owner.set(norm(c.name), idx);
      kept.forEach((a) => owner.set(norm(a), idx));
      added++;
    }
    answers.push(...fresh);
    stats.push({ question: rule.q.text, before: answers.length - added, added, enriched });
  }

  console.log('\nQuestion                                     answers before  added  gained names');
  for (const s of stats) console.log(`${s.question.padEnd(44)} ${String(s.before).padStart(8)} ${String(s.added).padStart(8)} ${String(s.enriched).padStart(9)}`);
  if (dry) return console.log('\nDry run: data/seed.json was not changed.');
  // Same layout writeSeed in scripts/questions.mjs uses, so the diff only shows real changes.
  const lines = ['['];
  seed.forEach((q, qi) => {
    lines.push('  {', `    "text": ${JSON.stringify(q.text)},`, `    "category": ${JSON.stringify(q.category)},`);
    if (q.description) lines.push(`    "description": ${JSON.stringify(q.description)},`);
    lines.push('    "answers": [');
    q.answers.forEach((a, i) => lines.push(`      ${JSON.stringify(a)}${i < q.answers.length - 1 ? ',' : ''}`));
    lines.push('    ]', `  }${qi < seed.length - 1 ? ',' : ''}`);
  });
  lines.push(']', '');
  fs.writeFileSync(SEED, lines.join('\n'));
  console.log('\nWrote data/seed.json. Next: npm run questions export, npm run questions apply, npm test, npm run db:sync');
}

main().catch((e) => {
  console.error(`\n${e.message}`);
  process.exit(1);
});
