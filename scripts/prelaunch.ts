/**
 * Turn pre-launch mode on or off in the database in DATABASE_URL.
 *
 *   npm run prelaunch -- status
 *   npm run prelaunch -- on     nothing counts: every question counts as never played
 *   npm run prelaunch -- off    the game counts normally (do this when you launch)
 *
 * The same switch is on the admin Settings page.
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
  const mode = process.argv[2];
  const db = createPgDriver(url);
  if (mode === 'on' || mode === 'off') {
    // Settings the row does not mention fall back to their defaults, so a partial row is enough.
    await db.query(
      `insert into settings (key, value) values ('game', jsonb_build_object('prelaunch', $1::boolean))
       on conflict (key) do update set value = settings.value || jsonb_build_object('prelaunch', $1::boolean)`,
      [mode === 'on'],
    );
  } else if (mode !== 'status') {
    console.error('Usage: npm run prelaunch -- on | off | status');
    process.exit(1);
  }
  const rows = await db.query<{ value: unknown }>(`select value from settings where key = 'game'`);
  const stored = rows[0] ? (typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value) : {};
  console.log(`Pre-launch mode is ${(stored as { prelaunch?: boolean }).prelaunch ? 'ON (nothing counts yet)' : 'OFF (the game counts normally)'}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
