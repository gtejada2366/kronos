"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/data";

export type Result = { ok: true; message?: string } | { ok: false; error: string };

interface ServiceInput {
  id?: string;
  name: string;
  description: string;
  duration_minutes: number;
  price: number;
  active: boolean;
}

export async function saveServicesAction(services: ServiceInput[]): Promise<Result> {
  const ctx = await getCurrentContext();
  if (!ctx) return { ok: false, error: "No autenticado." };
  const admin = createSupabaseServiceClient();

  const cleaned = services
    .filter((s) => s.name?.trim())
    .map((s, idx) => ({
      id: s.id,
      clinic_id: ctx.clinic.id,
      name: s.name.trim().slice(0, 120),
      description: s.description?.trim() || null,
      duration_minutes: Math.max(5, Math.min(480, Math.round(s.duration_minutes || 30))),
      price: Math.max(0, Number(s.price ?? 0)),
      active: s.active !== false,
      sort_order: idx
    }));

  if (cleaned.length === 0) return { ok: false, error: "Agrega al menos un servicio." };

  await admin.from("services").delete().eq("clinic_id", ctx.clinic.id);
  const { error } = await admin.from("services").insert(
    cleaned.map(({ id: _id, ...rest }) => rest)
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/services");
  return { ok: true, message: "Servicios actualizados." };
}
