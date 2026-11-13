import { z } from 'zod';
import { query } from '@/lib/db/client';
import { AppError } from '@/lib/errors';
import { addAnswer } from '@/lib/admin/questions';

const ENDPOINT = 'https://graphql.anilist.co';

const QUERY = `
query ($search: String) {
  Media(search: $search, type: ANIME) {
    id
    title { romaji english }
    characters(sort: [ROLE, FAVOURITES_DESC], perPage: 50) {
      nodes { id name { full alternative } }
    }
    studios { nodes { id name isAnimationStudio } }
  }
}`;

export const anilistImportSchema = z.object({
  questionId: z.uuid(),
  title: z.string().trim().min(1).max(100),
  kind: z.enum(['characters', 'studios']),
});

type Candidate = { name: string; aliases: string[]; ref: string };

/** Look an anime up on AniList (public API, no key needed). */
export async function fetchAniList(title: string, kind: 'characters' | 'studios'): Promise<{ title: string; items: Candidate[] }> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { search: title } }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AppError(502, 'ANILIST_UNREACHABLE', 'Could not reach AniList. Try again shortly.');
  }
  if (res.status === 404) throw new AppError(404, 'ANILIST_NOT_FOUND', 'AniList has no anime with that title.');
  if (!res.ok) throw new AppError(502, 'ANILIST_ERROR', `AniList returned an error (${res.status}).`);
  const media = (await res.json())?.data?.Media;
  if (!media) throw new AppError(404, 'ANILIST_NOT_FOUND', 'AniList has no anime with that title.');

  const items: Candidate[] =
    kind === 'characters'
      ? (media.characters?.nodes ?? [])
          .filter((c: any) => c?.name?.full)
          .map((c: any) => ({
            name: String(c.name.full).trim(),
            aliases: (c.name.alternative ?? []).filter((a: unknown) => typeof a === 'string' && a.trim()).slice(0, 5),
            ref: `anilist:character:${c.id}`,
          }))
      : (media.studios?.nodes ?? [])
          .filter((s: any) => s?.name)
          .map((s: any) => ({ name: String(s.name).trim(), aliases: [], ref: `anilist:studio:${s.id}` }));
  return { title: media.title?.english || media.title?.romaji || title, items };
}

/**
 * Import AniList names as answers for a question. The data is cached in our
 * own database; players never trigger AniList requests. Imported answers are
 * unverified and do not count until an administrator verifies them.
 */
export async function importFromAniList(input: unknown) {
  const { questionId, title, kind } = anilistImportSchema.parse(input);
  const found = await fetchAniList(title, kind);
  let added = 0;
  let skipped = 0;
  for (const item of found.items) {
    try {
      await addAnswer(questionId, {
        canonical: item.name.slice(0, 80),
        aliases: item.aliases.map((a) => a.slice(0, 80)),
        provisionalTier: 'ultra',
        verified: false,
        externalRef: item.ref,
      });
      added++;
    } catch (err) {
      if (err instanceof AppError && (err.code === 'NAME_TAKEN' || err.status === 400)) skipped++;
      else throw err;
    }
  }
  await query(`update questions set source = 'anilist' where id = $1 and source = 'manual'`, [questionId]);
  return { title: found.title, found: found.items.length, added, skipped };
}
