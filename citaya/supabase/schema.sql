-- Citaya schema (Supabase / Postgres)
-- Apply via the Supabase SQL editor or `supabase db push`.

create extension if not exists "pgcrypto";

-- =============================================================
-- ENUMS
-- =============================================================
create type appointment_status as enum (
  'pending_payment',
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
  'expired'
);

create type lead_status as enum (
  'new',
  'in_progress',
  'booked',
  'paid',
  'abandoned'
);

create type profile_role as enum ('owner', 'staff');

create type message_direction as enum ('inbound', 'outbound');

create type message_role as enum ('patient', 'bot', 'human', 'system');

create type payment_status as enum ('pending', 'paid', 'expired', 'cancelled', 'refunded');

create type payment_provider as enum ('yape', 'manual');

create type conversation_status as enum ('active', 'closed');

-- =============================================================
-- CLINICS
-- =============================================================
create table if not exists public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  timezone text not null default 'America/Lima',
  currency text not null default 'PEN',
  signal_amount integer not null default 50,
  whatsapp_phone_number_id text,
  whatsapp_business_account_id text,
  whatsapp_access_token text,
  yape_handle text,
  google_calendar_id text,
  google_refresh_token text,
  bot_persona text,
  bot_extra_instructions text,
  onboarded boolean not null default false,
  created_at timestamptz not null default now()
);

-- =============================================================
-- PROFILES (1:1 with auth.users, scoped to one clinic)
-- =============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  role profile_role not null default 'owner',
  full_name text,
  created_at timestamptz not null default now()
);

create index if not exists profiles_clinic_idx on public.profiles (clinic_id);

-- =============================================================
-- SERVICES (catalog)
-- =============================================================
create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null,
  description text,
  duration_minutes integer not null check (duration_minutes between 5 and 480),
  price numeric(10,2) not null check (price >= 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists services_clinic_idx on public.services (clinic_id, active, sort_order);

-- =============================================================
-- AVAILABILITY (recurring weekly + per-date overrides)
-- =============================================================
create table if not exists public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_minute integer not null check (start_minute between 0 and 1439),
  end_minute integer not null check (end_minute between 1 and 1440),
  check (end_minute > start_minute)
);

create index if not exists availability_rules_clinic_idx on public.availability_rules (clinic_id, day_of_week);

create table if not exists public.availability_overrides (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  date date not null,
  closed boolean not null default false,
  custom_start_minute integer,
  custom_end_minute integer,
  note text,
  unique (clinic_id, date)
);

-- =============================================================
-- LEADS / CONVERSATIONS / MESSAGES
-- =============================================================
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  whatsapp_phone text not null,
  name text,
  source text,
  status lead_status not null default 'new',
  first_seen_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  notes text,
  unique (clinic_id, whatsapp_phone)
);

create index if not exists leads_clinic_status_idx on public.leads (clinic_id, status);
create index if not exists leads_clinic_recent_idx on public.leads (clinic_id, last_message_at desc);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  status conversation_status not null default 'active',
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create index if not exists conversations_lead_idx on public.conversations (lead_id, started_at desc);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  direction message_direction not null,
  role message_role not null,
  content text not null,
  whatsapp_message_id text,
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_idx on public.messages (conversation_id, created_at);

-- =============================================================
-- APPOINTMENTS
-- =============================================================
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete restrict,
  service_id uuid references public.services(id) on delete set null,
  scheduled_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes > 0),
  status appointment_status not null default 'pending_payment',
  signal_amount numeric(10,2) not null default 0,
  signal_paid_at timestamptz,
  total_price numeric(10,2) not null default 0,
  payment_link text,
  payment_reference text,
  google_event_id text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists appointments_clinic_scheduled_idx on public.appointments (clinic_id, scheduled_at);
create index if not exists appointments_clinic_status_idx on public.appointments (clinic_id, status);
create index if not exists appointments_lead_idx on public.appointments (lead_id);

