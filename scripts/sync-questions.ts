/**
 * Make the database in DATABASE_URL match data/seed.json (the questions and their answers).
 *
 *   npm run db:sync            shows what would change and writes nothing
 *   npm run db:sync -- --apply makes the change
 *
 * - New questions are added with their answers.
 * - Questions removed from the file are deleted, or only switched off if they were ever used in a
 *   daily game or answered by someone (so the history stays intact).
 * - Answers, aliases and starting rarities follow the file too: added, removed or changed to match.
 * - Questions created by hand in the admin screens are never touched.
 */
import fs from 'node:fs';
import { createPgDriver } from '../src/lib/db/pg';
import { findSeedCollisions, loadSeedFile, syncSeed } from '../src/lib/db/seed';

for (const f of ['.env.local', '.env']) if (fs.existsSync(f)) process.loadEnvFile(f);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Add it to .env.local (Supabase > Project Settings > Database).');
    process.exit(1);
  }
  const apply = process.argv.includes('--apply');
  const data = loadSeedFile();
  const problems = findSeedCollisions(data);
  for (const p of problems) console.warn('Seed warning:', p);

  const plan = await syncSeed(createPgDriver(url), data, { apply });
  const list = (title: string, items: string[]) => {
    if (!items.length) return;
    console.log(`\n${title} (${items.length}):`);
    for (const t of items) console.log(`  ${t}`);
  };
  list('Add', plan.add);
  list('Delete', plan.remove.filter((r) => r.action === 'delete').map((r) => r.text));
  list('Switch off (already used in a game)', plan.remove.filter((r) => r.action === 'deactivate').map((r) => r.text));
  list('Switch back on', plan.reactivate);
  list('Change category', plan.recategorise);
  list('Answers changed in', plan.topUp);
  const a = plan.answers;
  if (plan.topUp.length) {
    console.log(`  (answers: +${a.added}, -${a.removed}, ${a.retiered} re-rated, +${a.aliasesAdded} aliases, -${a.aliasesRemoved} aliases)`);
  }

  const changes = plan.add.length + plan.remove.length + plan.reactivate.length + plan.recategorise.length + plan.topUp.length;
  if (!changes) console.log('\nThe database already matches the file.');
  else if (apply) console.log(`\nDone. ${changes} question(s) changed.`);
  else console.log(`\n${changes} question(s) would change. Run again with --apply to do it.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Sync failed:', err.message);
  process.exit(1);
});
