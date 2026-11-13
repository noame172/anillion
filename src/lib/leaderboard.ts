import { query } from '@/lib/db/client';
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
