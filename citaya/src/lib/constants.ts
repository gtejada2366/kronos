export const BRAND = {
  name: "Citaya",
  tagline: "Captura, agenda y cobra en WhatsApp",
  domain: "citaya.pe"
};

export const DEFAULT_TIMEZONE = "America/Lima";
export const DEFAULT_CURRENCY = "PEN";

export const DEFAULT_SIGNAL_AMOUNT = 50; // S/. 50 default

export const PAYMENT_GRACE_MINUTES = 30; // slot held this long after Yape link sent
export const APPOINTMENT_BUFFER_MINUTES = 10; // gap between consecutive slots
export const MIN_BOOKING_LEAD_HOURS = 2; // can't book within next 2 hours
export const MAX_BOOKING_LEAD_DAYS = 60; // can't book more than 60 days ahead

export const APPOINTMENT_STATUS = {
  PENDING_PAYMENT: "pending_payment",
  CONFIRMED: "confirmed",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  NO_SHOW: "no_show",
  EXPIRED: "expired"
} as const;

export const LEAD_STATUS = {
  NEW: "new",
  IN_PROGRESS: "in_progress",
  BOOKED: "booked",
  PAID: "paid",
  ABANDONED: "abandoned"
} as const;
