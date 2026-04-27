export type AppointmentStatus =
  | "pending_payment"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "no_show"
  | "expired";

export type LeadStatus = "new" | "in_progress" | "booked" | "paid" | "abandoned";

export type ProfileRole = "owner" | "staff";

export type MessageDirection = "inbound" | "outbound";

export type MessageRole = "patient" | "bot" | "human" | "system";

export type PaymentStatus = "pending" | "paid" | "expired" | "cancelled" | "refunded";

export interface Clinic {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  signal_amount: number;
  whatsapp_phone_number_id: string | null;
  whatsapp_business_account_id: string | null;
  whatsapp_access_token: string | null;
  yape_handle: string | null;
  google_calendar_id: string | null;
  google_refresh_token: string | null;
  bot_persona: string | null;
  bot_extra_instructions: string | null;
  onboarded: boolean;
  created_at: string;
}

export interface Profile {
  id: string;
  clinic_id: string;
  role: ProfileRole;
  full_name: string | null;
  created_at: string;
}

export interface Service {
  id: string;
  clinic_id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price: number;
  active: boolean;
  sort_order: number;
  created_at: string;
}

export interface AvailabilityRule {
  id: string;
  clinic_id: string;
  day_of_week: number; // 0..6 (Sunday=0)
  start_minute: number; // minutes from midnight in clinic TZ
  end_minute: number;
}

export interface AvailabilityOverride {
  id: string;
  clinic_id: string;
  date: string; // YYYY-MM-DD
  closed: boolean;
  custom_start_minute: number | null;
  custom_end_minute: number | null;
  note: string | null;
}

export interface Lead {
  id: string;
  clinic_id: string;
  whatsapp_phone: string;
  name: string | null;
  source: string | null;
  status: LeadStatus;
  first_seen_at: string;
  last_message_at: string;
  notes: string | null;
}

export interface Conversation {
  id: string;
  clinic_id: string;
  lead_id: string;
  status: "active" | "closed";
  started_at: string;
  ended_at: string | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  clinic_id: string;
  direction: MessageDirection;
  role: MessageRole;
  content: string;
  whatsapp_message_id: string | null;
  created_at: string;
}

export interface Appointment {
  id: string;
  clinic_id: string;
  lead_id: string;
  service_id: string | null;
  scheduled_at: string;
  duration_minutes: number;
  status: AppointmentStatus;
  signal_amount: number;
  signal_paid_at: string | null;
  total_price: number;
  payment_link: string | null;
  payment_reference: string | null;
  google_event_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentIntent {
  id: string;
  clinic_id: string;
  appointment_id: string;
  amount: number;
  currency: string;
  provider: "yape" | "manual";
  link: string;
  reference: string | null;
  status: PaymentStatus;
  paid_at: string | null;
  expires_at: string;
  created_at: string;
}

export interface Slot {
  start: string; // ISO
  end: string; // ISO
}
