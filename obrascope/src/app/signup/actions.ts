"use server";

import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import type { EntityTipo } from "@/lib/types";

export type SignupResult =
  | { ok: true; redirect: string }
  | { ok: false; error: string; field?: "email" | "password" | "nombre" | "ubigeo" };

const TIPOS: EntityTipo[] = ["MUNICIPALIDAD_PROVINCIAL", "MUNICIPALIDAD_DISTRITAL", "GOBIERNO_REGIONAL"];

export async function registerEntityAction(formData: FormData): Promise<SignupResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const nombre = String(formData.get("nombre") ?? "").trim();
  const ubigeo = String(formData.get("ubigeo") ?? "").trim();
  const tipo = String(formData.get("tipo") ?? "") as EntityTipo;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { ok: false, error: "Correo inválido.", field: "email" };
  if (password.length < 8)
    return { ok: false, error: "La contraseña debe tener al menos 8 caracteres.", field: "password" };
  if (nombre.length < 4) return { ok: false, error: "Nombre demasiado corto.", field: "nombre" };
  if (!/^\d{6}$/.test(ubigeo)) return { ok: false, error: "UBIGEO debe ser de 6 dígitos.", field: "ubigeo" };
  if (!TIPOS.includes(tipo)) return { ok: false, error: "Tipo de entidad inválido." };

  const admin = createSupabaseServiceClient();

  const { data: existing } = await admin
    .from("entities")
    .select("id")
    .eq("ubigeo", ubigeo)
    .maybeSingle();
  if (existing?.id) {
    return {
      ok: false,
      error: "Ya existe una entidad registrada con ese UBIGEO. Pide a tu owner que te invite.",
      field: "ubigeo"
    };
  }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });
  if (createErr || !created.user) {
    return { ok: false, error: createErr?.message ?? "No se pudo crear la cuenta.", field: "email" };
  }

  const { data: ent, error: entErr } = await admin
    .from("entities")
    .insert({ nombre, ubigeo, tipo, telegram_chat_id: null })
    .select("id")
    .single();
  if (entErr || !ent) {
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    return { ok: false, error: entErr?.message ?? "No se pudo crear la entidad." };
  }

  const { error: profileErr } = await admin
    .from("profiles")
    .insert({ id: created.user.id, entity_id: ent.id, role: "owner" });
  if (profileErr) {
    await admin.from("entities").delete().eq("id", ent.id);
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    return { ok: false, error: profileErr.message };
  }

  const supabase = createSupabaseServerClient();
  const { error: signErr } = await supabase.auth.signInWithPassword({ email, password });
  if (signErr) {
    return { ok: true, redirect: "/login" };
  }
  return { ok: true, redirect: "/dashboard" };
}
