"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/data";

export type Result = { ok: true; message?: string } | { ok: false; error: string };

interface DayInput {
  day: number;
  enabled: boolean;
  start: string;
  end: string;
}

export async function saveScheduleAction(days: DayInput[]): Promise<Result> {
  const ctx = await getCurrentContext();
  if (!ctx) return { ok: false, error: "No autenticado." };
  const admin = createSupabaseServiceClient();

  const rows: Array<{
    clinic_id: string;
    day_of_week: number;
    start_minute: number;
    end_minute: number;
  }> = [];
  for (const d of days) {
    if (!d.enabled) continue;
    const start = parseTime(d.start);
    const end = parseTime(d.end);
    if (start === null || end === null || end <= start) continue;
    rows.push({
      clinic_id: ctx.clinic.id,
      day_of_week: d.day,
      start_minute: start,
      end_minute: end
    });
  }

  await admin.from("availability_rules").delete().eq("clinic_id", ctx.clinic.id);
  if (rows.length > 0) {
    const { error } = await admin.from("availability_rules").insert(rows);
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath("/availability");
  return { ok: true, message: "Horarios actualizados." };
}

export async function addOverrideAction(input: {
  date: string;
  closed: boolean;
  custom_start?: string;
  custom_end?: string;
  note?: string;
}): Promise<Result> {
  const ctx = await getCurrentContext();
  if (!ctx) return { ok: false, error: "No autenticado." };
  const admin = createSupabaseServiceClient();

  const customStart = input.custom_start ? parseTime(input.custom_start) : null;
  const customEnd = input.custom_end ? parseTime(input.custom_end) : null;

  const { error } = await admin.from("availability_overrides").upsert(
    {
      clinic_id: ctx.clinic.id,
      date: input.date,
      closed: input.closed,
      custom_start_minute: customStart,
      custom_end_minute: customEnd,
      note: input.note ?? null
    },
    { onConflict: "clinic_id,date" }
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath("/availability");
  return { ok: true };
}

export async function deleteOverrideAction(id: string): Promise<Result> {
  const ctx = await getCurrentContext();
  if (!ctx) return { ok: false, error: "No autenticado." };
  const admin = createSupabaseServiceClient();
  const { error } = await admin
    .from("availability_overrides")
    .delete()
    .eq("id", id)
    .eq("clinic_id", ctx.clinic.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/availability");
  return { ok: true };
}

function parseTime(label: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(label.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}
