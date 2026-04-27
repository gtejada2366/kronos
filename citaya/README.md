# Citaya

Citaya captures every WhatsApp lead a clinic gets, books the appointment via a
conversational AI agent, and charges the deposit through Yape — all in under
60 seconds. Built as a vertical SaaS for Peruvian dental and aesthetic clinics
in 2026.

## Stack

- **Next.js 14** App Router + TypeScript
- **Supabase** (Auth + Postgres + RLS)
- **Anthropic Claude Haiku 4.5** for the conversational agent (tool use)
- **WhatsApp Cloud API** (Meta Graph API directly, no BSP layer)
- **Google Calendar API** for owner-facing calendar sync
- **Yape Empresas** link generation (with manual fallback)
- **Tailwind CSS** with a clean light theme (teal #0F766E)
- **Vitest** + **Vercel Cron** + structured JSON logging

## What it does end-to-end

1. **Patient writes to the clinic's WhatsApp.** Webhook hits `/api/webhooks/whatsapp`.
2. **Bot parses intent.** Claude is fed a system prompt parameterized per
   clinic (services, pricing, schedule, persona).
3. **Bot calls tools.** `get_available_slots` reads the schedule + appointments
   and returns 3 evenly-spaced suggestions. `book_appointment` reserves the
   slot, generates a Yape payment link with a unique reference, and writes the
   row in `appointments` + `payment_intents`.
4. **Patient pays.** Yape webhook (or manual confirm in dashboard) flips the
   intent to `paid`, the appointment to `confirmed`, and notifies the patient
   via WhatsApp.
5. **Reminders.** A cron at 24h and 2h before the appointment messages the
   patient. A cleanup cron expires unpaid intents after 30 minutes and
   abandons stale leads after 24h.
6. **Owner dashboard.** Real-time counts of leads / bookings / paid revenue.

## Getting started

```bash
cp .env.example .env.local
# fill Supabase + Anthropic + WhatsApp + Yape credentials

npm install

# 1) Apply schema in Supabase SQL editor
#    paste supabase/schema.sql

# 2) Optional demo seed: 1 clinic + 4 services + 1 owner user
npm run seed

# 3) Run
npm run dev
```

Browse to `http://localhost:3000`. Use **demo@citaya.pe / demo1234** to log in.

## Pages

- `/` — landing
- `/signup` — clinic registration (creates clinic + first owner profile)
- `/login` — email + password
- `/onboarding` — 4-step wizard (clinic basics, services, schedule, integrations)
- `/dashboard` — KPI cards (leads, conversion, paid, rescued revenue) + recent
  leads + upcoming appointments
- `/leads` — full inbox with status filter
- `/leads/[id]` — full WhatsApp transcript + linked appointments
- `/appointments` — table with manual "pago recibido", "atendida", "no asistió",
  "cancelar" actions for the owner
- `/services` — CRUD of service catalog
- `/availability` — weekly schedule + per-date overrides (holidays)
- `/settings` — clinic name, signal amount, bot persona, integrations
  (WhatsApp + Yape), password change, "send WhatsApp test" button

## API

| Route | Purpose | Auth |
|---|---|---|
| `POST /api/webhooks/whatsapp` | inbound message dispatcher | Meta verify token (GET) |
| `GET /api/webhooks/whatsapp` | webhook verification handshake | `WHATSAPP_VERIFY_TOKEN` |
| `POST /api/webhooks/yape` | payment confirmation | `YAPE_WEBHOOK_SECRET` or `X-Citaya-Secret: ${CRON_SECRET}` |
| `GET /api/cron/cleanup` | expire unpaid intents + slots | `Bearer ${CRON_SECRET}` |
| `GET /api/cron/reminders` | 24h + 2h appointment reminders | `Bearer ${CRON_SECRET}` |
| `GET /api/google/oauth` | starts Google Calendar OAuth | logged-in user |
| `GET /api/google/callback` | OAuth code exchange | logged-in user |

Crons are declared in `vercel.json`:

```json
{ "path": "/api/cron/cleanup",   "schedule": "*/5 * * * *" }
{ "path": "/api/cron/reminders", "schedule": "0 * * * *" }
```

## Multi-tenancy

Each `auth.users` row maps 1:1 to a `profiles` row pinning the user to a
single `clinics.id`. RLS scopes every operational table by
`clinic_id = current_clinic_id()` (a `STABLE` SQL helper). The service role
bypasses RLS — used only by webhooks, cron and the seed script.

## Bot architecture

```
src/lib/anthropic/
  client.ts     # Anthropic SDK singleton
  prompts.ts    # buildSystemPrompt({clinic, services, patientName})
  tools.ts      # tool schemas + types
  bot.ts        # runBotTurn() orchestrator with tool-use loop
```

Loop: load conversation history → ask Claude → if it returns tool_use, run
the tool against Postgres / availability engine, append result, ask again.
Max 4 rounds (hard ceiling against runaway loops). When the model emits
`handoff_to_human` (or no text after 4 rounds) the conversation is flagged
for the clinic owner.

## Availability engine

`src/lib/calendar/availability.ts` computes free slots given:

- weekly recurring rules (`availability_rules`)
- per-date overrides (`availability_overrides`)
- existing appointments (any non-terminal status blocks the slot)

Honors a 2-hour minimum lead time, a 60-day maximum horizon, and a 10-minute
buffer between consecutive appointments. Tested against tz boundaries
(Lima UTC-5) — see `availability.test.ts`.

## Pricing model (the commercial bet)

The MVP supports two pricing modes. Default for founding customers:

> **S/. 0 fixed + 3% of revenue rescued (signal × completed appointments)**

That makes the SaaS uncancellable: the clinic only pays when Citaya brings in
revenue. Once you have 30 paying clinics, switch to `S/. 200 + 5%`.

## Quality gates

```bash
npm run lint       # ESLint via next lint
npm run typecheck  # tsc --noEmit
npm test           # vitest run (availability, format, yape, whatsapp, cron-auth)
npm run build      # next build
```

## What's intentionally out of MVP

- SMS / email channels — WhatsApp only (focus)
- Multi-staff scheduling per service — single resource pool for v1
- Patient-facing portal — patients live in WhatsApp
- Clinical notes / SOAP — not the wedge; might come in v3
- Payment provider beyond Yape — Plin/cards in v2
- Multi-language — Spanish-only; one country at a time

## Layout

```
citaya/
  package.json · tsconfig.json · vercel.json · vitest.config.ts
  public/{favicon.svg,site.webmanifest}
  supabase/schema.sql
  scripts/seed.ts
  src/
    middleware.ts
    app/
      page.tsx · layout.tsx · globals.css
      login/{page,login-form}.tsx
      signup/{page,signup-form,actions}.ts(x)
      onboarding/{page,onboarding-wizard,actions}.ts(x)
      (app)/
        layout.tsx
        dashboard/page.tsx
        leads/{page.tsx,[id]/page.tsx}
        appointments/{page,appointment-row,actions}.ts(x)
        services/{page,services-editor,actions}.ts(x)
        availability/{page,availability-form,actions}.ts(x)
        settings/{page,settings-forms,actions}.ts(x)
      api/
        webhooks/{whatsapp,yape}/route.ts
        cron/{cleanup,reminders}/route.ts
        google/{oauth,callback}/route.ts
    components/{KpiCard,LogoutButton,Sidebar,Topbar,StatusBadge,EmptyState}.tsx
    lib/
      supabase/{client,server}.ts
      anthropic/{client,prompts,tools,bot}.ts
      calendar/{availability,google}.ts
      whatsapp/client.ts
      payments/yape.ts
      constants.ts · types.ts · format.ts · data.ts
      cron-auth.ts · rate-limit.ts · logger.ts
      *.test.ts
```
