import fs from 'node:fs';
import path from 'node:path';
import type { Driver } from './client';

// Minimal stand-ins for what Supabase provides, so the same migrations run
// on the embedded dev database.
const SUPABASE_STUB = `
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  created_at timestamptz not null default now()
);
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
`;

export async function migrate(db: Driver, opts: { stubSupabase?: boolean; dir?: string } = {}) {
  const dir = opts.dir ?? path.join(process.cwd(), 'supabase', 'migrations');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  // One transaction behind an advisory lock: two deploys migrating at once take turns
  // instead of both applying the same file, and a failed file leaves nothing half-applied.
  await db.tx(async (q) => {
    await q.query('select pg_advisory_xact_lock($1)', [727_274_001]);
    if (opts.stubSupabase) await q.exec(SUPABASE_STUB);
    await q.exec(
      'create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())',
    );
    const done = new Set((await q.query<{ name: string }>('select name from _migrations')).map((r) => r.name));
    for (const file of files) {
      if (done.has(file)) continue;
      await q.exec(fs.readFileSync(path.join(dir, file), 'utf8'));
      await q.query('insert into _migrations (name) values ($1)', [file]);
    }
  });
}
