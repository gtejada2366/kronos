"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { sendTelegramMessage } from "@/lib/telegram";
import { getCurrentContext } from "@/lib/data";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

export async function updateTelegramChatIdAction(formData: FormData): Promise<ActionResult> {
  const ctx = await getCurrentContext();
  if (!ctx) return { ok: false, error: "No autenticado." };
  if (ctx.profile.role !== "owner") {
    return { ok: false, error: "Solo el owner puede modificar la configuración de la entidad." };
  }

  const raw = String(formData.get("telegram_chat_id") ?? "").trim();
  const chatId = raw.length === 0 ? null : raw;
  if (chatId !== null && !/^-?\d{5,32}$/.test(chatId)) {
    return { ok: false, error: "El chat_id debe ser un entero (puede iniciar con '-' para grupos)." };
  }

  const admin = createSupabaseServiceClient();
  const { error } = await admin
    .from("entities")
    .update({ telegram_chat_id: chatId })
    .eq("id", ctx.entity.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings");
  return { ok: true, message: chatId ? "Chat de Telegram actualizado." : "Chat de Telegram desconectado." };
}

export async function sendTelegramTestAction(): Promise<ActionResult> {
  const ctx = await getCurrentContext();
  if (!ctx) return { ok: false, error: "No autenticado." };
  if (!ctx.entity.telegram_chat_id) {
    return { ok: false, error: "Configura primero un chat_id." };
  }
  const result = await sendTelegramMessage(
    ctx.entity.telegram_chat_id,
    `*ObraScope · prueba de conexión*\nEntidad: ${ctx.entity.nombre}\nFecha: ${new Date().toISOString()}`
  );
  if (!result.ok) return { ok: false, error: result.error ?? "Falló el envío." };
  return { ok: true, message: "Mensaje de prueba enviado." };
}

export async function updatePasswordAction(formData: FormData): Promise<ActionResult> {
  const supabase = createSupabaseServerClient();
  const next = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (next.length < 8) return { ok: false, error: "La contraseña debe tener al menos 8 caracteres." };
  if (next !== confirm) return { ok: false, error: "Las contraseñas no coinciden." };

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "No autenticado." };

  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) return { ok: false, error: error.message };
  return { ok: true, message: "Contraseña actualizada." };
}

export async function updateEntityNameAction(formData: FormData): Promise<ActionResult> {
  const ctx = await getCurrentContext();
  if (!ctx) return { ok: false, error: "No autenticado." };
  if (ctx.profile.role !== "owner") {
    return { ok: false, error: "Solo el owner puede modificar el nombre de la entidad." };
  }
  const nombre = String(formData.get("nombre") ?? "").trim();
  if (nombre.length < 4) return { ok: false, error: "El nombre debe tener al menos 4 caracteres." };

  const admin = createSupabaseServiceClient();
  const { error } = await admin.from("entities").update({ nombre }).eq("id", ctx.entity.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  revalidatePath("/dashboard");
  return { ok: true, message: "Nombre de la entidad actualizado." };
}
