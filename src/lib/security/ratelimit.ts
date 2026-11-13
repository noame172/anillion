import { query } from '@/lib/db/client';
import { AppError } from '@/lib/errors';

/**
 * Fixed-window rate limit stored in Postgres, so it holds across serverless
 * instances. Throws a 429 once `limit` is exceeded within `windowSec`.
 */
export async function rateLimit(key: string, limit: number, windowSec: number, now: Date = new Date()): Promise<void> {
  const windowMs = windowSec * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const [row] = await query<{ count: number }>(
    `insert into rate_limits (key, window_start, count) values ($1, $2, 1)
     on conflict (key, window_start) do update set count = rate_limits.count + 1
     returning count`,
    [key.slice(0, 200), windowStart.toISOString()],
  );
  if (Math.random() < 0.01) {
    // Occasional housekeeping; old windows are useless.
    await query('delete from rate_limits where window_start < $1', [new Date(now.getTime() - 2 * 86_400_000).toISOString()]).catch(() => {});
  }
  if (row.count > limit) {
    const retry = Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000);
    throw new AppError(429, 'RATE_LIMITED', `Too many attempts. Try again in ${Math.max(1, retry)} seconds.`);
  }
}

export const LIMITS = {
  /** Per account. */
  login: { limit: 5, windowSec: 15 * 60 },
  /** Per address: looser, because schools and homes share one. */
  loginIp: { limit: 30, windowSec: 15 * 60 },
  gameStartIp: { limit: 120, windowSec: 60 * 60 },
  answerIp: { limit: 240, windowSec: 60 },
  register: { limit: 5, windowSec: 60 * 60 },
  passwordReset: { limit: 3, windowSec: 60 * 60 },
  answer: { limit: 45, windowSec: 60 },
  gameRead: { limit: 120, windowSec: 60 },
  profileWrite: { limit: 10, windowSec: 60 * 60 },
  admin: { limit: 300, windowSec: 60 },
} as const;

export function limitFor(name: keyof typeof LIMITS, subject: string, now?: Date) {
  const l = LIMITS[name];
  return rateLimit(`${name}:${subject}`, l.limit, l.windowSec, now);
}
