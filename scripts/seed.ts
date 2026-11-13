/**
 * Load the starter questions from data/seed.json into the database in DATABASE_URL.
 * Safe to run again: questions and answers that already exist are skipped.
 * Usage: npm run db:seed   (reads .env.local if present)
 */
import fs from 'node:fs';
import { createPgDriver } from '../src/lib/db/pg';
import { findSeedCollisions, loadSeedFile, seed } from '../src/lib/db/seed';

if (fs.existsSync('.env.local')) process.loadEnvFile('.env.local');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Add it to .env.local (Supabase > Project Settings > Database).');
    process.exit(1);
  }
  const data = loadSeedFile();
  for (const warning of findSeedCollisions(data)) console.warn('Seed warning:', warning);
  const count = await seed(createPgDriver(url), data);
  console.log(`Seeded ${count} questions.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Seeding failed:', err.message);
  process.exit(1);
});