-- =============================================================
-- PAYMENT INTENTS
-- =============================================================
create table if not exists public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  amount numeric(10,2) not null,
  currency text not null default 'PEN',
  provider payment_provider not null default 'yape',
  link text not null,
  reference text,
  status payment_status not null default 'pending',
  paid_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists payment_intents_appointment_idx on public.payment_intents (appointment_id);
create index if not exists payment_intents_status_idx on public.payment_intents (status, expires_at);

-- =============================================================
-- WEBHOOK EVENTS (raw audit log for inbound webhooks)
-- =============================================================
create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_id text,
  payload jsonb not null,
  processed boolean not null default false,
  error text,
  received_at timestamptz not null default now()
);

create index if not exists webhook_events_source_idx on public.webhook_events (source, received_at desc);

-- =============================================================
-- ROW LEVEL SECURITY
-- =============================================================
alter table public.clinics enable row level security;
alter table public.profiles enable row level security;
alter table public.services enable row level security;
alter table public.availability_rules enable row level security;
alter table public.availability_overrides enable row level security;
alter table public.leads enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.appointments enable row level security;
alter table public.payment_intents enable row level security;

create or replace function public.current_clinic_id() returns uuid
language sql stable as $$
  select clinic_id from public.profiles where id = auth.uid();
$$;

drop policy if exists "clinic self read" on public.clinics;
create policy "clinic self read" on public.clinics
  for select using (id = public.current_clinic_id());

drop policy if exists "clinic self update" on public.clinics;
create policy "clinic self update" on public.clinics
  for update using (id = public.current_clinic_id())
  with check (id = public.current_clinic_id());

drop policy if exists "profiles self read" on public.profiles;
create policy "profiles self read" on public.profiles
  for select using (id = auth.uid());

-- helper macro: scoped read+write per clinic_id column
do $$ begin
  perform 1;
exception when others then null;
end $$;

drop policy if exists "services scoped" on public.services;
create policy "services scoped" on public.services
  for all using (clinic_id = public.current_clinic_id())
  with check (clinic_id = public.current_clinic_id());

drop policy if exists "availability_rules scoped" on public.availability_rules;
create policy "availability_rules scoped" on public.availability_rules
  for all using (clinic_id = public.current_clinic_id())
  with check (clinic_id = public.current_clinic_id());

drop policy if exists "availability_overrides scoped" on public.availability_overrides;
create policy "availability_overrides scoped" on public.availability_overrides
  for all using (clinic_id = public.current_clinic_id())
  with check (clinic_id = public.current_clinic_id());

drop policy if exists "leads scoped" on public.leads;
create policy "leads scoped" on public.leads
  for all using (clinic_id = public.current_clinic_id())
  with check (clinic_id = public.current_clinic_id());

drop policy if exists "conversations scoped" on public.conversations;
create policy "conversations scoped" on public.conversations
  for all using (clinic_id = public.current_clinic_id())
  with check (clinic_id = public.current_clinic_id());

drop policy if exists "messages scoped" on public.messages;
create policy "messages scoped" on public.messages
  for all using (clinic_id = public.current_clinic_id())
  with check (clinic_id = public.current_clinic_id());

drop policy if exists "appointments scoped" on public.appointments;
create policy "appointments scoped" on public.appointments
  for all using (clinic_id = public.current_clinic_id())
  with check (clinic_id = public.current_clinic_id());

drop policy if exists "payment_intents scoped" on public.payment_intents;
create policy "payment_intents scoped" on public.payment_intents
  for all using (clinic_id = public.current_clinic_id())
  with check (clinic_id = public.current_clinic_id());

-- =============================================================
-- TRIGGERS
-- =============================================================
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists appointments_touch_updated on public.appointments;
create trigger appointments_touch_updated
  before update on public.appointments
  for each row execute function public.touch_updated_at();

-- The service role bypasses RLS — used by webhooks, cron and seed scripts.
