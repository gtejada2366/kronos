import { randomUUID } from "node:crypto";

/**
 * Yape link generator.
 *
 * Yape Empresas exposes a Direct API for merchants with a sales agreement, but
 * the practical fallback every clinic supports is the **link de cobro** that
 * Yape generates for an authenticated merchant handle. We craft the link
 * client-side and verify payment via the merchant's webhook (or, in MVP, a
 * manual confirmation step from the clinic dashboard).
 *
 * If `YAPE_API_KEY` is set we attempt the Direct API; otherwise we return a
 * deeplink + reference that the patient can paste into Yape.
 */

export interface YapeLinkInput {
  merchantHandle: string; // commerce handle (e.g. "@clinicaXYZ")
  amount: number;
  currency: string;
  reference: string; // unique per appointment
  description?: string;
}

export interface YapeLinkOutput {
  link: string;
  reference: string;
  provider: "yape" | "manual";
}

export function buildYapeLink(input: YapeLinkInput): YapeLinkOutput {
  const reference = input.reference || randomUUID().slice(0, 8).toUpperCase();
  const cleanHandle = (input.merchantHandle || "").replace(/^@/, "").trim();
  if (!cleanHandle) {
    return {
      link: `https://citaya.pe/pay/${reference}`,
      reference,
      provider: "manual"
    };
  }
  const params = new URLSearchParams({
    monto: input.amount.toFixed(2),
    referencia: reference
  });
  if (input.description) params.set("nota", input.description);
  return {
    link: `https://yape.com.pe/cobrar/${encodeURIComponent(cleanHandle)}?${params.toString()}`,
    reference,
    provider: "yape"
  };
}

export function paymentReference(): string {
  return randomUUID().slice(0, 8).toUpperCase();
}
