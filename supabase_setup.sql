-- =====================================================================
--  Phase 2a — minimal setup: one private portfolio row per logged-in user
--  Paste ALL of this into Supabase -> SQL Editor -> Run.
-- =====================================================================

create table if not exists public.portfolios (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  holdings     jsonb not null default '{}'::jsonb,   -- your funds (units, cost, ...)
  transactions jsonb not null default '[]'::jsonb,   -- buy/sell records
  updated_at   timestamptz not null default now()
);

-- turn on Row Level Security so each person can touch ONLY their own row
alter table public.portfolios enable row level security;

create policy "read own portfolio"   on public.portfolios
  for select using (auth.uid() = user_id);
create policy "insert own portfolio" on public.portfolios
  for insert with check (auth.uid() = user_id);
create policy "update own portfolio" on public.portfolios
  for update using (auth.uid() = user_id);
