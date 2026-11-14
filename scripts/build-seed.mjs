/**
 * Builds data/seed.json from AniList (public API, no key needed).
 *
 *   node scripts/build-seed.mjs
 *
 * - Hand-curated answers already in data/seed.json keep their tier and aliases.
 * - Everything AniList knows is added on top, with provisional tiers from popularity rank
 *   (real tiers come from player data once a question has 100 valid answers).
 * - Responses are cached in scripts/.cache so an interrupted run resumes where it stopped.
 * - Run it occasionally to pick up new anime; review the diff before committing.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ENDPOINT = 'https://graphql.anilist.co';
const CACHE = path.join('scripts', '.cache');
const SEED = path.join('data', 'seed.json');
fs.mkdirSync(CACHE, { recursive: true });

// ---------------------------------------------------------------- AniList access
let last = 0;
async function gql(query) {
  const file = path.join(CACHE, crypto.createHash('sha1').update(query).digest('hex') + '.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  for (let attempt = 0; attempt < 8; attempt++) {
    const wait = 1100 - (Date.now() - last);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    if (res.status === 429) {
      const s = Number(res.headers.get('retry-after')) || 30;
      console.log(`  rate limited, waiting ${s}s`);
      await new Promise((r) => setTimeout(r, (s + 2) * 1000));
      continue;
    }
    const json = await res.json().catch(() => null);
    if (res.ok && json?.data) {
      fs.writeFileSync(file, JSON.stringify(json.data));
      return json.data;
    }
    if (res.status === 404) return null;
    console.log('  AniList error', res.status, JSON.stringify(json?.errors?.[0]?.message));
    await new Promise((r) => setTimeout(r, 4000));
  }
  console.log('  giving up on a request');
  return null;
}

// ---------------------------------------------------------------- name handling
/** Same folding as src/lib/game/normalize.ts. */
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
/** "Hunter x Hunter (2011)" -> "Hunter x Hunter" */
const stripYear = (s) => clean(s.replace(/\s*\((?:\d{4}|TV|OVA|ONA)\)\s*$/i, ''));

// ---------------------------------------------------------------- builders
/**
 * Merge candidates into one question's answer list.
 * `cands`: [{ name, aliases, rank }] in descending popularity.
 * An alias is kept only if no other answer uses that name; `shared` names (first names
 * or surnames used by several characters) are dropped for everyone.
 */
function assemble(cands, tiers, curated = []) {
  const owner = new Map(); // norm -> canonical
  const out = [];
  const take = (canonical, tier, aliases) => {
    const n = norm(canonical);
    // Players can type at most 80 characters, so longer names could never be matched.
    if (!n || canonical.length > 80 || owner.has(n)) return false;
    owner.set(n, canonical);
    const kept = [];
    for (const a of aliases) {
      const an = norm(a);
      if (!an || an.length < 3 || a.length > 80 || owner.has(an)) continue;
      owner.set(an, canonical);
      kept.push(clean(a));
    }
    out.push([canonical, tier, ...kept]);
    return true;
  };
  // Curated answers first: they keep their tier and aliases.
  for (const [canonical, tier, ...aliases] of curated) take(canonical, tier, aliases);
  // Names used by more than one candidate are ambiguous.
  const count = new Map();
  for (const c of cands) for (const n of new Set([c.name, ...c.aliases].map(norm))) count.set(n, (count.get(n) ?? 0) + 1);
  let i = 0;
  for (const c of cands) {
    if (owner.has(norm(c.name))) continue;
    const aliases = c.aliases.filter((a) => count.get(norm(a)) === 1 || norm(a) === norm(c.name));
    take(c.name, tierAt(i++, tiers), aliases);
  }
  return capUltras(out);
}

/** At most 2 ultra answers per question (3 above 1000): the last, rarest ones keep it, the rest are epic. */
function capUltras(answers) {
  const max = answers.length > 1000 ? 3 : 2;
  const ultra = answers.map((a, i) => (a[1] === 'ultra' ? i : -1)).filter((i) => i >= 0);
  for (const i of ultra.slice(0, Math.max(0, ultra.length - max))) answers[i] = [answers[i][0], 'epic', ...answers[i].slice(2)];
  return answers;
}
const tierAt = (i, [a, b, c]) => (i < a ? 'common' : i < b ? 'rare' : i < c ? 'epic' : 'ultra');

