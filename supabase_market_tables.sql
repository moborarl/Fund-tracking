-- =====================================================================
--  Phase 2b — shared market-data tables (read by everyone, written by
--  the daily refresh job only). Paste into Supabase -> SQL Editor -> Run.
-- =====================================================================
create table if not exists public.nav_history (
  code text not null, date date not null, nav double precision not null,
  primary key (code, date)
);
create table if not exists public.fund_details (
  code text primary key, data jsonb not null, updated_at timestamptz default now()
);
create table if not exists public.fund_universe (
  code text primary key, active boolean default true, added_at timestamptz default now()
);
alter table public.nav_history  enable row level security;
alter table public.fund_details enable row level security;
alter table public.fund_universe enable row level security;
-- everyone (even logged-out) can READ market data
create policy "nav read"     on public.nav_history  for select using (true);
create policy "details read" on public.fund_details for select using (true);
create policy "universe read" on public.fund_universe for select using (true);
-- logged-in users may REGISTER a new fund code (so the daily job will track it)
create policy "universe add" on public.fund_universe for insert to authenticated with check (true);
