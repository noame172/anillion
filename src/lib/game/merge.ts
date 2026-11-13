import { query, tx } from '@/lib/db/client';
import { getSettings } from '@/lib/settings';
import { gameDateFor } from './daily';
import { recomputeProfileStats } from './streak';

/**
 * Move a guest's games onto an account after sign-up or login.
 * A game the account already played is never replaced, so this cannot be
 * used to pick the better of two attempts.
 */
export async function mergeGuestIntoUser(guestId: string, userId: string, now: Date = new Date()): Promise<number> {
  return tx(async () => {
    const moved = await query(
      `update game_sessions g set user_id = $2
        where g.guest_id = $1 and g.user_id is null
          and not exists (select 1 from game_sessions u where u.user_id = $2 and u.game_id = g.game_id)
        returning g.id`,
      [guestId, userId],
    );
    if (moved.length) {
      const s = await getSettings();
      await recomputeProfileStats(userId, gameDateFor(now, s.timezone, s.rolloverHour));
    }
    return moved.length;
  });
}
