-- Citaya / ElizaOS token backtest — Supabase schema.
-- Run this in the Supabase SQL editor before the first `npx ts-node backtest.ts`.

create table if not exists public.github_activity (
  date         date primary key,
  commits      integer not null default 0,
  releases     integer not null default 0,
  stars_delta  integer not null default 0,
  forks_delta  integer not null default 0,
  inserted_at  timestamptz not null default now()
);

create table if not exists public.token_prices (
  date      date not null,
  token_id  text not null,
  open      double precision not null,
  high      double precision not null,
  low       double precision not null,
  close     double precision not null,
  volume    double precision not null,
  inserted_at timestamptz not null default now(),
  primary key (date, token_id)
);

create index if not exists token_prices_token_idx on public.token_prices (token_id);

-- The backtest writes with the ANON key. Enable RLS and add permissive
-- policies so the anon role can upsert. (For a private analytics project this
-- is fine; tighten or swap to a service-role key for anything sensitive.)
alter table public.github_activity enable row level security;
alter table public.token_prices    enable row level security;

drop policy if exists "anon all github_activity" on public.github_activity;
create policy "anon all github_activity" on public.github_activity
  for all to anon using (true) with check (true);

drop policy if exists "anon all token_prices" on public.token_prices;
create policy "anon all token_prices" on public.token_prices
  for all to anon using (true) with check (true);
