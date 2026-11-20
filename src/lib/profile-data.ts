import { query, queryOne } from '@/lib/db/client';
import { gameDateFor } from '@/lib/game/daily';
import { formForScore, type Form } from '@/lib/game/forms';
import type { Viewer } from '@/lib/game/session';
import { badgesFor, type Badge } from '@/lib/badges';
import { streakWithFreezes, type StreakInfo } from '@/lib/game/streak';
import { getSettings } from '@/lib/settings';

export type HistoryRow = { date: string; score: number; form: Form; completed: boolean; gameNumber: number };

export type ProfileData = {
  username: string;
  avatarUrl: string | null;
  role: 'user' | 'admin';
  createdAt: string;
  streak: number;
  /** Streak freezes banked, and whether one is about to cover yesterday. */
  freezes: number;
  frozen: boolean;
  longestStreak: number;
  gamesPlayed: number;
  totalPoints: number;
  averageScore: number;
  bestScore: number;
  betaTester: boolean;
};

async function today(now: Date) {
  const s = await getSettings();
  return gameDateFor(now, s.timezone, s.rolloverHour);
}

/** A player's own game history. Scoped by the server-verified viewer, never by a client-supplied id. */
export async function getHistory(viewer: Viewer, limit = 60): Promise<HistoryRow[]> {
  const col = viewer.kind === 'user' ? 'user_id' : 'guest_id';
  const rows = await query<{ d: string; total_score: number; status: string; n: number }>(
    `with numbered as (
       select id, (row_number() over (order by game_date))::int as n from daily_games where status = 'published'
     )
     select g.game_date::text as d, s.total_score, s.status, coalesce(n.n, 0) as n
       from game_sessions s
       join daily_games g on g.id = s.game_id
       left join numbered n on n.id = g.id
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
    beta_tester: boolean;
  }>(
    `select p.username, p.avatar_url, p.role, p.created_at, p.streak, p.longest_streak,
            p.last_played_date::text as last_played, p.games_played, p.total_points,
            (select max(total_score) from game_sessions where user_id = p.id and status = 'completed') as best,
            p.beta_tester
       from profiles p where p.id = $1`,
    [userId],
  );
  if (!p) return null;
  const streak = await streakInfo({ kind: 'user', id: userId } as Viewer, now);
  return {
    username: p.username,
    avatarUrl: p.avatar_url,
    role: p.role,
    createdAt: new Date(p.created_at).toISOString(),
    streak: streak.current,
    freezes: streak.freezes,
    frozen: streak.frozen,
    longestStreak: p.longest_streak,
    gamesPlayed: p.games_played,
    totalPoints: p.total_points,
    averageScore: p.games_played ? Math.round(p.total_points / p.games_played) : 0,
    bestScore: p.best ?? 0,
    betaTester: p.beta_tester,
  };
}

/** Streak, freezes and longest run for any viewer, including guests (computed from their own sessions). */
export async function streakInfo(viewer: Viewer, now: Date = new Date()): Promise<StreakInfo> {
  const history = await getHistory(viewer, 400);
  return streakWithFreezes(
    history.filter((h) => h.completed).map((h) => h.date),
    await today(now),
  );
}

/** Streak for any viewer, including guests (computed from their own sessions). */
export async function getStreak(viewer: Viewer, now: Date = new Date()): Promise<number> {
  return (await streakInfo(viewer, now)).current;
}

export type PlayerStats = {
  answered: number;
  tiers: { common: number; rare: number; epic: number; ultra: number };
  timeouts: number;
  /** The player's most recent Ultra answers, newest first. */
  ultraAnswers: { answer: string; question: string; date: string }[];
  badges: Badge[];
};

/** Lifetime numbers and badges for a registered player. Looked up by the verified user id only. */
export async function getPlayerStats(userId: string, profile: Pick<ProfileData, 'gamesPlayed' | 'longestStreak' | 'bestScore' | 'betaTester'>): Promise<PlayerStats> {
  const counts = await queryOne<{ common: number; rare: number; epic: number; ultra: number; timeouts: number }>(
    `select count(*) filter (where s.tier = 'common')::int as common,
            count(*) filter (where s.tier = 'rare')::int as rare,
            count(*) filter (where s.tier = 'epic')::int as epic,
            count(*) filter (where s.tier = 'ultra')::int as ultra,
            count(*) filter (where s.timed_out)::int as timeouts
       from submissions s join game_sessions gs on gs.id = s.session_id
      where gs.user_id = $1`,
    [userId],
  );
  const recent = await query<{ answer: string; question: string; d: string }>(
    `select a.canonical as answer, q.text as question, g.game_date::text as d
       from submissions s
       join game_sessions gs on gs.id = s.session_id
       join daily_games g on g.id = gs.game_id
       join answers a on a.id = s.answer_id
       join questions q on q.id = s.question_id
      where gs.user_id = $1 and s.tier = 'ultra'
      order by g.game_date desc, s.created_at desc limit 6`,
    [userId],
  );
  const tiers = { common: counts?.common ?? 0, rare: counts?.rare ?? 0, epic: counts?.epic ?? 0, ultra: counts?.ultra ?? 0 };
  return {
    answered: tiers.common + tiers.rare + tiers.epic + tiers.ultra,
    tiers,
    timeouts: counts?.timeouts ?? 0,
    ultraAnswers: recent.map((r) => ({ answer: r.answer, question: r.question, date: r.d })),
    badges: badgesFor({ gamesPlayed: profile.gamesPlayed, longestStreak: profile.longestStreak, ultraAnswers: tiers.ultra, bestScore: profile.bestScore, betaTester: profile.betaTester }),
  };
}
