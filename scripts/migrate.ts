/**
 * Apply supabase/migrations/*.sql to the database in DATABASE_URL.
 * Usage: npm run db:migrate   (reads .env.local if present)
 */
import fs from 'node:fs';
import { migrate } from '../src/lib/db/migrate';
import { createPgDriver } from '../src/lib/db/pg';

// .env.local wins over .env (loadEnvFile never overrides variables that are already set).
for (const f of ['.env.local', '.env']) if (fs.existsSync(f)) process.loadEnvFile(f);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Add it to .env.local (Supabase > Project Settings > Database).');
    process.exit(1);
  }
  const db = createPgDriver(url);
  await migrate(db);
  console.log('Migrations are up to date.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
