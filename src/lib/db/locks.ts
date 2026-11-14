import { query } from '@/lib/db/client';

/**
 * Take a transaction-scoped lock on an arbitrary name. Other transactions asking
 * for the same name wait until this one commits or rolls back. Must run inside tx().
 * Use it to serialise work that has no single row to lock, such as "everything
 * that creates or moves this player's games".
 */
export async function advisoryLock(name: string): Promise<void> {
  await query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [name]);
}

/** Lock key shared by everything that creates or moves a signed-in player's game sessions. */
export const playerLock = (userId: string) => `player:${userId}`;