function titleCandidate(m) {
  const english = m.title?.english && stripYear(m.title.english);
  const romaji = m.title?.romaji && stripYear(m.title.romaji);
  const name = [english, romaji].find((t) => t && isLatin(t));
  if (!name) return null;
  const aliases = [english, romaji, ...(m.synonyms ?? []).map(stripYear)].filter((t) => t && isLatin(t) && t.length <= 60);
  // "Naruto: Shippuden" is also known by what comes before the colon.
  const head = name.split(/\s*[:：]\s*/)[0];
  if (head && head !== name && head.length >= 4) aliases.push(head);
  return { name, aliases: [...new Set(aliases.map(clean))].slice(0, 6), id: m.id, popularity: m.popularity ?? 0 };
}

const MEDIA = 'id title{romaji english} synonyms popularity';
const FILTER = 'type:ANIME, isAdult:false';

async function listMedia(args, { pages = 4, per = 50 } = {}) {
  const seen = new Set();
  const out = [];
  for (let p = 1; p <= pages; p++) {
    const d = await gql(`{ Page(page:${p}, perPage:${per}){ pageInfo{hasNextPage} media(${FILTER}, ${args}){ ${MEDIA} } } }`);
    for (const m of d?.Page?.media ?? []) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      const c = titleCandidate(m);
      if (c) out.push(c);
    }
    if (!d?.Page?.pageInfo?.hasNextPage) break;
  }
  return out;
}

/** AniList lists some non-characters (voice-over, crowds) among a show's characters. */
const NOT_CHARACTERS = /^(narrator|announcer|commentator|unknown|extras?|crowd|villagers?|students?|customer|reporter|host|mc|mob)$/i;

async function characters(searches, { pages = 4, keep = 120 } = {}) {
  const byId = new Map();
  for (const search of searches) {
    const pagesQuery = Array.from(
      { length: pages },
      (_, i) =>
        `p${i + 1}: characters(sort:FAVOURITES_DESC, perPage:25, page:${i + 1}){ nodes{ id favourites name{ full first last alternative } } }`,
    ).join('\n');
    const d = await gql(`{ Media(search:${JSON.stringify(search)}, type:ANIME, sort:POPULARITY_DESC){ id ${pagesQuery} } }`);
    if (!d?.Media) {
      console.log(`  ! no anime found for "${search}"`);
      continue;
    }
    for (let i = 1; i <= pages; i++) {
      for (const n of d.Media[`p${i}`]?.nodes ?? []) {
        const prev = byId.get(n.id);
        if (!prev || (n.favourites ?? 0) > (prev.favourites ?? 0)) byId.set(n.id, n);
      }
    }
  }
  const sorted = [...byId.values()].sort((a, b) => (b.favourites ?? 0) - (a.favourites ?? 0));
  const out = [];
  for (const n of sorted) {
    const full = n.name?.full && clean(n.name.full);
    if (!full || !isLatin(full) || NOT_CHARACTERS.test(full)) continue;
    const { first, last } = n.name;
    const aliases = [];
    if (first && isLatin(first) && first.length >= 3) aliases.push(first);
    if (last && isLatin(last) && last.length >= 3) aliases.push(last);
    if (first && last && isLatin(first) && isLatin(last)) aliases.push(`${last} ${first}`);
    for (const a of n.name.alternative ?? []) {
      const plain = clean(String(a).replace(/\s*\([^)]*\)\s*/g, ' '));
      if (isLatin(plain) && plain.length <= 40) aliases.push(plain);
    }
    out.push({ name: full, aliases: [...new Set(aliases)].slice(0, 6) });
    if (out.length >= keep) break;
  }
  return out;
}

