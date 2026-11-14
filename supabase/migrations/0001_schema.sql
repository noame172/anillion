-- Animellion core schema. All timestamps are timestamptz (stored in UTC).

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  avatar_url text check (avatar_url is null or avatar_url ~ '^https://'),
  role text not null default 'user' check (role in ('user', 'admin')),
  suspended boolean not null default false,
  streak int not null default 0,
  longest_streak int not null default 0,
  last_played_date date,
  games_played int not null default 0,
  total_points int not null default 0,
  created_at timestamptz not null default now()
);
create unique index profiles_username_lower_idx on profiles (lower(username));
create index profiles_total_points_idx on profiles (total_points desc);

-- Password hashes for the dev-local login only. Supabase Auth owns credentials in production.
create table local_credentials (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  password_hash text not null
);
create unique index local_credentials_email_idx on local_credentials (lower(email));

create table questions (
  id uuid primary key default gen_random_uuid(),
  text text not null check (char_length(text) between 5 and 200),
  category text not null default 'General',
  description text,
  type text not null default 'open',
  source text not null default 'manual',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index questions_active_idx on questions (active);

create table answers (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions (id) on delete cascade,
  canonical text not null check (char_length(canonical) between 1 and 80),
  norm text not null,
  verified boolean not null default false,
  provisional_tier text not null default 'common' check (provisional_tier in ('common', 'rare', 'epic', 'ultra')),
  external_ref text,
  created_at timestamptz not null default now(),
  unique (question_id, norm)
);

create table answer_aliases (
  id uuid primary key default gen_random_uuid(),
  answer_id uuid not null references answers (id) on delete cascade,
  question_id uuid not null references questions (id) on delete cascade,
  alias text not null check (char_length(alias) between 1 and 80),
  norm text not null,
  unique (question_id, norm)
);
create index answer_aliases_answer_idx on answer_aliases (answer_id);

create table daily_games (
  id uuid primary key default gen_random_uuid(),
  game_date date not null unique,
  status text not null default 'draft' check (status in ('draft', 'published')),
  question_count int not null check (question_count between 1 and 30),
  config_snapshot jsonb,
  created_at timestamptz not null default now(),
  published_at timestamptz
);

create table daily_game_questions (
  game_id uuid not null references daily_games (id) on delete cascade,
  question_id uuid not null references questions (id) on delete restrict,
  position int not null check (position >= 0),
  primary key (game_id, position),
  unique (game_id, question_id)
);
create index daily_game_questions_question_idx on daily_game_questions (question_id);

-- Rarity frozen at publish time. Scores for a game only ever read from here.
create table rarity_snapshots (
  game_id uuid not null references daily_games (id) on delete cascade,
  question_id uuid not null references questions (id) on delete cascade,
  answer_id uuid not null references answers (id) on delete cascade,
  share numeric(6, 3),
  tier text not null check (tier in ('common', 'rare', 'epic', 'ultra')),
  provisional boolean not null default false,
  primary key (game_id, answer_id)
);

create table game_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles (id) on delete set null,
  guest_id uuid,
  game_id uuid not null references daily_games (id) on delete restrict,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  position int not null default 0,
  current_started_at timestamptz,
  total_score int not null default 0 check (total_score >= 0),
  final_form text check (final_form in ('base', 'ascended', 'azure', 'ultra')),
  status text not null default 'active' check (status in ('active', 'completed')),
  check (user_id is not null or guest_id is not null)
);
-- One session per player per daily game.
create unique index game_sessions_user_game_idx on game_sessions (game_id, user_id) where user_id is not null;
create unique index game_sessions_guest_game_idx on game_sessions (game_id, guest_id) where guest_id is not null;
create index game_sessions_user_idx on game_sessions (user_id);
create index game_sessions_guest_idx on game_sessions (guest_id);
create index game_sessions_leaderboard_idx on game_sessions (game_id, total_score desc) where status = 'completed';

create table submissions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references game_sessions (id) on delete cascade,
  question_id uuid not null references questions (id) on delete restrict,
  raw_text text check (raw_text is null or char_length(raw_text) <= 80),
  answer_id uuid references answers (id) on delete set null,
  tier text check (tier in ('common', 'rare', 'epic', 'ultra')),
  points int not null default 0 check (points in (0, 25, 50, 75, 100)),
  share numeric(6, 3),
  provisional boolean not null default false,
  timed_out boolean not null default false,
  created_at timestamptz not null default now(),
  -- One scored result per question per session: a question can never pay out twice.
  unique (session_id, question_id)
);
create index submissions_answer_idx on submissions (answer_id);

create table answer_stats (
  question_id uuid not null references questions (id) on delete cascade,
  answer_id uuid not null references answers (id) on delete cascade,
  valid_count int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (question_id, answer_id)
);

create table unknown_answers (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions (id) on delete cascade,
  norm text not null,
  raw_text text not null,
  count int not null default 1,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  last_seen_at timestamptz not null default now(),
  unique (question_id, norm)
);
create index unknown_answers_status_idx on unknown_answers (status, count desc);

create table settings (
  key text primary key,
  value jsonb not null
);

create table rate_limits (
  key text not null,
  window_start timestamptz not null,
  count int not null default 1,
  primary key (key, window_start)
);
create index rate_limits_window_idx on rate_limits (window_start);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_created_idx on audit_log (created_at desc);
