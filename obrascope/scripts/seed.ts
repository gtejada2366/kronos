/**
 * Seed script — populates 3 demo entities, 8 realistic projects for the
 * primary entity (Municipalidad Provincial de Cusco), monthly executions for
 * the current year, and creates the demo Auth user (demo@obrascope.pe /
 * demo1234) wired to that entity via a profile row.
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

interface ProjectSeed {
  codigo: string;
  nombre: string;
  pia: number;
  pim: number;
  pct_devengado: number; // 0..1 — used to derive devengado against PIM
  avance_fisico: number; // 0..100
  estado: "EN_EJECUCION" | "PARALIZADO" | "CONCLUIDO" | "EN_LIQUIDACION";
  fecha_inicio: string;
  fecha_fin: string;
}

const ENTITIES = [
  {
    nombre: "Municipalidad Provincial de Cusco",
    ubigeo: "080101",
    tipo: "MUNICIPALIDAD_PROVINCIAL" as const,
    telegram_chat_id: null
  },
  {
    nombre: "Municipalidad Distrital de Wanchaq",
    ubigeo: "080106",
    tipo: "MUNICIPALIDAD_DISTRITAL" as const,
    telegram_chat_id: null
  },
  {
    nombre: "Gobierno Regional de Cusco",
    ubigeo: "080000",
    tipo: "GOBIERNO_REGIONAL" as const,
    telegram_chat_id: null
  }
];

const CUSCO_PROJECTS: ProjectSeed[] = [
  {
    codigo: "2467821",
    nombre: "Mejoramiento de la Av. La Cultura entre Av. Tullumayo y Av. Garcilaso, Cusco",
    pia: 8_500_000,
    pim: 12_400_000,
    pct_devengado: 0.62,
    avance_fisico: 58,
    estado: "EN_EJECUCION",
    fecha_inicio: "2024-03-15",
    fecha_fin: "2026-09-30"
  },
  {
    codigo: "2512987",
    nombre: "Construcción del mercado modelo de San Pedro — etapa II",
    pia: 4_200_000,
    pim: 6_100_000,
    pct_devengado: 0.81,
    avance_fisico: 78,
    estado: "EN_EJECUCION",
    fecha_inicio: "2024-01-10",
    fecha_fin: "2026-06-30"
  },
  {
    codigo: "2598103",
    nombre: "Mejoramiento del servicio educativo en la I.E. 50001 Diego Quispe Tito",
    pia: 2_800_000,
    pim: 3_950_000,
    pct_devengado: 0.18,
    avance_fisico: 22,
    estado: "PARALIZADO",
    fecha_inicio: "2023-08-01",
    fecha_fin: "2026-12-15"
  },
  {
    codigo: "2641205",
    nombre: "Ampliación del sistema de agua potable en el distrito de Santiago",
    pia: 11_200_000,
    pim: 14_800_000,
    pct_devengado: 0.34,
    avance_fisico: 41,
    estado: "EN_EJECUCION",
    fecha_inicio: "2024-05-20",
    fecha_fin: "2027-03-31"
  },
  {
    codigo: "2705614",
    nombre: "Creación de áreas verdes y arborización en el corredor turístico Saqsayhuamán",
    pia: 1_350_000,
    pim: 1_620_000,
    pct_devengado: 0.91,
    avance_fisico: 88,
    estado: "EN_EJECUCION",
    fecha_inicio: "2025-01-08",
    fecha_fin: "2026-07-30"
  },
  {
    codigo: "2768420",
    nombre: "Rehabilitación del puente Almudena sobre el río Saphy",
    pia: 5_400_000,
    pim: 7_900_000,
    pct_devengado: 0.05,
    avance_fisico: 8,
    estado: "EN_EJECUCION",
    fecha_inicio: "2025-02-12",
    fecha_fin: "2027-01-15"
  },
  {
    codigo: "2814503",
    nombre: "Mejoramiento del servicio de limpieza pública — adquisición de compactadoras",
    pia: 3_100_000,
    pim: 3_100_000,
    pct_devengado: 0.99,
    avance_fisico: 100,
    estado: "CONCLUIDO",
    fecha_inicio: "2023-11-04",
    fecha_fin: "2025-03-20"
  },
  {
    codigo: "2890217",
    nombre: "Construcción del centro cívico vecinal en el barrio de San Blas",
    pia: 6_700_000,
    pim: 9_300_000,
    pct_devengado: 0.46,
    avance_fisico: 49,
    estado: "EN_EJECUCION",
    fecha_inicio: "2024-09-01",
    fecha_fin: "2026-11-30"
  }
];

async function main() {
  console.log("→ Aplicando seed de ObraScope…");

  const entityIds: Record<string, string> = {};

  for (const ent of ENTITIES) {
    const { data: existing } = await admin
      .from("entities")
      .select("id")
      .eq("ubigeo", ent.ubigeo)
      .maybeSingle();
    if (existing?.id) {
      entityIds[ent.ubigeo] = existing.id;
      console.log(`  • ${ent.nombre} ya existía (${existing.id})`);
      continue;
    }
    const { data: inserted, error } = await admin
      .from("entities")
      .insert(ent)
      .select("id")
      .single();
    if (error || !inserted) throw new Error(`Insert entity ${ent.nombre}: ${error?.message}`);
    entityIds[ent.ubigeo] = inserted.id;
    console.log(`  ✓ Entidad creada: ${ent.nombre}`);
  }

  const cuscoEntityId = entityIds["080101"];

  for (const seed of CUSCO_PROJECTS) {
    const devengado = Math.round(seed.pim * seed.pct_devengado);
    const projectRow = {
      entity_id: cuscoEntityId,
      codigo: seed.codigo,
      nombre: seed.nombre,
      pia: seed.pia,
      pim: seed.pim,
      devengado,
      avance_fisico: seed.avance_fisico,
      estado: seed.estado,
      fecha_inicio: seed.fecha_inicio,
      fecha_fin: seed.fecha_fin,
      updated_at: new Date().toISOString()
    };
    const { data: project, error } = await admin
      .from("projects")
      .upsert(projectRow, { onConflict: "entity_id,codigo" })
      .select("id")
      .single();
    if (error || !project) throw new Error(`Upsert project ${seed.codigo}: ${error?.message}`);

    const anio = new Date().getFullYear();
    const mesActual = new Date().getMonth() + 1;
    const monthly: Array<{
      project_id: string;
      mes: number;
      anio: number;
      devengado: number;
      pim: number;
    }> = [];
    for (let m = 1; m <= mesActual; m++) {
      const ramp = m / mesActual;
      monthly.push({
        project_id: project.id,
        mes: m,
        anio,
        devengado: Math.round(devengado * ramp),
        pim: seed.pim
      });
    }
    if (monthly.length > 0) {
      const { error: execErr } = await admin
        .from("executions")
        .upsert(monthly, { onConflict: "project_id,anio,mes" });
      if (execErr) throw new Error(`Upsert executions ${seed.codigo}: ${execErr.message}`);
    }
    console.log(`  ✓ Proyecto sembrado: ${seed.codigo}`);
  }

  await ensureDemoUser(cuscoEntityId);

  console.log("✔ Seed completado.");
}

async function ensureDemoUser(entityId: string) {
  const email = "demo@obrascope.pe";
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
      user_metadata: { display_name: "Demo Cusco" }
    });
    if (createErr || !created.user) throw new Error(`createUser: ${createErr?.message}`);
    userId = created.user.id;
    console.log(`  ✓ Usuario demo creado: ${email}`);
  } else {
    await admin.auth.admin.updateUserById(userId, { password });
    console.log(`  • Usuario demo ya existía: ${email}`);
  }

  const { error: profileErr } = await admin
    .from("profiles")
    .upsert({ id: userId, entity_id: entityId, role: "owner" });
  if (profileErr) throw new Error(`profile upsert: ${profileErr.message}`);
}

function required(key: string): string {
  const v = process.env[key];
  if (!v) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
  return v;
}

function loadDotEnv() {
  const candidates = [".env.local", ".env"];
  for (const file of candidates) {
    try {
      const raw = readFileSync(resolve(process.cwd(), file), "utf8");
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = value;
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
