/**
 * Wipe everything that testing created, so launch starts clean. Questions and answers are kept.
 *
 *   npm run db:reset-play-data            shows what would be deleted
 *   npm run db:reset-play-data -- --yes   deletes it (cannot be undone)
 *
 * Deletes: every game session and submission, the rarity statistics, review-queue entries from
 * players, rate-limit counters, and the daily games that were already served. Games scheduled for
 * the future and not yet served stay. Every profile's streak, points and games played go back to 0.
 * Accounts themselves are kept.
 */
import fs from 'node:fs';
import { createPgDriver } from '../src/lib/db/pg';

for (const f of ['.env.local', '.env']) if (fs.existsSync(f)) process.loadEnvFile(f);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }
  const yes = process.argv.includes('--yes');
  const db = createPgDriver(url);
  const count = async (sql: string) => (await db.query<{ n: number }>(sql))[0].n;
  const counts = {
    'game sessions': await count('select count(*)::int as n from game_sessions'),
    submissions: await count('select count(*)::int as n from submissions'),
    'answer statistics rows': await count('select count(*)::int as n from answer_stats'),
    'unknown-answer rows': await count('select count(*)::int as n from unknown_answers'),
    'served daily games': await count('select count(*)::int as n from daily_games where config_snapshot is not null'),
    'profiles with stats': await count('select count(*)::int as n from profiles where games_played > 0 or total_points > 0 or streak > 0'),
  };
  for (const [k, v] of Object.entries(counts)) console.log(`${String(v).padStart(8)}  ${k}`);
  if (!yes) {
    console.log('\nNothing deleted. Run again with --yes to delete this.');
    process.exit(0);
  }
  await db.tx(async (q) => {
    await q.query('delete from submissions');
    await q.query('delete from game_sessions');
    await q.query('delete from answer_stats');
    await q.query('delete from unknown_answers');
    await q.query('delete from rate_limits');
    await q.query('delete from daily_games where config_snapshot is not null'); // cascades to their questions and rarity
    await q.query(
      'update profiles set streak = 0, longest_streak = 0, last_played_date = null, games_played = 0, total_points = 0',
    );
  });
  console.log('\nDeleted. The game starts fresh.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
