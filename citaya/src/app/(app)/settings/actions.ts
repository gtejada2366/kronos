"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/data";
import { sendWhatsAppText } from "@/lib/whatsapp/client";

export type Result = { ok: true; message?: string } | { ok: false; error: string };

export async function updateClinicAction(formData: FormData): Promise<Result> {
  const ctx = await getCurrentContext();
  if (!ctx) return { ok: false, error: "No autenticado." };
  if (ctx.profile.role !== "owner") return { ok: false, error: "Solo el owner puede modificar la clínica." };
  const admin = createSupabaseServiceClient();

  const name = String(formData.get("name") ?? "").trim();
  const signal = Number(formData.get("signal_amount") ?? 0);
  const persona = String(formData.get("bot_persona") ?? "").trim();
  const extra = String(formData.get("bot_extra_instructions") ?? "").trim();

  if (name.length < 3) return { ok: false, error: "Nombre demasiado corto." };
  if (!Number.isFinite(signal) || signal < 0) return { ok: false, error: "Señal inválida." };

  const { error } = await admin
    .from("clinics")
    .update({
      name,
      signal_amount: Math.round(signal),
      bot_persona: persona || null,
      bot_extra_instructions: extra || null
    })
    .eq("id", ctx.clinic.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  return { ok: true, message: "Clínica actualizada." };
}

export async function updateIntegrationsAction(formData: FormData): Promise<Result> {
  const ctx = await getCurrentContext();
  if (!ctx) return { ok: false, error: "No autenticado." };
  if (ctx.profile.role !== "owner") return { ok: false, error: "Solo el owner puede actualizar integraciones." };
  const admin = createSupabaseServiceClient();

  const yapeHandle = String(formData.get("yape_handle") ?? "").trim();
  const phoneId = String(formData.get("whatsapp_phone_number_id") ?? "").trim();
  const bizId = String(formData.get("whatsapp_business_account_id") ?? "").trim();
  const token = String(formData.get("whatsapp_access_token") ?? "").trim();

  const update: Record<string, string | null> = {
    yape_handle: yapeHandle || null,
    whatsapp_phone_number_id: phoneId || null,
    whatsapp_business_account_id: bizId || null
  };
  if (token) update.whatsapp_access_token = token;

  const { error } = await admin.from("clinics").update(update).eq("id", ctx.clinic.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings");
  return { ok: true, message: "Integraciones actualizadas." };
}

export async function sendWhatsAppTestAction(toPhone: string): Promise<Result> {
  const ctx = await getCurrentContext();
  if (!ctx) return { ok: false, error: "No autenticado." };
  if (!ctx.clinic.whatsapp_phone_number_id || !ctx.clinic.whatsapp_access_token)
    return { ok: false, error: "WhatsApp no está configurado." };
  if (!toPhone || !/^\+?\d{8,15}$/.test(toPhone.replace(/\s/g, "")))
    return { ok: false, error: "Teléfono inválido. Formato internacional: 51999888777" };
  const r = await sendWhatsAppText(
    {
      phoneNumberId: ctx.clinic.whatsapp_phone_number_id,
      accessToken: ctx.clinic.whatsapp_access_token
    },
    toPhone,
    `Hola — esto es una prueba de conexión de Citaya con la clínica ${ctx.clinic.name}. Si recibiste este mensaje, todo funciona ✅`
  );
  if (!r.ok) return { ok: false, error: r.error ?? "Error enviando." };
  return { ok: true, message: "Mensaje de prueba enviado." };
}

export async function updatePasswordAction(formData: FormData): Promise<Result> {
  const supabase = createSupabaseServerClient();
  const next = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (next.length < 8) return { ok: false, error: "Mínimo 8 caracteres." };
  if (next !== confirm) return { ok: false, error: "Las contraseñas no coinciden." };
  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) return { ok: false, error: error.message };
  return { ok: true, message: "Contraseña actualizada." };
}