async function studioMedia(search, { pages = 3, movieOnly = false } = {}) {
  const out = [];
  const seen = new Set();
  for (let p = 1; p <= pages; p++) {
    const d = await gql(
      `{ Studio(search:${JSON.stringify(search)}){ name media(isMain:true, sort:POPULARITY_DESC, perPage:50, page:${p}){ pageInfo{hasNextPage} nodes{ ${MEDIA} format isAdult } } } }`,
    );
    for (const m of d?.Studio?.media?.nodes ?? []) {
      if (m.isAdult || seen.has(m.id)) continue;
      if (movieOnly && m.format !== 'MOVIE') continue;
      seen.add(m.id);
      const c = titleCandidate(m);
      if (c) out.push(c);
    }
    if (!d?.Studio?.media?.pageInfo?.hasNextPage) break;
  }
  return out;
}

async function studios() {
  const out = [];
  for (let p = 1; p <= 10; p++) {
    const d = await gql(
      `{ Page(page:${p}, perPage:50){ pageInfo{hasNextPage} studios(sort:FAVOURITES_DESC){ name isAnimationStudio favourites media(isMain:true, perPage:1){ pageInfo{ total } } } } }`,
    );
    for (const s of d?.Page?.studios ?? []) {
      if (!s.isAnimationStudio || (s.media?.pageInfo?.total ?? 0) < 4 || !isLatin(s.name)) continue;
      out.push({ name: clean(s.name), aliases: [] });
    }
    if (!d?.Page?.pageInfo?.hasNextPage) break;
  }
  return out;
}

