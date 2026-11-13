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

-- Public leaderboard data: usernames and totals only, never email, role or status.
create view public_profiles as
  select id, username, avatar_url, streak, longest_streak, games_played, total_points
  from profiles
  where not suspended;
grant select on public_profiles to anon, authenticated;
