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
- Vitest + GitHub Actions CI

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
- `/signup` — create a new entity + first `owner` user (open registration,
  rejects duplicate UBIGEO)
- `/dashboard` — KPI cards (proyectos, PIM, devengado, avance promedio) + the
  full sortable, filterable, paginable, CSV-exportable projects table with
  semáforo column. Filters: search, estado, semáforo, PIM mínimo, fecha de
  cierre.
- `/projects/[id]` — project detail with multi-year monthly execution area
  chart (devengado vs meta line), contractual summary, alert history, and
  audit log of every field change (driven by a Postgres trigger).
- `/settings` — entity name, Telegram chat_id (with test-message button) and
  password change. Owner-only fields are gated server-side.

## API

- `GET /api/cron/sync` — daily, fetches MEF Consulta Amigable + Invierte.pe per
  entity ubigeo (when `MEF_LIVE=1`), merges by codigo, and falls back to a
  deterministic `mockProgress()` per project when no live snapshot is
  available. Writes a monthly snapshot to `executions`.
- `GET /api/cron/alerts` — weekly Mondays, sends each entity's Telegram chat a
  Markdown digest of projects in zona crítica, persists rows in `alerts`.

Both routes are gated by:

1. Per-IP token bucket (6/h on `sync`, 4/h on `alerts`).
2. `Authorization: Bearer <CRON_SECRET>` (Vercel Cron passes this
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
exactly one `entities.id`. RLS policies on `entities`, `projects`,
`executions`, `alerts` and `project_history` enforce
`entity_id = current_entity_id()` (a `STABLE` SQL helper that resolves the
caller's entity from `profiles`). The service role bypasses RLS — only the
cron routes, the seed script, and server actions for owner-level mutations use
it.

## Audit log

A Postgres trigger (`project_changes_audit`) writes one row to
`project_history` per changed field on every `UPDATE` of `projects`. The
project detail page surfaces the most recent 25 entries with old/new values
formatted by field type.

## Quality gates

```
npm run lint       # ESLint via next lint
npm run typecheck  # tsc --noEmit
npm test           # vitest run
npm run build      # next build
```

Each one is a green gate in `.github/workflows/obrascope-ci.yml`.

Tests cover the pure logic: semáforo classification, percentage formatters,
mock progression invariants, cron auth, and rate limiter.

## Layout

```
src/
  app/
    api/cron/{sync,alerts}/route.ts
    dashboard/{page,projects-table}.tsx
    login/{page,login-form}.tsx
    projects/[id]/{page,execution-panel,execution-chart}.tsx
    settings/{page,settings-forms,actions}.ts
    signup/{page,signup-form,actions}.ts
    layout.tsx · page.tsx · globals.css
  components/{KpiCard,LogoutButton,SemaforoBadge,Topbar}.tsx
  lib/
    supabase/{client,server}.ts
    cron-auth.ts · data.ts · format.ts · logger.ts · mef.ts
    rate-limit.ts · semaforo.ts · telegram.ts · types.ts
    *.test.ts
  middleware.ts
public/{favicon.svg,site.webmanifest}
supabase/schema.sql
scripts/seed.ts
vitest.config.ts · vercel.json
```

## License model

Sold per entity as an annual license **below the 8 UIT threshold (~ S/. 41,600)**
to avoid public tender requirements (Ley de Contrataciones del Estado, Art. 5).
