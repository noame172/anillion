import { query } from '@/lib/db/client';
import { addDays } from './daily';

/**
 * Streaks from the list of dates a player completed a game.
 * The current streak counts back from today, or from yesterday if today
 * has not been played yet.
 */
export function streakFromDates(dates: string[], today: string): { current: number; longest: number } {
  const days = [...new Set(dates)].sort().reverse();
  if (!days.length) return { current: 0, longest: 0 };

  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    run = addDays(days[i], 1) === days[i - 1] ? run + 1 : 1;
    longest = Math.max(longest, run);
  }

  let current = 0;
  if (days[0] === today || days[0] === addDays(today, -1)) {
    current = 1;
    for (let i = 1; i < days.length && addDays(days[i], 1) === days[i - 1]; i++) current++;
  }
  return { current, longest };
}

/** Rebuild a profile's totals and streaks from its completed sessions. */
export async function recomputeProfileStats(userId: string, today: string): Promise<void> {
  // Lock first, read second: whoever recomputes next sees every session committed before it.
  await query('select 1 from profiles where id = $1 for update', [userId]);
  const rows = await query<{ d: string; score: number }>(
    `select g.game_date::text as d, s.total_score as score
       from game_sessions s join daily_games g on g.id = s.game_id
      where s.user_id = $1 and s.status = 'completed'`,
    [userId],
  );
  const { current, longest } = streakFromDates(
    rows.map((r) => r.d),
    today,
  );
  const last = rows.map((r) => r.d).sort().pop() ?? null;
  await query(
    `update profiles
        set games_played = $2, total_points = $3, streak = $4,
            longest_streak = greatest(longest_streak, $5), last_played_date = $6
      where id = $1`,
    [userId, rows.length, rows.reduce((sum, r) => sum + r.score, 0), current, longest, last],
  );
}

/** A stored streak is only still alive if the last game was today or yesterday. */
export function liveStreak(streak: number, lastPlayed: string | null, today: string): number {
  if (!lastPlayed) return 0;
  return lastPlayed === today || lastPlayed === addDays(today, -1) ? streak : 0;
}
