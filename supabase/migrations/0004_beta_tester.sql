-- Players who took part while the site was in beta keep a "Beta tester" badge. It is stored on the
-- profile, not computed, because the launch reset wipes game history but keeps accounts.
alter table profiles add column beta_tester boolean not null default false;

-- Everyone registered who has already played counts as a beta tester.
update profiles set beta_tester = true
 where exists (select 1 from game_sessions s where s.user_id = profiles.id);
