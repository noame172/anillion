import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createGame, deleteGame, getGameAdmin, listGames, todayDate, updateGame } from '@/lib/admin/games';
import {
  addAlias,
  addAnswer,
  audit,
  createQuestion,
  deleteAlias,
  deleteAnswer,
  getQuestion,
  listQuestions,
  listUnknown,
  removeQuestion,
  resolveUnknown,
  updateAnswer,
  updateQuestion,
} from '@/lib/admin/questions';
import { getAnalytics, listUsers, suspiciousActivity, updateUser } from '@/lib/admin/users';
import { requireAdmin, type UserViewer } from '@/lib/auth/viewer';
import { config } from '@/lib/config';
import { notFound } from '@/lib/errors';
import { aiEnabled, saveSuggestionAsDraft, suggestQuestions } from '@/lib/integrations/ai';
import { importFromAniList } from '@/lib/integrations/anilist';
import { api, parseBody } from '@/lib/security/http';
import { limitFor } from '@/lib/security/ratelimit';
import { getSettings, updateSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

type Ctx = { req: NextRequest; admin: UserViewer; ids: string[]; body: () => Promise<any> };
type Route = [method: string, pattern: string, handler: (c: Ctx) => Promise<unknown>, auditAs?: string];

const uuid = z.uuid();
const anyBody = z.record(z.string(), z.unknown());

const ROUTES: Route[] = [
  ['GET', 'analytics', async () => getAnalytics()],
  ['GET', 'status', async () => ({ mode: config.mode, aiEnabled: aiEnabled(), today: await todayDate() })],

  ['GET', 'questions', async ({ req }) => ({ questions: await listQuestions(req.nextUrl.searchParams.get('q') ?? '') })],
  ['POST', 'questions', async ({ body }) => ({ id: await createQuestion(await body()) }), 'question.create'],
  ['GET', 'questions/:id', async ({ ids }) => getQuestion(ids[0])],
  ['PATCH', 'questions/:id', async ({ ids, body }) => updateQuestion(ids[0], await body()), 'question.update'],
  ['DELETE', 'questions/:id', async ({ ids }) => ({ result: await removeQuestion(ids[0]) }), 'question.remove'],
  ['POST', 'questions/:id/answers', async ({ ids, body }) => ({ id: await addAnswer(ids[0], await body()) }), 'answer.create'],

  ['PATCH', 'answers/:id', async ({ ids, body }) => updateAnswer(ids[0], await body()), 'answer.update'],
  ['DELETE', 'answers/:id', async ({ ids }) => deleteAnswer(ids[0]), 'answer.delete'],
  ['POST', 'answers/:id/aliases', async ({ ids, body }) => ({ id: await addAlias(ids[0], (await body()).alias) }), 'alias.create'],
  ['DELETE', 'aliases/:id', async ({ ids }) => deleteAlias(ids[0]), 'alias.delete'],

  [
    'GET',
    'unknown',
    async ({ req }) => {
      const status = z.enum(['pending', 'approved', 'rejected']).catch('pending').parse(req.nextUrl.searchParams.get('status'));
      return { unknown: await listUnknown(status) };
    },
  ],
  ['POST', 'unknown/:id', async ({ ids, body }) => resolveUnknown(ids[0], await body()), 'unknown.resolve'],

  ['GET', 'games', async () => ({ games: await listGames(), today: await todayDate() })],
  ['POST', 'games', async ({ body }) => ({ id: await createGame(await body()) }), 'game.create'],
  ['GET', 'games/:id', async ({ ids }) => getGameAdmin(ids[0])],
  ['PATCH', 'games/:id', async ({ ids, body }) => updateGame(ids[0], await body()), 'game.update'],
  ['DELETE', 'games/:id', async ({ ids }) => deleteGame(ids[0]), 'game.delete'],

  ['GET', 'settings', async () => ({ settings: await getSettings() })],
  ['PATCH', 'settings', async ({ body }) => ({ settings: await updateSettings(await body()) }), 'settings.update'],

  ['GET', 'users', async ({ req }) => ({ users: await listUsers(req.nextUrl.searchParams.get('q') ?? '') })],
  ['PATCH', 'users/:id', async ({ admin, ids, body }) => updateUser(admin.id, ids[0], await body()), 'user.update'],
  ['GET', 'suspicious', async () => suspiciousActivity()],

  ['POST', 'import/anilist', async ({ body }) => importFromAniList(await body()), 'import.anilist'],
  ['POST', 'ai/suggest', async ({ body }) => ({ suggestions: await suggestQuestions((await body()).topic) }), 'ai.suggest'],
  ['POST', 'ai/save', async ({ body }) => ({ id: await saveSuggestionAsDraft(await body()) }), 'ai.save'],
];

function match(method: string, segments: string[]): { route: Route; ids: string[] } | null {
  for (const route of ROUTES) {
    const parts = route[1].split('/');
    if (route[0] !== method || parts.length !== segments.length) continue;
    const ids: string[] = [];
    const ok = parts.every((part, i) => {
      if (part !== ':id') return part === segments[i];
      if (!uuid.safeParse(segments[i]).success) return false;
      ids.push(segments[i]);
      return true;
    });
    if (ok) return { route, ids };
  }
  return null;
}

/**
 * Single entry point for the admin API. The administrator check happens here,
 * before any route is even looked up, so no admin handler can be reached
 * without it.
 */
const handler = api(async (req, ctx) => {
  const admin = await requireAdmin();
  await limitFor('admin', admin.id);
  const segments = (await ctx.params).path as unknown as string[];
  const found = match(req.method, segments);
  if (!found) throw notFound();

  let parsed: unknown;
  const body = async () => (parsed ??= await parseBody(req, anyBody));
  const result = await found.route[2]({ req, admin, ids: found.ids, body });
  if (found.route[3]) {
    await audit(admin.id, found.route[3], { path: segments.join('/'), body: parsed ?? null });
  }
  return result;
});

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
