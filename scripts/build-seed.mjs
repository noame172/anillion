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
import { addSharedNames, isCharacterQuestion } from './shared-names.mjs';
import { ensureUltra } from './ultra.mjs';

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
  // Every question needs ultra answers (they are the point of the game), however short its list is.
  return ensureUltra(capUltras(out)).answers;
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

async function listMedia(args, { pages = 4, per = 50, type = 'ANIME' } = {}) {
  const seen = new Set();
  const out = [];
  const filter = `type:${type}, isAdult:false`; // type MANGA lists manga series instead of anime
  for (let p = 1; p <= pages; p++) {
    const d = await gql(`{ Page(page:${p}, perPage:${per}){ pageInfo{hasNextPage} media(${filter}, ${args}){ ${MEDIA} } } }`);
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

/**
 * People from AniList's staff list, most popular first, with one job title ("Voice Actor", "Mangaka",
 * "Director"). A person is also accepted by surname or in Japanese order ("Kamiya Hiroshi").
 */
async function staff(occupation, { pages = 10, keep = 200 } = {}) {
  const byId = new Map();
  for (let p = 1; p <= pages; p++) {
    const d = await gql(`{ Page(page:${p}, perPage:50){ staff(sort:FAVOURITES_DESC){ id favourites primaryOccupations name{ full first last alternative } } } }`);
    for (const s of d?.Page?.staff ?? []) if ((s.primaryOccupations ?? []).includes(occupation)) byId.set(s.id, s);
  }
  const out = [];
  for (const s of [...byId.values()].sort((a, b) => (b.favourites ?? 0) - (a.favourites ?? 0))) {
    const full = s.name?.full && clean(s.name.full);
    if (!full || !isLatin(full)) continue;
    const { first, last } = s.name;
    const aliases = [];
    if (last && isLatin(last) && last.length >= 3) aliases.push(last);
    if (first && last && isLatin(first) && isLatin(last)) aliases.push(`${last} ${first}`);
    for (const a of s.name.alternative ?? []) if (isLatin(a) && clean(a).length <= 40) aliases.push(clean(a));
    out.push({ name: full, aliases: [...new Set(aliases)].slice(0, 5) });
    if (out.length >= keep) break;
  }
  return out;
}

/** Every Pokémon species, in Pokédex order, with its proper English name. Cached after the first run. */
async function pokemon() {
  const file = path.join(CACHE, 'pokemon-names.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = await (await fetch('https://pokeapi.co/api/v2/pokemon-species?limit=2000')).json();
  const names = new Array(list.results.length);
  let next = 0;
  async function worker() {
    while (next < list.results.length) {
      const i = next++;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const s = await (await fetch(list.results[i].url, { signal: AbortSignal.timeout(20_000) })).json();
          names[i] = s.names.find((n) => n.language.name === 'en')?.name ?? list.results[i].name;
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
      names[i] ??= list.results[i].name;
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  fs.writeFileSync(file, JSON.stringify(names));
  return names;
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
  // Batch 2
  ['Name a Clannad character.', 'Clannad', ['Clannad', 'Clannad: After Story'], { pages: 2 }],
  ['Name an Angel Beats! character.', 'Angel Beats!', ['Angel Beats!'], { pages: 2 }],
  ['Name a Trigun character.', 'Trigun', ['Trigun', 'Trigun Stampede'], { pages: 2 }],
  ['Name a Hellsing character.', 'Hellsing', ['Hellsing Ultimate', 'Hellsing'], { pages: 2 }],
  ['Name a Samurai Champloo character.', 'Samurai Champloo', ['Samurai Champloo'], { pages: 1 }],
  ['Name a Parasyte character.', 'Parasyte', ['Kiseijuu: Sei no Kakuritsu'], { pages: 2 }],
  ['Name a Promised Neverland character.', 'The Promised Neverland', ['Yakusoku no Neverland', 'Yakusoku no Neverland 2nd Season'], { pages: 2 }],
  ['Name a Made in Abyss character.', 'Made in Abyss', ['Made in Abyss', 'Made in Abyss: Retsujitsu no Ougonkyou'], { pages: 2 }],
  ['Name a Cardcaptor Sakura character.', 'Cardcaptor Sakura', ['Cardcaptor Sakura', 'Cardcaptor Sakura: Clear Card-hen'], { pages: 2 }],
  ['Name a Saint Seiya character.', 'Saint Seiya', ['Saint Seiya', 'Saint Seiya: The Lost Canvas'], { pages: 3 }],
  ['Name a Fist of the North Star character.', 'Fist of the North Star', ['Hokuto no Ken'], { pages: 2 }],
  ['Name an Initial D character.', 'Initial D', ['Initial D First Stage', 'Initial D Fourth Stage'], { pages: 2 }],
  ['Name a Great Teacher Onizuka character.', 'Great Teacher Onizuka', ['Great Teacher Onizuka'], { pages: 2 }],
  ['Name a Bakuman character.', 'Bakuman', ['Bakuman.'], { pages: 2 }],
  ['Name a Monster character.', 'Monster', ['Monster'], { pages: 2 }],
  ['Name a Ranma ½ character.', 'Ranma ½', ['Ranma ½', 'Ranma ½ (2024)'], { pages: 2 }],
  ['Name a Blue Exorcist character.', 'Blue Exorcist', ['Ao no Exorcist', 'Ao no Exorcist: Kyoto Fujouou-hen'], { pages: 2 }],
  ['Name a D.Gray-man character.', 'D.Gray-man', ['D.Gray-man', 'D.Gray-man Hallow'], { pages: 2 }],
  ['Name a Hitman Reborn! character.', 'Hitman Reborn!', ['Katekyo Hitman Reborn!'], { pages: 3 }],
  ['Name a Shaman King character.', 'Shaman King', ['Shaman King (2021)', 'Shaman King'], { pages: 3 }],
  ['Name a Black Butler character.', 'Black Butler', ['Kuroshitsuji', 'Kuroshitsuji: Book of Circus'], { pages: 2 }],
  ['Name a Rising of the Shield Hero character.', 'The Rising of the Shield Hero', ['Tate no Yuusha no Nariagari'], { pages: 2 }],
  ['Name a Date A Live character.', 'Date A Live', ['Date A Live', 'Date A Live II'], { pages: 2 }],
  ['Name a Horimiya character.', 'Horimiya', ['Horimiya', 'Horimiya: Piece'], { pages: 2 }],
  ['Name a My Dress-Up Darling character.', 'My Dress-Up Darling', ['Sono Bisque Doll wa Koi wo Suru'], { pages: 2 }],
  ['Name a Lycoris Recoil character.', 'Lycoris Recoil', ['Lycoris Recoil'], { pages: 2 }],
  ['Name a Kaiju No. 8 character.', 'Kaiju No. 8', ['Kaijuu 8-gou'], { pages: 2 }],
  ['Name a Delicious in Dungeon character.', 'Delicious in Dungeon', ['Dungeon Meshi'], { pages: 2 }],
  ['Name an Apothecary Diaries character.', 'The Apothecary Diaries', ['Kusuriya no Hitorigoto'], { pages: 2 }],
  ["Name a Hell's Paradise character.", "Hell's Paradise", ['Jigokuraku'], { pages: 2 }],
  ['Name a Zom 100 character.', 'Zom 100', ['Zom 100: Zombie ni Naru made ni Shitai 100 no Koto'], { pages: 2 }],
  ['Name a Cyberpunk: Edgerunners character.', 'Cyberpunk: Edgerunners', ['Cyberpunk: Edgerunners'], { pages: 1 }],
  ['Name a Prince of Tennis character.', 'Prince of Tennis', ['Tennis no Ouji-sama', 'Shin Tennis no Ouji-sama'], { pages: 3 }],
  ['Name an Eyeshield 21 character.', 'Eyeshield 21', ['Eyeshield 21'], { pages: 2 }],
  ['Name a Hajime no Ippo character.', 'Hajime no Ippo', ['Hajime no Ippo', 'Hajime no Ippo: New Challenger'], { pages: 3 }],
  ['Name a Captain Tsubasa character.', 'Captain Tsubasa', ['Captain Tsubasa', 'Captain Tsubasa (2018)'], { pages: 3 }],
  ['Name a Noragami character.', 'Noragami', ['Noragami', 'Noragami Aragoto'], { pages: 2 }],
  ['Name a Magi character.', 'Magi', ['Magi: The Labyrinth of Magic', 'Magi: The Kingdom of Magic'], { pages: 2 }],
  ['Name a Wind Breaker character.', 'Wind Breaker', ['Wind Breaker'], { pages: 2 }],
  ['Name an Undead Unluck character.', 'Undead Unluck', ['Undead Unluck'], { pages: 2 }],
  ['Name an Eminence in Shadow character.', 'The Eminence in Shadow', ['Kage no Jitsuryokusha ni Naritakute!'], { pages: 2 }],
  ['Name a Love Live! character.', 'Love Live!', ['Love Live!', 'Love Live! Sunshine!!'], { pages: 3 }],
  ['Name a K-On! character.', 'K-On!', ['K-On!', 'K-On!!'], { pages: 1 }],
  ['Name a Bungo Stray Dogs character.', 'Bungo Stray Dogs', ['Bungou Stray Dogs', 'Bungou Stray Dogs 2'], { pages: 3 }],
  ['Name a Beastars character.', 'Beastars', ['Beastars'], { pages: 2 }],
  ['Name a Hyouka character.', 'Hyouka', ['Hyouka'], { pages: 1 }],
  ['Name a Danganronpa character.', 'Danganronpa', ['Danganronpa The Animation', 'Danganronpa 3: The End of Hope’s Peak High School'], { pages: 2 }],
  ['Name a Saiki K. character.', 'The Disastrous Life of Saiki K.', ['Saiki Kusuo no Psi-nan'], { pages: 2 }],
  ['Name a Monogatari series character.', 'Monogatari', ['Bakemonogatari', 'Nisemonogatari', 'Monogatari Series: Second Season'], { pages: 3 }],
  ['Name a Cells at Work! character.', 'Cells at Work!', ['Hataraku Saibou'], { pages: 2 }],
  ['Name a Psycho-Pass character.', 'Psycho-Pass', ['Psycho-Pass'], { pages: 2 }],
  ['Name a Tower of God character.', 'Tower of God', ['Kami no Tou'], { pages: 2 }],
  ['Name a Quintessential Quintuplets character.', 'The Quintessential Quintuplets', ['Gotoubun no Hanayome'], { pages: 1 }],
  ['Name a Rent-a-Girlfriend character.', 'Rent-a-Girlfriend', ['Kanojo, Okarishimasu'], { pages: 2 }],
  ['Name a Ranking of Kings character.', 'Ranking of Kings', ['Ousama Ranking'], { pages: 2 }],
  ['Name a Spice and Wolf character.', 'Spice and Wolf', ['Ookami to Koushinryou'], { pages: 1 }],
  ['Name a Rascal Does Not Dream character.', 'Rascal Does Not Dream', ['Seishun Buta Yarou wa Bunny Girl Senpai no Yume wo Minai'], { pages: 1 }],
  ['Name a Ghost in the Shell character.', 'Ghost in the Shell', ['Koukaku Kidoutai', 'Koukaku Kidoutai: Stand Alone Complex'], { pages: 2 }],
  ['Name a Great Pretender character.', 'Great Pretender', ['Great Pretender'], { pages: 1 }],
  ['Name a Welcome to the NHK character.', 'Welcome to the NHK', ['NHK ni Youkoso!'], { pages: 1 }],
  // Batch 3
  ['Name a Black Lagoon character.', 'Black Lagoon', ['Black Lagoon', 'Black Lagoon: The Second Barrage'], { pages: 3 }],
  ['Name a Durarara!! character.', 'Durarara!!', ['Durarara!!', 'Durarara!!x2 Shou'], { pages: 3 }],
  ['Name a Baccano! character.', 'Baccano!', ['Baccano!'], { pages: 4 }],
  ["Name a Kobayashi's Dragon Maid character.", "Kobayashi's Dragon Maid", ['Kobayashi-san Chi no Maid Dragon', 'Kobayashi-san Chi no Maid Dragon S'], { pages: 2 }],
  ['Name a Hikaru no Go character.', 'Hikaru no Go', ['Hikaru no Go'], { pages: 2 }],
  ['Name a Yuri!!! on Ice character.', 'Yuri!!! on Ice', ['Yuri!!! on Ice'], { pages: 2 }],
  ["Name a Komi Can't Communicate character.", "Komi Can't Communicate", ['Komi-san wa, Komyushou desu.', 'Komi-san wa, Komyushou desu. 2nd Season'], { pages: 3 }],
  ['Name a Goblin Slayer character.', 'Goblin Slayer', ['Goblin Slayer', 'Goblin Slayer II'], { pages: 2 }],
  // Batch 4
  ['Name a Darker than Black character.', 'Darker than Black', ['DARKER THAN BLACK: Kuro no Keiyakusha', 'Darker than Black: Ryuusei no Gemini'], { pages: 3 }],
  ['Name a Eureka Seven character.', 'Eureka Seven', ['Koukyoushihen Eureka Seven', 'Eureka Seven AO'], { pages: 3 }],
  ['Name a Dororo character.', 'Dororo', ['Dororo'], { pages: 2 }],
  ['Name a Classroom of the Elite character.', 'Classroom of the Elite', ['Youkoso Jitsuryoku Shijou Shugi no Kyoushitsu e', 'Youkoso Jitsuryoku Shijou Shugi no Kyoushitsu e 2nd Season'], { pages: 3 }],
  ['Name a Zatch Bell character.', 'Zatch Bell', ['Konjiki no Gash!!'], { pages: 4 }],
  ['Name a Chihayafuru character.', 'Chihayafuru', ['Chihayafuru', 'Chihayafuru 2'], { pages: 3 }],
  ["Name a Natsume's Book of Friends character.", "Natsume's Book of Friends", ['Natsume Yuujinchou', 'Natsume Yuujinchou Shi'], { pages: 3 }],
  ['Name a Space Brothers character.', 'Space Brothers', ['Uchuu Kyoudai'], { pages: 3 }],
  ['Name a Paranoia Agent character.', 'Paranoia Agent', ['Mousou Dairinin'], { pages: 2 }],
  ['Name an Odd Taxi character.', 'Odd Taxi', ['Odd Taxi'], { pages: 2 }],
  // Batch 5
  ['Name a Rent-a-Girlfriend character.', 'Rent-a-Girlfriend', ['Kanojo, Okarishimasu', 'Kanojo, Okarishimasu 2nd Season', 'Kanojo, Okarishimasu 3rd Season'], { pages: 3 }],
  ['Name a Steins;Gate character.', 'Steins;Gate', ['Steins;Gate', 'Steins;Gate 0', 'Steins;Gate: Fuka Ryouiki no Deja vu'], { pages: 2 }],
  ['Name a character from a Makoto Shinkai film.', 'Makoto Shinkai', ['Kimi no Na wa.', 'Tenki no Ko', 'Suzume no Tojimari', 'Byousoku 5 Centimeter', 'Kotonoha no Niwa', 'Hoshi wo Ou Kodomo'], { pages: 2 }],
  ['Name a Boruto character.', 'Boruto', ['Boruto: Naruto Next Generations'], { pages: 4 }],
  ['Name a Studio Ghibli character.', 'Studio Ghibli', ['Sen to Chihiro no Kamikakushi', 'Tonari no Totoro', 'Mononoke Hime', 'Howl no Ugoku Shiro', 'Majo no Takkyuubin', 'Kaze no Tani no Nausicaä', 'Tenkuu no Shiro Laputa', 'Kurenai no Buta', 'Hotaru no Haka', 'Gake no Ue no Ponyo', 'Kaze Tachinu', 'Omoide no Marnie', 'Mimi wo Sumaseba'], { pages: 3 }],
  ['Name a Higurashi: When They Cry character.', 'Higurashi', ['Higurashi no Naku Koro ni', 'Higurashi no Naku Koro ni Kai'], { pages: 2 }],
  ['Name a Nana character.', 'Nana', ['Nana'], { pages: 3 }],
  ["Name a Welcome to Demon School! Iruma-kun character.", 'Welcome to Demon School', ['Mairimashita! Iruma-kun', 'Mairimashita! Iruma-kun 2nd Season'], { pages: 3 }],
  ['Name a Food Wars! character.', 'Food Wars!', ['Shokugeki no Souma', 'Shokugeki no Souma: Ni no Sara'], { pages: 4 }],
  ['Name a Devil Is a Part-Timer! character.', 'The Devil Is a Part-Timer!', ['Hataraku Maou-sama!', 'Hataraku Maou-sama!!'], { pages: 2 }],
];

// Questions about a hand-picked group (a villain, a rank, a power). Names that are also written another
// way carry the alias after a "/". Order is roughly most famous first.
const GROUPS = [
  ['Name a Hunter x Hunter villain.', 'Hunter x Hunter', [
    'Hisoka Morow/Hisoka', 'Illumi Zoldyck/Illumi', 'Chrollo Lucilfer/Chrollo', 'Meruem', 'Neferpitou/Pitou', 'Nobunaga Hazama/Nobunaga',
    'Feitan Portor/Feitan', 'Phinks Magcub/Phinks', 'Machi Komacine/Machi', 'Shalnark', 'Franklin Bordeau/Franklin', 'Uvogin',
    'Pakunoda', 'Kortopi', 'Bonolenov', 'Shizuku Murasaki/Shizuku', 'Shaiapouf/Pouf', 'Menthuthuyoupi/Youpi',
    'Gyro', 'Genthru', 
  ]],
  ['Name a Naruto villain.', 'Naruto', [
    'Madara Uchiha/Madara', 'Pain/Nagato', 'Itachi Uchiha/Itachi', 'Orochimaru', 'Obito Uchiha/Tobi', 'Kisame Hoshigaki/Kisame', 'Deidara', 'Sasori',
    'Hidan', 'Kakuzu', 'Konan', 'Zetsu', 'Kabuto Yakushi/Kabuto', 'Kaguya Otsutsuki/Kaguya', 'Danzo Shimura/Danzo', 'Zabuza Momochi/Zabuza',
    'Haku', 'Kimimaro', 'Black Zetsu', 'Isshiki Otsutsuki/Isshiki', 'Momoshiki Otsutsuki/Momoshiki', 'Kinshiki Otsutsuki/Kinshiki', 'Tayuya',
  ]],
  ['Name a One Piece Yonko, Warlord or Admiral.', 'One Piece', [
    'Kaido', 'Charlotte Linlin/Big Mom', 'Shanks', 'Marshall D. Teach/Blackbeard', 'Edward Newgate/Whitebeard', 'Monkey D. Luffy/Luffy', 'Buggy',
    'Dracule Mihawk/Mihawk', 'Donquixote Doflamingo/Doflamingo', 'Crocodile', 'Gecko Moria/Moria', 'Bartholomew Kuma/Kuma', 'Jinbe', 'Trafalgar Law/Law',
    'Boa Hancock/Hancock', 'Sakazuki/Akainu', 'Kuzan/Aokiji', 'Borsalino/Kizaru', 'Issho/Fujitora', 'Ryokugyu/Aramaki', 'Sengoku', 
    
  ]],
  ['Name a Dragon Ball villain.', 'Dragon Ball', [
    'Frieza', 'Cell', 'Majin Buu/Buu', 'Raditz', 'Nappa', 'Vegeta', 'Dr. Gero/Gero', 'Broly', 'Beerus', 'Goku Black', 'Zamasu', 'Jiren', 'Hit',
    'Android 17', 'Android 18', 'Dabura', 'Bojack', 'Turles', 'Cooler', 'Janemba', 'King Piccolo', 'Garlic Jr.', 'Moro', 'Gas', 'Granolah',
    'Pilaf', 'General Blue', 'Commander Red', 'Tao Pai Pai/Mercenary Tao', 'Zarbon', 'Dodoria', 'Ginyu', 'Recoome', 'Android 19', 'Babidi', 
  ]],
  ['Name a Bleach Captain or Espada.', 'Bleach', [
    'Kenpachi Zaraki/Kenpachi', 'Byakuya Kuchiki/Byakuya', 'Toshiro Hitsugaya/Toshiro', 'Shunsui Kyoraku/Shunsui', 'Jushiro Ukitake/Ukitake', 'Mayuri Kurotsuchi/Mayuri',
    'Sosuke Aizen/Aizen', 'Gin Ichimaru/Gin', 'Kaname Tosen/Tosen', 'Genryusai Yamamoto/Yamamoto', 'Soi Fon', 'Retsu Unohana/Unohana', 'Sajin Komamura/Komamura',
    'Ulquiorra Cifer/Ulquiorra', 'Grimmjow Jaegerjaquez/Grimmjow', 'Coyote Starrk/Starrk', 'Baraggan Louisenbairn/Barragan',
    'Nnoitra Gilga/Nnoitra', 'Szayelaporro Granz/Szayel', 'Tier Harribel/Harribel', 'Zommari Rureaux/Zommari', 'Aaroniero Arruruerie/Aaroniero', 'Yammy Llargo/Yammy',
    'Nelliel Tu Odelschwanck/Nel', 'Shinji Hirako/Shinji', 'Kisuke Urahara/Urahara', 'Yoruichi Shihoin/Yoruichi', 
  ]],
  ['Name a JoJo Stand.', "JoJo's Bizarre Adventure", [
    'Star Platinum', 'The World', 'Crazy Diamond', 'Gold Experience', 'Killer Queen', 'King Crimson', 'Silver Chariot', "Magician's Red", 'Hierophant Green',
    'Hermit Purple', 'Stone Free', 'Made in Heaven', 'Purple Haze', 'Sticky Fingers', 'Echoes', 'Beach Boy', 'Aerosmith', "Heaven's Door", 'Gold Experience Requiem',
    'Soft & Wet', 'Tusk', 'Spice Girl', 'Moody Blues', 'Bad Company', 'The Hand', 'Cream', 'Anubis', 'Tohth', 'Death Thirteen', 'Dirty Deeds Done Dirt Cheap', 'Wonder of U',
    'Love Train', 'Weather Report', 'Whitesnake', 'C-Moon', 'Cheap Trick', 'Notorious B.I.G.', 'Paisley Park', 'Yellow Temperance', 'Tower of Gray', 'The Fool', 'Mandom',
  ]],
  ['Name a Demon Slayer Hashira or Demon.', 'Demon Slayer', [
    'Giyu Tomioka', 'Shinobu Kocho', 'Kyojuro Rengoku', 'Tengen Uzui', 'Mitsuri Kanroji', 'Muichiro Tokito', 'Gyomei Himejima', 'Sanemi Shinazugawa', 'Obanai Iguro',
    'Muzan Kibutsuji/Muzan', 'Kokushibo', 'Doma', 'Akaza', 'Gyokko', 'Hantengu', 'Gyutaro', 'Daki', 'Enmu', 'Rui', 'Kaigaku', 'Nakime', 'Kagaya Ubuyashiki/Kagaya',
    'Yushiro', 'Tamayo', 'Susamaru', 'Yahaba', 'Kyogai', 'Hand Demon/Manjiro', 'Nezuko Kamado/Nezuko', 'Zohakuten', 'Karaku', 'Urogi', 'Sekido', 'Aizetsu', 'Kyogai',
  ]],
  ['Name an Attack on Titan Survey Corps member.', 'Attack on Titan', [
    'Levi Ackerman/Levi', 'Hange Zoe/Hange', 'Erwin Smith/Erwin', 'Mikasa Ackerman/Mikasa', 'Armin Arlert/Armin', 'Eren Yeager/Eren', 'Jean Kirstein/Jean',
    'Connie Springer/Connie', 'Sasha Blouse/Sasha', 'Historia Reiss/Historia', 'Moblit Berner/Moblit', 'Mike Zacharias/Mike', 'Nanaba', 'Gelgar', 'Petra Ral/Petra',
    'Oluo Bozado/Oluo', 'Eld Jinn/Eld', 'Gunther Schultz/Gunther', 'Auruo Bossard/Auruo', 'Floch Forster/Floch', 
    'Ymir', 
  ]],
];

const STUDIO_QUESTIONS = [
  'MAPPA', 'Madhouse', 'Bones', 'Wit Studio', 'ufotable', 'Kyoto Animation', 'TRIGGER', 'Sunrise', 'Toei Animation',
  'A-1 Pictures', 'Production I.G', 'Pierrot', 'TMS Entertainment', 'Shaft', 'CloverWorks', 'J.C.STAFF', 'P.A.Works',
  'Studio Deen', 'David Production', 'Silver Link.', 'Lerche', 'Brain\'s Base', 'Gainax', 'Doga Kobo',
  'Studio Ghibli',
  // Batch 3
  'Bandai Namco Pictures', 'Tatsunoko Production', 'Science SARU', 'White Fox', 'Kinema Citrus',
  // Batch 5
  'Pierrot Plus', '4°C', 'Telecom Animation Film', 'OLM', 'Zexcs',
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
  // Batch 2
  ['Name an adventure anime.', 'Genre', 'genre:"Adventure", sort:POPULARITY_DESC', { pages: 6 }],
  ['Name a sci-fi anime.', 'Genre', 'genre:"Sci-Fi", sort:POPULARITY_DESC', { pages: 6 }],
  ['Name a mystery anime.', 'Genre', 'genre:"Mystery", sort:POPULARITY_DESC', { pages: 5 }],
  ['Name a supernatural anime.', 'Genre', 'genre:"Supernatural", sort:POPULARITY_DESC', { pages: 6 }],
  ['Name a drama anime.', 'Genre', 'genre:"Drama", sort:POPULARITY_DESC', { pages: 6 }],
  ['Name a martial arts anime.', 'Genre', 'tag:"Martial Arts", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 4 }],
  ['Name a vampire anime.', 'Genre', 'tag:"Vampire", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 3 }],
  ['Name a samurai anime.', 'Genre', 'tag:"Samurai", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 3 }],
  ['Name a ninja anime.', 'Genre', 'tag:"Ninja", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 3 }],
  ['Name an idol anime.', 'Genre', 'tag:"Idols (Female)", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 3 }],
  ['Name a cooking anime.', 'Genre', 'tag:"Food", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 3 }],
  ['Name a military anime.', 'Genre', 'tag:"Military", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 4 }],
  ['Name a post-apocalyptic anime.', 'Genre', 'tag:"Post-Apocalyptic", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 3 }],
  ['Name a cyberpunk anime.', 'Genre', 'tag:"Cyberpunk", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 3 }],
  ['Name an anime about pirates.', 'Genre', 'tag:"Pirates", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 2 }],
  ['Name a detective anime.', 'Genre', 'tag:"Detective", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 3 }],
  ['Name a superhero anime.', 'Genre', 'tag:"Superhero", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 3 }],
  ['Name an anime about dragons.', 'Genre', 'tag:"Dragons", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 3 }],
  ['Name an anime about demons.', 'Genre', 'tag:"Demons", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 4 }],
  ['Name an anime about magic.', 'Genre', 'tag:"Magic", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 6 }],
  ['Name an anime about video games.', 'Genre', 'tag:"Video Games", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 3 }],
  ['Name an anime about cats.', 'Genre', 'tag:"Cats", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 2 }],
  ['Name an anime based on a video game.', 'Source', 'source:VIDEO_GAME, sort:POPULARITY_DESC', { pages: 4 }],
  ['Name an anime based on a light novel.', 'Source', 'source:LIGHT_NOVEL, sort:POPULARITY_DESC', { pages: 8 }],
  ['Name an anime that is not based on a manga or novel.', 'Source', 'source:ORIGINAL, sort:POPULARITY_DESC', { pages: 8 }],
  ['Name an anime that aired in the 1980s.', 'Era', 'startDate_greater:19800000, startDate_lesser:19900000, sort:POPULARITY_DESC', { pages: 4 }],
  ['Name an anime that aired in 2019.', 'Era', 'startDate_greater:20190000, startDate_lesser:20200000, sort:POPULARITY_DESC', { pages: 5 }],
  ['Name an anime that aired in 2020.', 'Era', 'startDate_greater:20200000, startDate_lesser:20210000, sort:POPULARITY_DESC', { pages: 5 }],
  ['Name an anime that aired in 2021.', 'Era', 'startDate_greater:20210000, startDate_lesser:20220000, sort:POPULARITY_DESC', { pages: 5 }],
  ['Name an anime that aired in 2022.', 'Era', 'startDate_greater:20220000, startDate_lesser:20230000, sort:POPULARITY_DESC', { pages: 5 }],
  ['Name an anime that aired in 2023.', 'Era', 'startDate_greater:20230000, startDate_lesser:20240000, sort:POPULARITY_DESC', { pages: 5 }],
  ['Name an anime that aired in 2024.', 'Era', 'startDate_greater:20240000, startDate_lesser:20250000, sort:POPULARITY_DESC', { pages: 5 }],
  ['Name an anime with exactly 13 episodes.', 'Length', 'episodes:13, format:TV, sort:POPULARITY_DESC', { pages: 5 }],
  ['Name an anime with exactly 24 episodes.', 'Length', 'episodes:24, format:TV, sort:POPULARITY_DESC', { pages: 5 }],
  ['Name an anime with exactly 26 episodes.', 'Length', 'episodes:26, format:TV, sort:POPULARITY_DESC', { pages: 5 }],
  ['Name an anime OVA.', 'Format', 'format:OVA, sort:POPULARITY_DESC', { pages: 5 }],
  ['Name an ONA (anime made for streaming).', 'Format', 'format:ONA, sort:POPULARITY_DESC', { pages: 5 }],
  // Batch 3
  ['Name a baseball anime.', 'Genre', 'tag:"Baseball", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 3 }],
  ['Name a basketball anime.', 'Genre', 'tag:"Basketball", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 2 }],
  ['Name a soccer anime.', 'Genre', 'tag:"Football", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 3 }],
  ['Name a volleyball anime.', 'Genre', 'tag:"Volleyball", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 2 }],
  ['Name a boxing anime.', 'Genre', 'tag:"Boxing", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 2 }],
  ['Name an anime set in space.', 'Genre', 'tag:"Space", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 5 }],
  ['Name a historical anime.', 'Genre', 'tag:"Historical", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 5 }],
  ['Name an anime with a female protagonist.', 'Genre', 'tag:"Female Protagonist", minimumTagRank:70, sort:POPULARITY_DESC', { pages: 6 }],
  ['Name an anime based on a visual novel.', 'Source', 'source:VISUAL_NOVEL, sort:POPULARITY_DESC', { pages: 5 }],
  ['Name an anime that aired in 2016.', 'Era', 'startDate_greater:20160000, startDate_lesser:20170000, sort:POPULARITY_DESC', { pages: 5 }],
  ['Name an anime that aired in 2017.', 'Era', 'startDate_greater:20170000, startDate_lesser:20180000, sort:POPULARITY_DESC', { pages: 5 }],
  ['Name an anime that aired in 2018.', 'Era', 'startDate_greater:20180000, startDate_lesser:20190000, sort:POPULARITY_DESC', { pages: 5 }],
  // Batch 4
  ['Name a police anime.', 'Genre', 'tag:"Police", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 4 }],
  ['Name an anime about ghosts.', 'Genre', 'tag:"Ghost", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 4 }],
  ['Name an anime about reincarnation.', 'Genre', 'tag:"Reincarnation", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 4 }],
  ['Name a survival anime.', 'Genre', 'tag:"Survival", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 4 }],
  ['Name an anime about witches.', 'Genre', 'tag:"Witch", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 4 }],
  ['Name an anime that aired in 2015.', 'Era', 'startDate_greater:20150000, startDate_lesser:20160000, sort:POPULARITY_DESC', { pages: 5 }],
  ['Name an anime that aired in 2014.', 'Era', 'startDate_greater:20140000, startDate_lesser:20150000, sort:POPULARITY_DESC', { pages: 5 }],
  ['Name an anime that aired in 2025.', 'Era', 'startDate_greater:20250000, startDate_lesser:20260000, sort:POPULARITY_DESC', { pages: 5 }],
  ['Name an anime with exactly 12 episodes.', 'Length', 'episodes:12, format:TV, sort:POPULARITY_DESC', { pages: 5 }],
  ['Name a summer 2024 anime.', 'Era', 'season:SUMMER, seasonYear:2024, format:TV, sort:POPULARITY_DESC', { pages: 2 }],
  ['Name a manga series.', 'Manga', 'sort:POPULARITY_DESC', { pages: 8, type: 'MANGA' }],
  // Batch 5
  ['Name a harem anime.', 'Genre', 'tag:"Harem", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 4 }],
  ['Name an ecchi anime.', 'Genre', 'genre:"Ecchi", sort:POPULARITY_DESC', { pages: 5 }],
  ['Name a shoujo anime.', 'Genre', 'tag:"Shoujo", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 4 }],
  ['Name a josei anime.', 'Genre', 'tag:"Josei", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 3 }],
  ['Name a gory anime.', 'Genre', 'tag:"Gore", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 4 }],
  ['Name an anime about school clubs.', 'Genre', 'tag:"Club Activities", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 4 }],
  ['Name an anime about swordplay.', 'Genre', 'tag:"Swordplay", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 4 }],
  ['Name an anime about gods.', 'Genre', 'tag:"Gods", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 3 }],
  ['Name an anime with an anti-hero protagonist.', 'Genre', 'tag:"Anti-Hero", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 3 }],
  ['Name an anime about cars.', 'Genre', 'tag:"Cars", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 3 }],
  ['Name an anime about drawing or art.', 'Genre', 'tag:"Drawing", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 3 }],
  ['Name an anime set in the countryside.', 'Genre', 'tag:"Rural", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 3 }],
  ['Name a tragic anime.', 'Genre', 'tag:"Tragedy", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 4 }],
  ['Name an anime with a time loop.', 'Genre', 'tag:"Time Loop", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 2 }],
  ['Name an anime with robots.', 'Genre', 'tag:"Robots", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 3 }],
  ['Name a dystopian anime.', 'Genre', 'tag:"Dystopian", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 3 }],
  ['Name a war anime.', 'Genre', 'tag:"War", minimumTagRank:60, sort:POPULARITY_DESC', { pages: 4 }],
  ['Name an anime that aired in 2013.', 'Era', 'startDate_greater:20130000, startDate_lesser:20140000, sort:POPULARITY_DESC', { pages: 5 }],
  ['Name an anime that aired in 2012.', 'Era', 'startDate_greater:20120000, startDate_lesser:20130000, sort:POPULARITY_DESC', { pages: 5 }],
  ['Name an anime that aired in 2011.', 'Era', 'startDate_greater:20110000, startDate_lesser:20120000, sort:POPULARITY_DESC', { pages: 5 }],
  ['Name an anime that aired in 2010.', 'Era', 'startDate_greater:20100000, startDate_lesser:20110000, sort:POPULARITY_DESC', { pages: 5 }],
  ['Name a winter 2025 anime.', 'Era', 'season:WINTER, seasonYear:2025, format:TV, sort:POPULARITY_DESC', { pages: 2 }],
  ['Name an anime based on a web novel.', 'Source', 'source:WEB_NOVEL, sort:POPULARITY_DESC', { pages: 4 }],
  ['Name an anime based on a 4-koma manga.', 'Source', 'source:FOUR_KOMA_MANGA, sort:POPULARITY_DESC', { pages: 3 }],
  ['Name an anime based on a manga.', 'Source', 'source:MANGA, sort:POPULARITY_DESC', { pages: 8 }],
  ['Name a light novel series.', 'Light Novels', 'format:NOVEL, sort:POPULARITY_DESC', { pages: 6, type: 'MANGA' }],
  ['Name an anime with exactly 25 episodes.', 'Length', 'episodes:25, format:TV, sort:POPULARITY_DESC', { pages: 4 }],
];

// People: [question, AniList job title, options, tier cut-offs]
const PEOPLE = [
  ['Name a Japanese voice actor.', 'Voice Actor', { pages: 12, keep: 250 }, [10, 40, 120]],
  ['Name a manga artist.', 'Mangaka', { pages: 12, keep: 120 }, [8, 20, 45]],
  ['Name an anime director.', 'Director', { pages: 12, keep: 80 }, [5, 12, 25]],
];

// The best-known Pokémon, in rough order of fame. Everyone else follows in Pokédex order, so the
// newest ones end up rarest. Tiers are only a starting guess until real players have answered.
const POKEMON_COMMON = ['Pikachu', 'Charizard', 'Bulbasaur', 'Squirtle', 'Charmander', 'Eevee', 'Mewtwo', 'Gengar', 'Snorlax', 'Jigglypuff', 'Psyduck', 'Meowth'];
const POKEMON_RARE = [
  'Mew', 'Lucario', 'Greninja', 'Gyarados', 'Dragonite', 'Blastoise', 'Venusaur', 'Arcanine', 'Raichu', 'Lapras', 'Umbreon', 'Espeon',
  'Vaporeon', 'Jolteon', 'Flareon', 'Gardevoir', 'Rayquaza', 'Garchomp', 'Togepi', 'Ditto', 'Magikarp', 'Onix', 'Machamp', 'Alakazam',
  'Ninetales', 'Vulpix', 'Cubone', 'Slowpoke', 'Mimikyu', 'Lugia', 'Ho-Oh', 'Mudkip', 'Torchic', 'Treecko', 'Piplup', 'Chimchar',
  'Turtwig', 'Sylveon', 'Wobbuffet', 'Zubat',
];

// ---------------------------------------------------------------- run
const existing = fs.existsSync(SEED) ? JSON.parse(fs.readFileSync(SEED, 'utf8')) : [];
const curatedFor = (text) => existing.find((q) => q.text === text)?.answers ?? [];
const result = [];
const TIERS_TITLES = [10, 40, 120];
const TIERS_CHARS = [8, 20, 45];

function add(text, category, cands, tiers, description) {
  let answers = assemble(cands, tiers, curatedFor(text));
  // A surname or first name shared by several characters is accepted as the one worth the fewest points.
  if (isCharacterQuestion(text)) answers = addSharedNames(answers).answers;
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

for (const [text, category, names] of GROUPS) {
  console.log(`> ${text}`);
  const cands = names.map((n) => {
    const [name, ...aliases] = n.split('/');
    return { name, aliases };
  });
  add(text, category, cands, [6, 14, 30]);
}

for (const [text, category, args, opts] of LISTS) {
  console.log(`> ${text}`);
  add(text, category, await listMedia(args, opts), TIERS_TITLES);
}

for (const [text, occupation, opts, tiers] of PEOPLE) {
  console.log(`> ${text}`);
  add(text, 'People', await staff(occupation, opts), tiers);
}

console.log('> Pokémon');
{
  const names = await pokemon();
  const byNorm = new Map(names.map((n) => [norm(n), n]));
  const famous = [...POKEMON_COMMON, ...POKEMON_RARE].map((n) => byNorm.get(norm(n))).filter(Boolean);
  const taken = new Set(famous.map(norm));
  const ordered = [...famous, ...names.filter((n) => !taken.has(norm(n)))];
  add('Name a Pokémon.', 'Pokémon', ordered.map((name) => ({ name, aliases: [] })), [POKEMON_COMMON.length, POKEMON_COMMON.length + POKEMON_RARE.length, 800]);
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
