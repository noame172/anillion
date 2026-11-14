-- The migration bookkeeping table sits in the public schema too, so lock it like the rest.
alter table if exists _migrations enable row level security;