// ---------------------------------------------------------------- question catalogue
const FRANCHISES = [
  // [question text, category, searches, options]
  ['Name a Dragon Ball character.', 'Dragon Ball', ['Dragon Ball Z', 'Dragon Ball Super', 'Dragon Ball'], { pages: 6, keep: 200 }],
  ['Name a Naruto character.', 'Naruto', ['Naruto', 'Naruto Shippuuden', 'Boruto'], { pages: 8, keep: 250 }],
  ['Name a One Piece character.', 'One Piece', ['One Piece'], { pages: 12, keep: 300 }],
  ['Name an Attack on Titan character.', 'Attack on Titan', ['Shingeki no Kyojin', 'Attack on Titan Final Season'], { pages: 4 }],
  ['Name a My Hero Academia character.', 'My Hero Academia', ['Boku no Hero Academia', 'Boku no Hero Academia 5'], { pages: 6, keep: 160 }],
  ['Name a Demon Slayer character.', 'Demon Slayer', ['Kimetsu no Yaiba', 'Kimetsu no Yaiba Mugen Ressha-hen']],
  ['Name a Death Note character.', 'Death Note', ['Death Note'], { pages: 2 }],
  ['Name a Jujutsu Kaisen character.', 'Jujutsu Kaisen', ['Jujutsu Kaisen', 'Jujutsu Kaisen 2nd Season']],
  ['Name a Hunter x Hunter character.', 'Hunter x Hunter', ['Hunter x Hunter 2011', 'Hunter x Hunter'], { pages: 6, keep: 160 }],
  ['Name a Fullmetal Alchemist character.', 'Fullmetal Alchemist', ['Fullmetal Alchemist: Brotherhood', 'Fullmetal Alchemist']],
  ['Name a Bleach character.', 'Bleach', ['Bleach', 'Bleach: Thousand-Year Blood War'], { pages: 8, keep: 250 }],
  ['Name a One Punch Man character.', 'One Punch Man', ['One Punch Man', 'One Punch Man 2']],
  ['Name a Neon Genesis Evangelion character.', 'Neon Genesis Evangelion', ['Neon Genesis Evangelion', 'Rebuild of Evangelion'], { pages: 2 }],
  ["Name a JoJo's Bizarre Adventure character.", "JoJo's Bizarre Adventure", ["JoJo's Bizarre Adventure", "JoJo's Bizarre Adventure: Stardust Crusaders", 'JoJo no Kimyou na Bouken: Golden Wind', 'JoJo no Kimyou na Bouken: Stone Ocean'], { pages: 4, keep: 160 }],
  ['Name a Chainsaw Man character.', 'Chainsaw Man', ['Chainsaw Man'], { pages: 3 }],
  ['Name a Haikyu!! character.', 'Haikyu!!', ['Haikyuu!!', 'Haikyuu!! Second Season', 'Haikyuu!! Karasuno Koukou vs Shiratorizawa Gakuen Koukou'], { pages: 4, keep: 160 }],
  ['Name a Sailor Moon character.', 'Sailor Moon', ['Bishoujo Senshi Sailor Moon', 'Bishoujo Senshi Sailor Moon Crystal'], { pages: 4 }],
  ['Name a Spy x Family character.', 'Spy x Family', ['Spy x Family'], { pages: 2 }],
  // More franchises
  ['Name a Fairy Tail character.', 'Fairy Tail', ['Fairy Tail']],
  ['Name a Black Clover character.', 'Black Clover', ['Black Clover']],
  ['Name a Tokyo Ghoul character.', 'Tokyo Ghoul', ['Tokyo Ghoul', 'Tokyo Ghoul:re']],
  ['Name a Sword Art Online character.', 'Sword Art Online', ['Sword Art Online', 'Sword Art Online II', 'Sword Art Online: Alicization']],
  ['Name a Code Geass character.', 'Code Geass', ['Code Geass: Lelouch of the Rebellion', 'Code Geass: Lelouch of the Rebellion R2']],
  ['Name a Cowboy Bebop character.', 'Cowboy Bebop', ['Cowboy Bebop'], { pages: 2 }],
  ['Name a Gintama character.', 'Gintama', ['Gintama', 'Gintama°'], { pages: 5, keep: 160 }],
  ['Name a Fate series character.', 'Fate', ['Fate/stay night: Unlimited Blade Works', 'Fate/Zero', 'Fate/Grand Order: Absolute Demonic Front - Babylonia', 'Fate/stay night [Heaven’s Feel]']],
  ['Name a Re:Zero character.', 'Re:Zero', ['Re:Zero kara Hajimeru Isekai Seikatsu'], { pages: 3 }],
  ['Name a KonoSuba character.', 'KonoSuba', ['Kono Subarashii Sekai ni Shukufuku wo!'], { pages: 3 }],
  ['Name a Dr. Stone character.', 'Dr. Stone', ['Dr. Stone', 'Dr. Stone: Stone Wars'], { pages: 3 }],
  ['Name a Mob Psycho 100 character.', 'Mob Psycho 100', ['Mob Psycho 100'], { pages: 2 }],
  ['Name a Steins;Gate character.', 'Steins;Gate', ['Steins;Gate'], { pages: 2 }],
  ['Name an Oshi no Ko character.', 'Oshi no Ko', ['Oshi no Ko'], { pages: 2 }],
  ['Name a Frieren character.', "Frieren: Beyond Journey's End", ['Sousou no Frieren'], { pages: 2 }],
  ['Name a Kaguya-sama: Love Is War character.', 'Kaguya-sama: Love Is War', ['Kaguya-sama wa Kokurasetai: Tensai-tachi no Renai Zunousen'], { pages: 2 }],
  ['Name a Bocchi the Rock! character.', 'Bocchi the Rock!', ['Bocchi the Rock!'], { pages: 2 }],
  ['Name a Blue Lock character.', 'Blue Lock', ['Blue Lock', 'Blue Lock 2nd Season'], { pages: 3 }],
  ['Name a Solo Leveling character.', 'Solo Leveling', ['Ore dake Level Up na Ken'], { pages: 2 }],
  ['Name a Pokémon character.', 'Pokémon', ['Pocket Monsters', 'Pocket Monsters (2019)', 'Pokemon: Diamond & Pearl'], { pages: 4, keep: 160 }],
  ['Name a Yu-Gi-Oh! character.', 'Yu-Gi-Oh!', ['Yu☆Gi☆Oh! Duel Monsters', 'Yu☆Gi☆Oh! 5D’s', 'Yu☆Gi☆Oh! Zexal'], { pages: 3 }],
  ['Name a Digimon character.', 'Digimon', ['Digimon Adventure', 'Digimon Adventure 02', 'Digimon Tamers'], { pages: 3 }],
  ['Name a Detective Conan character.', 'Detective Conan', ['Detective Conan'], { pages: 5, keep: 160 }],
  ['Name a Slam Dunk character.', 'Slam Dunk', ['Slam Dunk'], { pages: 3 }],
  ['Name an Assassination Classroom character.', 'Assassination Classroom', ['Ansatsu Kyoushitsu'], { pages: 3 }],
  ['Name a Seven Deadly Sins character.', 'The Seven Deadly Sins', ['Nanatsu no Taizai', 'Nanatsu no Taizai: Imashime no Fukkatsu'], { pages: 4 }],
  ['Name a Vinland Saga character.', 'Vinland Saga', ['Vinland Saga'], { pages: 2 }],
  ['Name a Berserk character.', 'Berserk', ['Berserk', 'Berserk (2016)'], { pages: 2 }],
  ['Name an Overlord character.', 'Overlord', ['Overlord'], { pages: 3 }],
  ['Name a That Time I Got Reincarnated as a Slime character.', 'Reincarnated as a Slime', ['Tensei shitara Slime Datta Ken'], { pages: 4 }],
  ['Name a Soul Eater character.', 'Soul Eater', ['Soul Eater'], { pages: 2 }],
  ['Name a Yu Yu Hakusho character.', 'Yu Yu Hakusho', ['Yu Yu Hakusho'], { pages: 2 }],
  ['Name a Rurouni Kenshin character.', 'Rurouni Kenshin', ['Rurouni Kenshin: Meiji Kenkaku Romantan', 'Rurouni Kenshin: Meiji Kenkaku Romantan (2023)'], { pages: 2 }],
  ['Name an Inuyasha character.', 'Inuyasha', ['Inuyasha', 'Inuyasha: Kanketsu-hen'], { pages: 2 }],
  ['Name a Fire Force character.', 'Fire Force', ['Enen no Shouboutai'], { pages: 2 }],
  ['Name a Toradora! character.', 'Toradora!', ['Toradora!'], { pages: 2 }],
  ['Name a Fruits Basket character.', 'Fruits Basket', ['Fruits Basket (2019)', 'Fruits Basket'], { pages: 3 }],
  ['Name a Gundam pilot or character.', 'Gundam', ['Mobile Suit Gundam', 'Mobile Suit Gundam Wing', 'Mobile Suit Gundam SEED', 'Mobile Suit Gundam 00'], { pages: 3, keep: 160 }],
  ['Name a Dandadan character.', 'Dandadan', ['Dandadan'], { pages: 2 }],
  ['Name a Mushoku Tensei character.', 'Mushoku Tensei', ['Mushoku Tensei: Isekai Ittara Honki Dasu'], { pages: 3 }],
  ['Name an Akame ga Kill! character.', 'Akame ga Kill!', ['Akame ga Kill!'], { pages: 2 }],
  ['Name a Kill la Kill character.', 'Kill la Kill', ['Kill la Kill'], { pages: 2 }],
  ['Name a Gurren Lagann character.', 'Gurren Lagann', ['Tengen Toppa Gurren Lagann'], { pages: 2 }],
  ['Name a Madoka Magica character.', 'Madoka Magica', ['Mahou Shoujo Madoka★Magica'], { pages: 2 }],
  ['Name a Lupin the Third character.', 'Lupin the Third', ['Lupin III', 'Lupin III: Part 4'], { pages: 2 }],
  ['Name a Doraemon character.', 'Doraemon', ['Doraemon (2005)', 'Doraemon'], { pages: 2 }],
  ['Name a Violet Evergarden character.', 'Violet Evergarden', ['Violet Evergarden'], { pages: 2 }],
  ['Name a Your Lie in April character.', 'Your Lie in April', ['Shigatsu wa Kimi no Uso'], { pages: 2 }],
  ['Name a Tokyo Revengers character.', 'Tokyo Revengers', ['Tokyo Revengers'], { pages: 3 }],
  ['Name an Ace of Diamond character.', 'Ace of Diamond', ['Diamond no Ace'], { pages: 3 }],
  ['Name a Kuroko\'s Basketball character.', "Kuroko's Basketball", ['Kuroko no Basket'], { pages: 3 }],
  ['Name a Free! character.', 'Free!', ['Free!'], { pages: 2 }],
  ['Name an Ouran High School Host Club character.', 'Ouran High School Host Club', ['Ouran Koukou Host Club'], { pages: 2 }],
  ['Name a Mashle character.', 'Mashle', ['Mashle'], { pages: 2 }],
  ['Name a Sakamoto Days character.', 'Sakamoto Days', ['Sakamoto Days'], { pages: 2 }],
];

