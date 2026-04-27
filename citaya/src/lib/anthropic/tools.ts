import type Anthropic from "@anthropic-ai/sdk";

export const BOT_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_available_slots",
    description:
      "Devuelve hasta 3 horarios disponibles para un servicio dado. Llama esta herramienta cuando el paciente haya elegido un servicio del catálogo y esté listo para ver opciones de día/hora. NO inventes horarios.",
    input_schema: {
      type: "object" as const,
      properties: {
        service_id: {
          type: "string",
          description: "ID del servicio del catálogo de la clínica."
        },
        days_ahead: {
          type: "integer",
          description: "Cuántos días hacia adelante buscar (default 14, max 30).",
          minimum: 1,
          maximum: 30
        },
        prefer: {
          type: "string",
          enum: ["soonest", "morning", "afternoon", "evening"],
          description: "Preferencia del paciente para acotar la propuesta."
        }
      },
      required: ["service_id"]
    }
  },
  {
    name: "book_appointment",
    description:
      "Reserva un slot específico (no confirmado todavía hasta que el paciente pague la señal). Devuelve link de Yape y la referencia de la reserva. Llamar SOLO después de que el paciente haya elegido un slot puntual de los ofrecidos.",
    input_schema: {
      type: "object" as const,
      properties: {
        service_id: { type: "string", description: "ID del servicio." },
        slot_iso: {
          type: "string",
          description: "ISO 8601 timestamp del inicio del slot (UTC)."
        },
        patient_name: {
          type: "string",
          description: "Nombre del paciente, si ya se conoce. Si no, vacío."
        }
      },
      required: ["service_id", "slot_iso"]
    }
  },
  {
    name: "cancel_appointment",
    description:
      "Cancela una cita reservada por este paciente. Llamar cuando el paciente lo solicite explícitamente.",
    input_schema: {
      type: "object" as const,
      properties: {
        appointment_id: {
          type: "string",
          description: "ID de la cita a cancelar."
        },
        reason: {
          type: "string",
          description: "Motivo declarado por el paciente."
        }
      },
      required: ["appointment_id"]
    }
  },
  {
    name: "handoff_to_human",
    description:
      "Marca la conversación para que un humano de la clínica responda. Llamar cuando: (a) el paciente pide hablar con humano, (b) hay emergencia médica, (c) el paciente hace una pregunta fuera del scope (precios fuera del catálogo, casos clínicos complejos), (d) llevas más de 6 turnos sin avanzar.",
    input_schema: {
      type: "object" as const,
      properties: {
        reason: {
          type: "string",
          description: "Resumen breve del por qué se escala."
        }
      },
      required: ["reason"]
    }
  }
];

export interface ToolGetAvailableSlotsInput {
  service_id: string;
  days_ahead?: number;
  prefer?: "soonest" | "morning" | "afternoon" | "evening";
}

export interface ToolBookAppointmentInput {
  service_id: string;
  slot_iso: string;
  patient_name?: string;
}

export interface ToolCancelAppointmentInput {
  appointment_id: string;
  reason?: string;
}

export interface ToolHandoffInput {
  reason: string;
}

export type ToolName =
  | "get_available_slots"
  | "book_appointment"
  | "cancel_appointment"
  | "handoff_to_human";
