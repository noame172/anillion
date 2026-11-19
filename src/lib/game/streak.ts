import { query } from '@/lib/db/client';
import { addDays } from './daily';

/** A streak freeze is earned at every 7th day of a streak, and at most this many can be banked. */
export const FREEZE_EVERY = 7;
export const MAX_FREEZES = 2;

function daysBetween(a: string, b: string): number {
  const t = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.round((t(b) - t(a)) / 86_400_000);
}

export type StreakInfo = {
  /** Days in the streak that is alive today (0 if it has ended). */
  current: number;
  longest: number;
  /** Freezes banked now. */
  freezes: number;
  /** True when yesterday was missed and a freeze will cover it as soon as today's game is played. */
  frozen: boolean;
  /** Missed days that a freeze has already covered. */
  saved: string[];
};

/**
 * Streaks with freezes, from the dates a player completed a game.
 * Every 7th day of a streak earns one freeze (up to 2 banked). A single missed day is covered by a freeze
 * automatically, so the streak carries on; two or more missed days in a row end it. A freeze never
 * adds a day to the count, it only bridges the gap.
 */
export function streakWithFreezes(dates: string[], today: string): StreakInfo {
  const days = [...new Set(dates)].sort();
  let streak = 0;
  let longest = 0;
  let freezes = 0;
  const saved: string[] = [];
  days.forEach((d, i) => {
    const gap = i === 0 ? 0 : daysBetween(days[i - 1], d);
    if (i === 0 || gap > 2 || (gap === 2 && freezes === 0)) streak = 1;
    else {
      if (gap === 2) {
        freezes--;
        saved.push(addDays(days[i - 1], 1));
      }
      streak++;
      if (streak % FREEZE_EVERY === 0) freezes = Math.min(MAX_FREEZES, freezes + 1);
    }
    longest = Math.max(longest, streak);
  });
  if (!days.length) return { current: 0, longest: 0, freezes: 0, frozen: false, saved };
  const gapToday = daysBetween(days[days.length - 1], today);
  const frozen = gapToday === 2 && freezes > 0;
  const alive = gapToday <= 1 || frozen;
  return { current: alive ? streak : 0, longest, freezes, frozen, saved };
}

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
  const { current, longest } = streakWithFreezes(
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
