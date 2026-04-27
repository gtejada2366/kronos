-- ObraScope schema (Supabase / Postgres)
-- Run inside the Supabase SQL editor, or via `supabase db push`.

create extension if not exists "pgcrypto";

-- ENTITIES ------------------------------------------------------------------
create type entity_tipo as enum (
  'MUNICIPALIDAD_PROVINCIAL',
  'MUNICIPALIDAD_DISTRITAL',
  'GOBIERNO_REGIONAL'
);

create table if not exists public.entities (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  ubigeo text not null,
  tipo entity_tipo not null,
  telegram_chat_id text,
  created_at timestamptz not null default now()
);

-- PROFILES ------------------------------------------------------------------
create type profile_role as enum ('owner', 'viewer');

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete restrict,
  role profile_role not null default 'viewer',
  created_at timestamptz not null default now()
);

-- PROJECTS ------------------------------------------------------------------
create type project_estado as enum (
  'EN_EJECUCION',
  'PARALIZADO',
  'CONCLUIDO',
  'EN_LIQUIDACION'
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete cascade,
  codigo text not null,
  nombre text not null,
  pia bigint not null default 0,
  pim bigint not null default 0,
  devengado bigint not null default 0,
  avance_fisico numeric(5,2) not null default 0,
  estado project_estado not null default 'EN_EJECUCION',
  fecha_inicio date not null,
  fecha_fin date not null,
  updated_at timestamptz not null default now(),
  unique (entity_id, codigo)
);

create index if not exists projects_entity_idx on public.projects (entity_id);
create index if not exists projects_estado_idx on public.projects (estado);

-- EXECUTIONS (monthly snapshots) -------------------------------------------
create table if not exists public.executions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  mes int not null check (mes between 1 and 12),
  anio int not null check (anio between 2020 and 2100),
  devengado bigint not null default 0,
  pim bigint not null default 0,
  created_at timestamptz not null default now(),
  unique (project_id, anio, mes)
);

create index if not exists executions_project_idx on public.executions (project_id);

-- ALERTS --------------------------------------------------------------------
create type alert_tipo as enum (
  'SEMAFORO_ROJO',
  'DEVENGADO_BAJO',
  'PARALIZADO',
  'DIGEST_SEMANAL'
);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  tipo alert_tipo not null,
  mensaje text not null,
  sent_at timestamptz not null default now()
);

create index if not exists alerts_entity_idx on public.alerts (entity_id);
create index if not exists alerts_project_idx on public.alerts (project_id);

-- PROJECT HISTORY (audit log) ----------------------------------------------
create table if not exists public.project_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  field text not null,
  old_value text,
  new_value text,
  changed_at timestamptz not null default now()
);

create index if not exists project_history_project_idx
  on public.project_history (project_id, changed_at desc);

create or replace function public.log_project_changes() returns trigger
language plpgsql as $$
declare
  watched text[] := array['pia','pim','devengado','avance_fisico','estado','fecha_inicio','fecha_fin','nombre'];
  fname text;
  oldv text;
  newv text;
begin
  foreach fname in array watched loop
    execute format('select ($1).%I::text, ($2).%I::text', fname, fname)
      into oldv, newv using OLD, NEW;
    if oldv is distinct from newv then
      insert into public.project_history (project_id, field, old_value, new_value)
      values (NEW.id, fname, oldv, newv);
    end if;
  end loop;
  return NEW;
end;
$$;

drop trigger if exists project_changes_audit on public.projects;
create trigger project_changes_audit
  after update on public.projects
  for each row execute function public.log_project_changes();

-- ROW LEVEL SECURITY --------------------------------------------------------
alter table public.entities enable row level security;
alter table public.projects enable row level security;
alter table public.executions enable row level security;
alter table public.alerts enable row level security;
alter table public.profiles enable row level security;
alter table public.project_history enable row level security;

-- helper: entity_id of the calling user (cached per request)
create or replace function public.current_entity_id() returns uuid
language sql stable as $$
  select entity_id from public.profiles where id = auth.uid();
$$;

-- entities: read your own
drop policy if exists "entities self read" on public.entities;
create policy "entities self read" on public.entities
  for select using (id = public.current_entity_id());

-- profiles: each user reads their own profile
drop policy if exists "profiles self read" on public.profiles;
create policy "profiles self read" on public.profiles
  for select using (id = auth.uid());

-- projects: scoped to entity
drop policy if exists "projects scoped read" on public.projects;
create policy "projects scoped read" on public.projects
  for select using (entity_id = public.current_entity_id());

-- executions: scoped via parent project's entity
drop policy if exists "executions scoped read" on public.executions;
create policy "executions scoped read" on public.executions
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = executions.project_id
        and p.entity_id = public.current_entity_id()
    )
  );

-- alerts: scoped to entity
drop policy if exists "alerts scoped read" on public.alerts;
create policy "alerts scoped read" on public.alerts
  for select using (entity_id = public.current_entity_id());

-- project_history: scoped via parent project's entity
drop policy if exists "project_history scoped read" on public.project_history;
create policy "project_history scoped read" on public.project_history
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = project_history.project_id
        and p.entity_id = public.current_entity_id()
    )
  );

-- The service role bypasses RLS — used by cron + seed scripts.
