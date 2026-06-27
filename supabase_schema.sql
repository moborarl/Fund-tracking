-- ============================================================
--  Fund Portfolio Monitor — Supabase schema
--  Paste this into Supabase → SQL Editor → Run.
--  Model: market data is SHARED (read by everyone), portfolio
--  data is PRIVATE per signed-in user (Row Level Security).
-- ============================================================

-- 1) PRIVATE: one portfolio row per user (holdings + transactions as JSON)
create table if not exists public.portfolios (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  holdings    jsonb not null default '{}'::jsonb,   -- { code: {name,amc,tax,asset,units,avg,realized} }
  transactions jsonb not null default '[]'::jsonb,  -- [ {code,action,date,units,price,ts,...} ]
  updated_at  timestamptz not null default now()
);

alter table public.portfolios enable row level security;

-- each user can read/write ONLY their own portfolio
create policy "own portfolio - select" on public.portfolios
  for select using (auth.uid() = user_id);
create policy "own portfolio - upsert" on public.portfolios
  for insert with check (auth.uid() = user_id);
create policy "own portfolio - update" on public.portfolios
  for update using (auth.uid() = user_id);

-- 2) SHARED: NAV history (market data, same for everyone)
create table if not exists public.nav_history (
  code  text not null,
  date  date not null,
  nav   double precision not null,
  primary key (code, date)
);
alter table public.nav_history enable row level security;
-- anyone (even anon) may READ market data; writes only via service role (cron)
create policy "nav read all" on public.nav_history for select using (true);

-- 3) SHARED: fund details (returns, fees, top holdings, strategy, ...)
create table if not exists public.fund_details (
  code text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.fund_details enable row level security;
create policy "details read all" on public.fund_details for select using (true);

-- 4) (optional) the universe of fund codes the cron should refresh
create table if not exists public.fund_universe (
  code text primary key,
  active boolean not null default true
);
alter table public.fund_universe enable row level security;
create policy "universe read all" on public.fund_universe for select using (true);

-- NOTE: nav_history / fund_details / fund_universe are written by the
-- scheduled Edge Function using the SERVICE ROLE key, which bypasses RLS.
-- Never expose the service role key in the frontend.
