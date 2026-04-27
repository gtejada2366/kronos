import { logger } from "../logger";

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION ?? "v21.0";
const BASE = "https://graph.facebook.com";

export interface WhatsAppCreds {
  phoneNumberId: string;
  accessToken: string;
}

export async function sendWhatsAppText(
  creds: WhatsAppCreds,
  toPhone: string,
  body: string
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  if (!creds.phoneNumberId || !creds.accessToken) {
    return { ok: false, error: "WhatsApp credentials not set" };
  }
  const url = `${BASE}/${GRAPH_VERSION}/${creds.phoneNumberId}/messages`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${creds.accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: normalizePhone(toPhone),
        type: "text",
        text: { body, preview_url: true }
      })
    });
    if (!res.ok) {
      const errBody = await res.text();
      logger.warn("whatsapp_send_failed", { status: res.status, errBody, toPhone });
      return { ok: false, error: `${res.status}: ${errBody}` };
    }
    const json = (await res.json()) as { messages?: Array<{ id: string }> };
    return { ok: true, messageId: json.messages?.[0]?.id };
  } catch (err) {
    logger.error("whatsapp_send_exception", {
      error: err instanceof Error ? err.message : String(err)
    });
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.startsWith("00")) return digits.slice(2);
  return digits;
}

export interface WhatsAppInbound {
  fromPhone: string;
  text: string | null;
  whatsappMessageId: string;
  contactName: string | null;
  receivedAt: Date;
  phoneNumberId: string;
}

/**
 * Parses a Meta Cloud API "messages" webhook payload into our domain shape.
 * Returns null if the payload is a status update or doesn't contain a text
 * message.
 */
export function parseInboundWebhook(payload: unknown): WhatsAppInbound | null {
  try {
    const body = payload as {
      entry?: Array<{
        changes?: Array<{
          value?: {
            metadata?: { phone_number_id?: string };
            contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
            messages?: Array<{
              id?: string;
              from?: string;
              type?: string;
              text?: { body?: string };
              timestamp?: string;
            }>;
          };
        }>;
      }>;
    };

    const value = body.entry?.[0]?.changes?.[0]?.value;
    if (!value) return null;
    const message = value.messages?.[0];
    if (!message) return null;
    if (message.type !== "text") return null;
    if (!message.from || !message.id) return null;

    const phoneNumberId = value.metadata?.phone_number_id ?? "";
    const contactName = value.contacts?.[0]?.profile?.name ?? null;
    const tsSec = message.timestamp ? Number(message.timestamp) : Date.now() / 1000;

    return {
      fromPhone: message.from,
      text: message.text?.body ?? null,
      whatsappMessageId: message.id,
      contactName,
      receivedAt: new Date(tsSec * 1000),
      phoneNumberId
    };
  } catch (err) {
    logger.warn("whatsapp_parse_failed", {
      error: err instanceof Error ? err.message : String(err)
    });
    return null;
  }
}
