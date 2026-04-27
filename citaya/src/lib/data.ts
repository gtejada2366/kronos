import { createSupabaseServerClient } from "./supabase/server";
import type {
  Appointment,
  AvailabilityOverride,
  AvailabilityRule,
  Clinic,
  Lead,
  Message,
  PaymentIntent,
  Profile,
  Service
} from "./types";

export async function getCurrentContext(): Promise<{
  user: { id: string; email: string | null };
  profile: Profile;
  clinic: Clinic;
} | null> {
  const supabase = createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", auth.user.id)
    .single<Profile>();
  if (!profile) return null;

  const { data: clinic } = await supabase
    .from("clinics")
    .select("*")
    .eq("id", profile.clinic_id)
    .single<Clinic>();
  if (!clinic) return null;

  return {
    user: { id: auth.user.id, email: auth.user.email ?? null },
    profile,
    clinic
  };
}

export async function getServices(clinicId: string): Promise<Service[]> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("services")
    .select("*")
    .eq("clinic_id", clinicId)
    .order("sort_order", { ascending: true });
  return (data ?? []) as Service[];
}

export async function getAvailabilityRules(clinicId: string): Promise<AvailabilityRule[]> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("availability_rules")
    .select("*")
    .eq("clinic_id", clinicId)
    .order("day_of_week", { ascending: true })
    .order("start_minute", { ascending: true });
  return (data ?? []) as AvailabilityRule[];
}

export async function getAvailabilityOverrides(clinicId: string): Promise<AvailabilityOverride[]> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("availability_overrides")
    .select("*")
    .eq("clinic_id", clinicId)
    .order("date", { ascending: true });
  return (data ?? []) as AvailabilityOverride[];
}

export async function getLeads(clinicId: string, limit = 50): Promise<Lead[]> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("leads")
    .select("*")
    .eq("clinic_id", clinicId)
    .order("last_message_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as Lead[];
}

export async function getLead(leadId: string): Promise<Lead | null> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase.from("leads").select("*").eq("id", leadId).maybeSingle<Lead>();
  return data;
}

export async function getMessagesForLead(leadId: string): Promise<Message[]> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("messages")
    .select("*, conversations!inner(lead_id)")
    .eq("conversations.lead_id", leadId)
    .order("created_at", { ascending: true });
  return (data ?? []) as unknown as Message[];
}

export async function getAppointments(clinicId: string, limit = 100): Promise<Appointment[]> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("appointments")
    .select("*")
    .eq("clinic_id", clinicId)
    .order("scheduled_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as Appointment[];
}

export async function getAppointmentsByLead(leadId: string): Promise<Appointment[]> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("appointments")
    .select("*")
    .eq("lead_id", leadId)
    .order("scheduled_at", { ascending: false });
  return (data ?? []) as Appointment[];
}

export async function getPaymentIntentsForAppointment(appointmentId: string): Promise<PaymentIntent[]> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("payment_intents")
    .select("*")
    .eq("appointment_id", appointmentId)
    .order("created_at", { ascending: false });
  return (data ?? []) as PaymentIntent[];
}

export interface DashboardMetrics {
  totalLeads: number;
  newLeads: number;
  bookedAppointments: number;
  paidAppointments: number;
  revenueRescued: number;
  conversionRate: number;
  pendingPayment: number;
  upcomingToday: number;
}

export async function getDashboardMetrics(clinicId: string, since: Date): Promise<DashboardMetrics> {
  const supabase = createSupabaseServerClient();
  const sinceIso = since.toISOString();

  const [{ data: leads }, { data: apps }] = await Promise.all([
    supabase.from("leads").select("id, first_seen_at, status").eq("clinic_id", clinicId).gte("first_seen_at", sinceIso),
    supabase.from("appointments").select("id, status, total_price, scheduled_at, signal_amount, signal_paid_at").eq("clinic_id", clinicId).gte("created_at", sinceIso)
  ]);

  const totalLeads = leads?.length ?? 0;
  const newLeads = (leads ?? []).filter((l) => l.status === "new").length;
  const booked = (apps ?? []).filter((a) => a.status !== "expired" && a.status !== "cancelled").length;
  const paid = (apps ?? []).filter((a) => a.signal_paid_at !== null).length;
  const revenueRescued = (apps ?? [])
    .filter((a) => a.signal_paid_at !== null)
    .reduce((acc, a) => acc + Number(a.total_price ?? 0), 0);
  const conversionRate = totalLeads > 0 ? (booked / totalLeads) * 100 : 0;
  const pendingPayment = (apps ?? []).filter((a) => a.status === "pending_payment").length;

  const today = new Date();
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
  const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();
  const upcomingToday = (apps ?? []).filter(
    (a) => a.scheduled_at >= startOfDay && a.scheduled_at < endOfDay && a.status === "confirmed"
  ).length;

  return {
    totalLeads,
    newLeads,
    bookedAppointments: booked,
    paidAppointments: paid,
    revenueRescued,
    conversionRate,
    pendingPayment,
    upcomingToday
  };
}
