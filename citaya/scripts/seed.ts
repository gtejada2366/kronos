/**
 * Seed script — creates a demo clinic with services, schedule, and a demo
 * owner user (demo@citaya.pe / demo1234).
 *
 * Usage:
 *   1. Apply supabase/schema.sql in your Supabase project.
 *   2. Configure .env.local with NEXT_PUBLIC_SUPABASE_URL and
 *      SUPABASE_SERVICE_ROLE_KEY.
 *   3. Run: npm run seed
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

loadDotEnv();

const SUPABASE_URL = required("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_ROLE = required("SUPABASE_SERVICE_ROLE_KEY");

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function main() {
  console.log("→ Citaya demo seed");

  const slug = "clinica-demo";
  const { data: existing } = await admin.from("clinics").select("id").eq("slug", slug).maybeSingle();
  let clinicId = existing?.id ?? null;

  if (!clinicId) {
    const { data: created, error } = await admin
      .from("clinics")
      .insert({
        name: "Clínica Dental Sonríe (demo)",
        slug,
        timezone: "America/Lima",
        currency: "PEN",
        signal_amount: 50,
        bot_persona: "asistente cordial y profesional, tutea al paciente",
        onboarded: true
      })
      .select("id")
      .single();
    if (error || !created) throw new Error(`clinic insert: ${error?.message}`);
    clinicId = created.id;
    console.log(`  ✓ Clínica demo creada (${clinicId})`);
  }

  if (!clinicId) throw new Error("clinic id missing");

  // Services
  await admin.from("services").delete().eq("clinic_id", clinicId);
  await admin.from("services").insert([
    {
      clinic_id: clinicId,
      name: "Limpieza dental + profilaxis",
      description: "Destartraje y pulido. 45 minutos.",
      duration_minutes: 45,
      price: 180,
      active: true,
      sort_order: 0
    },
    {
      clinic_id: clinicId,
      name: "Consulta de evaluación ortodóncica",
      description: "Diagnóstico y plan de tratamiento. Sin costo si se inicia tratamiento.",
      duration_minutes: 30,
      price: 100,
      active: true,
      sort_order: 1
    },
    {
      clinic_id: clinicId,
      name: "Endodoncia (canal)",
      description: "Tratamiento de conducto unirradicular o multirradicular.",
      duration_minutes: 90,
      price: 600,
      active: true,
      sort_order: 2
    },
    {
      clinic_id: clinicId,
      name: "Implante dental",
      description: "Colocación de implante (1 pieza). Incluye evaluación previa.",
      duration_minutes: 120,
      price: 2800,
      active: true,
      sort_order: 3
    }
  ]);
  console.log("  ✓ Catálogo de servicios cargado");

  // Schedule: Mon-Fri 9-19, Sat 9-14
  await admin.from("availability_rules").delete().eq("clinic_id", clinicId);
  const rules: Array<{ day_of_week: number; start_minute: number; end_minute: number; clinic_id: string }> = [];
  for (const d of [1, 2, 3, 4, 5]) rules.push({ clinic_id: clinicId, day_of_week: d, start_minute: 9 * 60, end_minute: 19 * 60 });
  rules.push({ clinic_id: clinicId, day_of_week: 6, start_minute: 9 * 60, end_minute: 14 * 60 });
  await admin.from("availability_rules").insert(rules);
  console.log("  ✓ Horario semanal configurado");

  // Demo user
  await ensureDemoUser(clinicId);

  console.log("✔ Seed completado.");
}

async function ensureDemoUser(clinicId: string) {
  const email = "demo@citaya.pe";
  const password = "demo1234";

  const { data: list, error } = await admin.auth.admin.listUsers();
  if (error) throw new Error(`listUsers: ${error.message}`);
  const existing = list.users.find((u) => u.email?.toLowerCase() === email);
  let userId = existing?.id;

  if (!userId) {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: "Demo Owner" }
    });
    if (createErr || !created.user) throw new Error(`createUser: ${createErr?.message}`);
    userId = created.user.id;
    console.log(`  ✓ Usuario demo creado: ${email} / ${password}`);
  } else {
    await admin.auth.admin.updateUserById(userId, { password });
    console.log(`  • Usuario demo ya existía: ${email}`);
  }

  await admin
    .from("profiles")
    .upsert({ id: userId, clinic_id: clinicId, role: "owner", full_name: "Demo Owner" });
}

function required(key: string): string {
  const v = process.env[key];
  if (!v) {
    console.error(`Missing env: ${key}`);
    process.exit(1);
  }
  return v;
}

function loadDotEnv() {
  for (const file of [".env.local", ".env"]) {
    try {
      const raw = readFileSync(resolve(process.cwd(), file), "utf8");
      for (const line of raw.split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const eq = t.indexOf("=");
        if (eq === -1) continue;
        const k = t.slice(0, eq).trim();
        let v = t.slice(eq + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (process.env[k] === undefined) process.env[k] = v;
      }
    } catch {
      // ignored
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
