"use server";

import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { DEFAULT_CURRENCY, DEFAULT_SIGNAL_AMOUNT, DEFAULT_TIMEZONE } from "@/lib/constants";

export type SignupResult =
  | { ok: true; redirect: string }
  | { ok: false; error: string; field?: "email" | "password" | "clinic_name" | "full_name" };

export async function registerClinicAction(formData: FormData): Promise<SignupResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();
  const clinicName = String(formData.get("clinic_name") ?? "").trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { ok: false, error: "Correo inválido.", field: "email" };
  if (password.length < 8)
    return { ok: false, error: "La contraseña debe tener al menos 8 caracteres.", field: "password" };
  if (fullName.length < 2)
    return { ok: false, error: "Nombre demasiado corto.", field: "full_name" };
  if (clinicName.length < 3)
    return { ok: false, error: "Nombre de clínica demasiado corto.", field: "clinic_name" };

  const admin = createSupabaseServiceClient();

  const slug = slugify(clinicName) + "-" + Math.random().toString(36).slice(2, 6);

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName }
  });
  if (createErr || !created.user) {
    return {
      ok: false,
      error: createErr?.message ?? "No se pudo crear la cuenta.",
      field: "email"
    };
  }

  const { data: clinic, error: clinicErr } = await admin
    .from("clinics")
    .insert({
      name: clinicName,
      slug,
      timezone: DEFAULT_TIMEZONE,
      currency: DEFAULT_CURRENCY,
      signal_amount: DEFAULT_SIGNAL_AMOUNT,
      onboarded: false
    })
    .select("id")
    .single();
  if (clinicErr || !clinic) {
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    return { ok: false, error: clinicErr?.message ?? "No se pudo crear la clínica." };
  }

  const { error: profileErr } = await admin
    .from("profiles")
    .insert({ id: created.user.id, clinic_id: clinic.id, role: "owner", full_name: fullName });
  if (profileErr) {
    await admin.from("clinics").delete().eq("id", clinic.id);
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    return { ok: false, error: profileErr.message };
  }

  // Sensible defaults: Mon–Fri 9am–7pm
  const defaultRules: Array<{ day: number; start: number; end: number }> = [
    { day: 1, start: 9 * 60, end: 19 * 60 },
    { day: 2, start: 9 * 60, end: 19 * 60 },
    { day: 3, start: 9 * 60, end: 19 * 60 },
    { day: 4, start: 9 * 60, end: 19 * 60 },
    { day: 5, start: 9 * 60, end: 19 * 60 },
    { day: 6, start: 9 * 60, end: 14 * 60 }
  ];
  await admin.from("availability_rules").insert(
    defaultRules.map((r) => ({
      clinic_id: clinic.id,
      day_of_week: r.day,
      start_minute: r.start,
      end_minute: r.end
    }))
  );

  const supabase = createSupabaseServerClient();
  const { error: signErr } = await supabase.auth.signInWithPassword({ email, password });
  if (signErr) {
    logger.warn("signup_signin_failed", { error: signErr.message });
    return { ok: true, redirect: "/login" };
  }
  return { ok: true, redirect: "/onboarding" };
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}