const STUDIO_QUESTIONS = [
  'MAPPA', 'Madhouse', 'Bones', 'Wit Studio', 'ufotable', 'Kyoto Animation', 'TRIGGER', 'Sunrise', 'Toei Animation',
  'A-1 Pictures', 'Production I.G', 'Pierrot', 'TMS Entertainment', 'Shaft', 'CloverWorks', 'J.C.STAFF', 'P.A.Works',
  'Studio Deen', 'David Production', 'Silver Link.', 'Lerche', 'Brain\'s Base', 'Gainax', 'Doga Kobo',
  'Studio Ghibli',
];

const LISTS = [
  // [text, category, anilist args, options]
  ['Name a sports anime.', 'Genre', 'genre:"Sports", sort:POPULARITY_DESC', { pages: 5 }],
  ['Name a romance anime.', 'Genre', 'genre:"Romance", sort:POPULARITY_DESC', { pages: 6 }],
  ['Name a horror anime.', 'Genre', 'genre:"Horror", sort:POPULARITY_DESC', { pages: 4 }],
  ['Name a magical girl anime.', 'Genre', 'genre:"Mahou Shoujo", sort:POPULARITY_DESC', { pages: 4 }],
  ['Name a mecha anime.', 'Genre', 'genre:"Mecha", sort:POPULARITY_DESC', { pages: 5 }],
  ['Name a slice of life anime.', 'Genre', 'genre:"Slice of Life", sort:POPULARITY_DESC', { pages: 6 }],
  ['Name a music anime.', 'Genre', 'genre:"Music", sort:POPULARITY_DESC', { pages: 4 }],
  ['Name a psychological thriller anime.', 'Genre', 'genre:"Psychological", sort:POPULARITY_DESC', { pages: 5 }],
  ['Name a comedy anime.', 'Genre', 'genre:"Comedy", sort:POPULARITY_DESC', { pages: 8 }],
  ['Name a fantasy anime.', 'Genre', 'genre:"Fantasy", sort:POPULARITY_DESC', { pages: 8 }],
  ['Name an action anime.', 'Genre', 'genre:"Action", sort:POPULARITY_DESC', { pages: 8 }],
  ['Name an isekai anime.', 'Genre', 'tag:"Isekai", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 6 }],
  ['Name an anime about time travel.', 'Genre', 'tag:"Time Manipulation", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 3 }],
  ['Name a school anime.', 'Genre', 'tag:"School", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 8 }],
  ['Name a shounen anime.', 'Genre', 'tag:"Shounen", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 8 }],
  ['Name a seinen anime.', 'Genre', 'tag:"Seinen", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 6 }],
  ['Name an anime movie.', 'Movies', 'format:MOVIE, sort:POPULARITY_DESC', { pages: 8 }],
  ['Name an anime that aired in the 1990s.', 'Era', 'startDate_greater:19900000, startDate_lesser:20000000, sort:POPULARITY_DESC', { pages: 5 }],
  ['Name an anime that aired in the 2000s.', 'Era', 'startDate_greater:20000000, startDate_lesser:20100000, sort:POPULARITY_DESC', { pages: 6 }],
  ['Name an anime that aired in the 2010s.', 'Era', 'startDate_greater:20100000, startDate_lesser:20200000, sort:POPULARITY_DESC', { pages: 8 }],
  ['Name an anime that aired in the 2020s.', 'Era', 'startDate_greater:20200000, sort:POPULARITY_DESC', { pages: 8 }],
  ['Name an anime with 12 episodes or fewer.', 'Length', 'episodes_lesser:13, format:TV, sort:POPULARITY_DESC', { pages: 8 }],
];

// ---------------------------------------------------------------- run
const existing = fs.existsSync(SEED) ? JSON.parse(fs.readFileSync(SEED, 'utf8')) : [];
const curatedFor = (text) => existing.find((q) => q.text === text)?.answers ?? [];
const result = [];
const TIERS_TITLES = [10, 40, 120];
const TIERS_CHARS = [8, 20, 45];

function add(text, category, cands, tiers, description) {
  const answers = assemble(cands, tiers, curatedFor(text));
  console.log(`${text} -> ${answers.length} answers`);
  // A question needs enough answers to be worth asking; never write an empty one by accident.
  if (answers.length < 15) {
    console.log('  ! too few answers, question skipped');
    return;
  }
  const q = { text, category, answers };
  if (description) q.description = description;
  result.push(q);
}

// Keep the original question order, then append the new ones.
const order = existing.map((q) => q.text);

console.log('> anime with more than 100 episodes');
{
  // AniList stops paging after a few hundred results, so slice by start year and combine.
  const seen = new Set();
  const all = [];
  for (let year = 1958; year <= new Date().getFullYear() + 1; year++) {
    const slice = await listMedia(
      `episodes_greater:100, startDate_greater:${year}0000, startDate_lesser:${year + 1}0000, sort:POPULARITY_DESC`,
      { pages: 10 },
    );
    for (const c of slice) if (!seen.has(c.id)) (seen.add(c.id), all.push(c));
  }
  // Long-running shows that are still airing have no episode total yet, so AniList's
  // "more than 100 episodes" filter misses them. Count how far they have got instead.
  for (let p = 1; p <= 6; p++) {
    const d = await gql(
      `{ Page(page:${p}, perPage:50){ pageInfo{hasNextPage} media(${FILTER}, status:RELEASING, format_in:[TV, ONA], sort:POPULARITY_DESC){ ${MEDIA} episodes nextAiringEpisode{ episode } } } }`,
    );
    for (const m of d?.Page?.media ?? []) {
      const aired = Math.max(m.episodes ?? 0, (m.nextAiringEpisode?.episode ?? 1) - 1);
      if (aired <= 100 || seen.has(m.id)) continue;
      const c = titleCandidate(m);
      if (c) (seen.add(c.id), all.push(c));
    }
    if (!d?.Page?.pageInfo?.hasNextPage) break;
  }
  // Tiers are assigned by position, so the combined list must be most popular first.
  all.sort((a, b) => b.popularity - a.popularity);
  const cands = all;
  add('Name an anime with more than 100 episodes.', 'Anime', cands, [15, 50, 150]);
}

console.log('> anime studios');
add('Name an anime studio.', 'Studios', await studios(), [10, 30, 80]);

console.log('> Studio Ghibli films');
add('Name a Studio Ghibli film.', 'Studio Ghibli', await studioMedia('Studio Ghibli', { pages: 2, movieOnly: true }), [6, 14, 24]);

for (const [text, category, searches, opts] of FRANCHISES) {
  console.log(`> ${category}`);
  add(text, category, await characters(searches, opts), TIERS_CHARS);
}

for (const studio of STUDIO_QUESTIONS.filter((s) => s !== 'Studio Ghibli')) {
  console.log(`> studio ${studio}`);
  const cands = await studioMedia(studio, { pages: 3 });
  if (cands.length < 15) {
    console.log(`  skipped, only ${cands.length} titles`);
    continue;
  }
  const label = studio.replace(/\.$/, '');
  add(`Name an anime made by ${label}.`, `Studio: ${label}`, cands, TIERS_TITLES);
}

for (const [text, category, args, opts] of LISTS) {
  console.log(`> ${text}`);
  add(text, category, await listMedia(args, opts), TIERS_TITLES);
}

// Curated questions that AniList did not rebuild (kept exactly as they were).
for (const q of existing) if (!result.some((r) => r.text === q.text)) result.push(q);

result.sort((a, b) => {
  const ia = order.indexOf(a.text);
  const ib = order.indexOf(b.text);
  return (ia === -1 ? 1e6 : ia) - (ib === -1 ? 1e6 : ib);
});

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
console.log(`\nWrote ${result.length} questions, ${result.reduce((n, q) => n + q.answers.length, 0)} answers to ${SEED}`);
