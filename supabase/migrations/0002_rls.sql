-- Row Level Security.
-- The application server talks to Postgres over a server-only connection, so
-- these policies are the second line of defence: they decide what the public
-- Supabase API (anon / authenticated keys) can reach if someone calls it directly.

alter table profiles enable row level security;
alter table local_credentials enable row level security;
alter table questions enable row level security;
alter table answers enable row level security;
alter table answer_aliases enable row level security;
alter table daily_games enable row level security;
alter table daily_game_questions enable row level security;
alter table rarity_snapshots enable row level security;
alter table game_sessions enable row level security;
alter table submissions enable row level security;
alter table answer_stats enable row level security;
alter table unknown_answers enable row level security;
alter table settings enable row level security;
alter table rate_limits enable row level security;
alter table audit_log enable row level security;

-- Start from nothing, then grant the minimum.
revoke all on all tables in schema public from anon, authenticated;

-- Profiles: a user can read their own row and change only username / avatar.
grant select on profiles to authenticated;
grant update (username, avatar_url) on profiles to authenticated;
create policy profiles_select_own on profiles for select to authenticated using (id = auth.uid());
create policy profiles_update_own on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Game history: read-only, own rows only. Scores are written by the server.
grant select on game_sessions to authenticated;
create policy game_sessions_select_own on game_sessions for select to authenticated using (user_id = auth.uid());

grant select on submissions to authenticated;
create policy submissions_select_own on submissions for select to authenticated using (
  exists (select 1 from game_sessions s where s.id = submissions.session_id and s.user_id = auth.uid())
);

-- Everything else (questions, answers, aliases, rarity, stats, settings, ...)
-- has RLS on and no policy: unreachable through the public API.

-- Leaderboards are built by the server. There is deliberately no public view
-- over profiles: a simple view would run with its owner's rights, skip RLS,
-- and be writable through the public API.

-- Tables and views created later must not inherit access for the public roles.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
