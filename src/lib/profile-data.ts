import { query, queryOne } from '@/lib/db/client';
import { gameDateFor } from '@/lib/game/daily';
import { formForScore, type Form } from '@/lib/game/forms';
import type { Viewer } from '@/lib/game/session';
import { liveStreak, streakFromDates } from '@/lib/game/streak';
import { getSettings } from '@/lib/settings';

export type HistoryRow = { date: string; score: number; form: Form; completed: boolean; gameNumber: number };

export type ProfileData = {
  username: string;
  avatarUrl: string | null;
  role: 'user' | 'admin';
  createdAt: string;
  streak: number;
  longestStreak: number;
  gamesPlayed: number;
  totalPoints: number;
  averageScore: number;
  bestScore: number;
};

async function today(now: Date) {
  const s = await getSettings();
  return gameDateFor(now, s.timezone, s.rolloverHour);
}

/** A player's own game history. Scoped by the server-verified viewer, never by a client-supplied id. */
export async function getHistory(viewer: Viewer, limit = 60): Promise<HistoryRow[]> {
  const col = viewer.kind === 'user' ? 'user_id' : 'guest_id';
  const rows = await query<{ d: string; total_score: number; status: string; n: number }>(
    `select g.game_date::text as d, s.total_score, s.status,
            (select count(*)::int from daily_games x where x.status = 'published' and x.game_date <= g.game_date) as n
       from game_sessions s join daily_games g on g.id = s.game_id
      where s.${col} = $1
      order by g.game_date desc limit $2`,
    [viewer.id, limit],
  );
  return rows.map((r) => ({
    date: r.d,
    score: r.total_score,
    form: formForScore(r.total_score),
    completed: r.status === 'completed',
    gameNumber: r.n,
  }));
}

export async function getProfile(userId: string, now: Date = new Date()): Promise<ProfileData | null> {
  const p = await queryOne<{
    username: string;
    avatar_url: string | null;
    role: 'user' | 'admin';
    created_at: Date;
    streak: number;
    longest_streak: number;
    last_played: string | null;
    games_played: number;
    total_points: number;
    best: number | null;
  }>(
    `select p.username, p.avatar_url, p.role, p.created_at, p.streak, p.longest_streak,
            p.last_played_date::text as last_played, p.games_played, p.total_points,
            (select max(total_score) from game_sessions where user_id = p.id and status = 'completed') as best
       from profiles p where p.id = $1`,
    [userId],
  );
  if (!p) return null;
  return {
    username: p.username,
    avatarUrl: p.avatar_url,
    role: p.role,
    createdAt: new Date(p.created_at).toISOString(),
    streak: liveStreak(p.streak, p.last_played, await today(now)),
    longestStreak: p.longest_streak,
    gamesPlayed: p.games_played,
    totalPoints: p.total_points,
    averageScore: p.games_played ? Math.round(p.total_points / p.games_played) : 0,
    bestScore: p.best ?? 0,
  };
}

/** Streak for any viewer, including guests (computed from their own sessions). */
export async function getStreak(viewer: Viewer, now: Date = new Date()): Promise<number> {
  const history = await getHistory(viewer, 400);
  return streakFromDates(
    history.filter((h) => h.completed).map((h) => h.date),
    await today(now),
  ).current;
}
