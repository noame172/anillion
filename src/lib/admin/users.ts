import { z } from 'zod';
import { query, queryOne } from '@/lib/db/client';
import { badRequest, notFound } from '@/lib/errors';
import { addDays } from '@/lib/game/daily';
import { todayDate } from './games';

export async function listUsers(search = '') {
  return query(
    `select p.id, p.username, u.email, p.role, p.suspended, p.games_played, p.total_points, p.streak, p.created_at
       from profiles p left join auth.users u on u.id = p.id
      where ($1 = '' or p.username ilike '%' || $1 || '%' or u.email ilike '%' || $1 || '%')
      order by p.created_at desc limit 200`,
    [search.trim().slice(0, 100)],
  );
}

export const updateUserSchema = z.object({ suspended: z.boolean().optional(), role: z.enum(['user', 'admin']).optional() });

export async function updateUser(actorId: string, userId: string, input: unknown) {
  const patch = updateUserSchema.parse(input);
  // Guard against an admin locking themselves (and possibly everyone) out.
  if (actorId === userId) throw badRequest('You cannot change your own role or suspension.');
  const current = await queryOne<{ role: string; suspended: boolean }>('select role, suspended from profiles where id = $1', [
    userId,
  ]);
  if (!current) throw notFound('User not found.');
  await query('update profiles set role = $2, suspended = $3 where id = $1', [
    userId,
    patch.role ?? current.role,
    patch.suspended ?? current.suspended,
  ]);
}

/** Sessions that look automated, and identities that keep hitting rate limits. */
export async function suspiciousActivity() {
  const fastSessions = await query(
    `select s.id, p.username, s.user_id, s.guest_id, g.game_date::text as date, s.total_score,
            round(extract(epoch from (s.completed_at - s.started_at)))::int as seconds
       from game_sessions s
       join daily_games g on g.id = s.game_id
       left join profiles p on p.id = s.user_id
      where s.status = 'completed' and s.completed_at - s.started_at < interval '20 seconds'
      order by s.completed_at desc limit 50`,
  );
  const rateLimited = await query(
    `select key, sum(count)::int as hits, max(window_start) as last_seen
       from rate_limits where window_start > now() - interval '1 day'
      group by key having sum(count) > 100 order by hits desc limit 50`,
  );
  return { fastSessions, rateLimited };
}

export async function getAnalytics(now = new Date()) {
  const today = await todayDate(now);
  const one = async <T>(sql: string, params: unknown[] = []) => (await queryOne<T>(sql, params))!;

  const totals = await one<{ users: number; games: number; completed: number; avg_score: number | null }>(
    `select (select count(*)::int from profiles) as users,
            (select count(*)::int from game_sessions) as games,
            (select count(*)::int from game_sessions where status = 'completed') as completed,
            (select round(avg(total_score))::int from game_sessions where status = 'completed') as avg_score`,
  );
  // "Active" = distinct players (accounts or guests) who started a game in the period.
  const active = await one<{ dau: number; mau: number }>(
    `select count(distinct coalesce(s.user_id, s.guest_id)) filter (where g.game_date = $1)::int as dau,
            count(distinct coalesce(s.user_id, s.guest_id)) filter (where g.game_date > $2)::int as mau
       from game_sessions s join daily_games g on g.id = s.game_id`,
    [today, addDays(today, -30)],
  );
  const daily = await query(
    `select g.game_date::text as date, count(*)::int as started,
            count(*) filter (where s.status = 'completed')::int as completed,
            round(avg(s.total_score) filter (where s.status = 'completed'))::int as avg_score
       from game_sessions s join daily_games g on g.id = s.game_id
      where g.game_date > $1 group by g.game_date order by g.game_date desc`,
    [addDays(today, -14)],
  );
  const topQuestions = await query(
    `select q.text, sum(st.valid_count)::int as submissions
       from answer_stats st join questions q on q.id = st.question_id
      group by q.id, q.text order by submissions desc limit 8`,
  );
  const topAnswers = await query(
    `select a.canonical, q.text as question, st.valid_count as count
       from answer_stats st join answers a on a.id = st.answer_id join questions q on q.id = st.question_id
      order by st.valid_count desc limit 8`,
  );
  const rarestAnswers = await query(
    `select a.canonical, q.text as question, st.valid_count as count
       from answer_stats st join answers a on a.id = st.answer_id join questions q on q.id = st.question_id
      where st.valid_count > 0 order by st.valid_count asc, a.canonical limit 8`,
  );
  // Next-day retention: of the players who played yesterday, how many came back today.
  const retention = await one<{ yesterday: number; returned: number }>(
    `with y as (select distinct coalesce(s.user_id, s.guest_id) as who from game_sessions s
                  join daily_games g on g.id = s.game_id where g.game_date = $2),
          t as (select distinct coalesce(s.user_id, s.guest_id) as who from game_sessions s
                  join daily_games g on g.id = s.game_id where g.game_date = $1)
     select (select count(*)::int from y) as yesterday,
            (select count(*)::int from y join t using (who)) as returned`,
    [today, addDays(today, -1)],
  );
  const streaks = await query(
    `select case when streak >= 30 then '30+' when streak >= 7 then '7-29' when streak >= 3 then '3-6'
                 when streak >= 1 then '1-2' else '0' end as bucket, count(*)::int as users
       from profiles where last_played_date >= $1 or streak = 0 group by 1 order by 1`,
    [addDays(today, -1)],
  );
  return {
    today,
    totals: {
      users: totals.users,
      gamesStarted: totals.games,
      gamesCompleted: totals.completed,
      averageScore: totals.avg_score,
      completionRate: totals.games ? Math.round((totals.completed / totals.games) * 100) : null,
    },
    dau: active.dau,
    mau: active.mau,
    daily,
    topQuestions,
    topAnswers,
    rarestAnswers,
    retention: {
      playedYesterday: retention.yesterday,
      returnedToday: retention.returned,
      rate: retention.yesterday ? Math.round((retention.returned / retention.yesterday) * 100) : null,
    },
    streaks,
  };
}
