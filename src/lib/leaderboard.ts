import { query } from '@/lib/db/client';
import { addDays } from '@/lib/game/daily';
import { formForScore, type Form } from '@/lib/game/forms';

export type LeaderboardRow = {
  rank: number;
  username: string;
  avatarUrl: string | null;
  score: number;
  form: Form | null;
  games?: number;
};

/** Best scores for one daily game. Registered, non-suspended players with a finished game only. */
export async function dailyLeaderboard(date: string, limit = 50): Promise<LeaderboardRow[]> {
  const rows = await query<{ username: string; avatar_url: string | null; total_score: number }>(
    `select p.username, p.avatar_url, s.total_score
       from game_sessions s
       join daily_games g on g.id = s.game_id
       join profiles p on p.id = s.user_id
      where g.game_date = $1 and s.status = 'completed' and not p.suspended
      order by s.total_score desc, (s.completed_at - s.started_at) asc, s.completed_at asc
      limit $2`,
    [date, Math.min(Math.max(limit, 1), 100)],
  );
  return rows.map((r, i) => ({
    rank: i + 1,
    username: r.username,
    avatarUrl: r.avatar_url,
    score: r.total_score,
    form: formForScore(r.total_score),
  }));
}

export async function allTimeLeaderboard(limit = 50): Promise<LeaderboardRow[]> {
  const rows = await query<{ username: string; avatar_url: string | null; total_points: number; games_played: number }>(
    `select username, avatar_url, total_points, games_played
       from profiles
      where not suspended and games_played > 0
      order by total_points desc, games_played asc, created_at asc
      limit $1`,
    [Math.min(Math.max(limit, 1), 100)],
  );
  return rows.map((r, i) => ({
    rank: i + 1,
    username: r.username,
    avatarUrl: r.avatar_url,
    score: r.total_points,
    form: null,
    games: r.games_played,
  }));
}

export type Period = 'weekly' | 'monthly';

/** First and last game date of the week (Monday to Sunday) or calendar month that contains `date`. */
export function periodBounds(period: Period, date: string): { from: string; to: string } {
  if (period === 'monthly') {
    const y = Number(date.slice(0, 4));
    const m = Number(date.slice(5, 7));
    return { from: `${date.slice(0, 7)}-01`, to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
  }
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  const from = addDays(date, -((dow + 6) % 7));
  return { from, to: addDays(from, 6) };
}

/**
 * Total points over a week or a month, so a newcomer can compete with players who started earlier.
 * Registered, non-suspended players with at least one finished game in the period.
 */
export async function periodLeaderboard(period: Period, date: string, limit = 50): Promise<{ from: string; to: string; rows: LeaderboardRow[] }> {
  const { from, to } = periodBounds(period, date);
  const rows = await query<{ username: string; avatar_url: string | null; score: number; games: number }>(
    `select p.username, p.avatar_url, sum(s.total_score)::int as score, count(*)::int as games
       from game_sessions s
       join daily_games g on g.id = s.game_id
       join profiles p on p.id = s.user_id
      where g.game_date between $1 and $2 and s.status = 'completed' and not p.suspended
      group by p.id, p.username, p.avatar_url
      order by score desc, games asc, min(s.completed_at) asc
      limit $3`,
    [from, to, Math.min(Math.max(limit, 1), 100)],
  );
  return {
    from,
    to,
    rows: rows.map((r, i) => ({ rank: i + 1, username: r.username, avatarUrl: r.avatar_url, score: r.score, form: null, games: r.games })),
  };
}
