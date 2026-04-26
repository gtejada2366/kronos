# ObraScope

Multi-tenant SaaS dashboard for Peruvian municipalities and regional governments
to monitor execution of their public works portfolio in real time.

## Stack

- Next.js 14 (App Router) + TypeScript
- Supabase (Auth + Postgres + RLS)
- Tailwind CSS · IBM Plex Sans / Mono · dark industrial theme
- Recharts for the monthly execution chart
- Vercel (hosting + cron jobs)
- Telegram Bot API for the weekly digest

## Getting started

```bash
cp .env.example .env.local
# fill NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, TELEGRAM_BOT_TOKEN

npm install

# 1) Apply schema in your Supabase project
#    SQL editor → paste supabase/schema.sql

# 2) Seed: 3 demo entities + 8 projects on Cusco + demo user
npm run seed

# 3) Run the app
npm run dev
```

Then open http://localhost:3000 and click **Ver demo** (or sign in with
`demo@obrascope.pe` / `demo1234`).

## Pages

- `/` — landing
- `/login` — email + password, plus "Entrar como demo" button
- `/dashboard` — KPI cards (proyectos, PIM, devengado, avance promedio) + the
  full sortable, filterable, CSV-exportable projects table with semáforo column
- `/projects/[id]` — project detail with monthly execution area chart
  (devengado vs meta line), contractual summary and alert history

## API

- `GET /api/cron/sync` — daily, refreshes project execution from MEF (mock
  generator while `MEF_LIVE=1` is unset) and writes a monthly snapshot.
- `GET /api/cron/alerts` — weekly Monday, sends each entity's Telegram chat a
  Markdown digest of projects in zona crítica.

Both routes require `Authorization: Bearer <CRON_SECRET>` (Vercel Cron does this
automatically) or `?secret=<CRON_SECRET>` for manual triggers.

The cron schedule is declared in `vercel.json`.

## Semáforo

```
% año fiscal transcurrido = día del año / días del año × 100
% esperado                = % año transcurrido × 0.9
verde     ⇢ % devengado ≥ % esperado
amarillo  ⇢ % devengado ≥ % esperado × 0.6
rojo      ⇢ % devengado <  % esperado × 0.6
```

See `src/lib/semaforo.ts`.

## Multi-tenancy

Each `auth.users` row is mapped 1:1 to a `profiles` row that pins the user to
exactly one `entities.id`. RLS policies on `entities`, `projects`, `executions`
and `alerts` enforce `entity_id = current_entity_id()` (a `STABLE` SQL helper
that resolves the caller's entity from `profiles`). The service role bypasses
RLS — only the cron routes and the seed script use it.

## Layout

```
src/
  app/
    api/cron/{sync,alerts}/route.ts
    dashboard/{page,projects-table}.tsx
    login/{page,login-form}.tsx
    projects/[id]/{page,execution-chart}.tsx
    layout.tsx · page.tsx · globals.css
  components/{KpiCard,LogoutButton,SemaforoBadge,Topbar}.tsx
  lib/
    supabase/{client,server}.ts
    cron-auth.ts · data.ts · format.ts · mef.ts · semaforo.ts · telegram.ts · types.ts
  middleware.ts
supabase/schema.sql
scripts/seed.ts
vercel.json
```

## License model

Sold per entity as an annual license **below the 8 UIT threshold (~ S/. 41,600)**
to avoid public tender requirements (Ley de Contrataciones del Estado, Art. 5).
