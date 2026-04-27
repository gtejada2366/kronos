import { describe, expect, it } from "vitest";
import { normalizePhone, parseInboundWebhook } from "./client";

describe("normalizePhone", () => {
  it("strips non-digits", () => {
    expect(normalizePhone("+51 999 888 777")).toBe("51999888777");
    expect(normalizePhone("(999) 888-777")).toBe("999888777");
  });
  it("strips leading 00", () => {
    expect(normalizePhone("0051999888777")).toBe("51999888777");
  });
});

describe("parseInboundWebhook", () => {
  const validPayload = {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: "PHONE123" },
              contacts: [{ profile: { name: "Ana" }, wa_id: "51999111222" }],
              messages: [
                {
                  id: "wamid.HBg",
                  from: "51999111222",
                  type: "text",
                  text: { body: "Hola" },
                  timestamp: "1718000000"
                }
              ]
            }
          }
        ]
      }
    ]
  };

  it("parses a valid text message", () => {
    const out = parseInboundWebhook(validPayload);
    expect(out).not.toBeNull();
    expect(out!.fromPhone).toBe("51999111222");
    expect(out!.text).toBe("Hola");
    expect(out!.contactName).toBe("Ana");
    expect(out!.phoneNumberId).toBe("PHONE123");
    expect(out!.whatsappMessageId).toBe("wamid.HBg");
  });

  it("returns null on status update", () => {
    const status = {
      entry: [{ changes: [{ value: { statuses: [{ status: "read" }] } }] }]
    };
    expect(parseInboundWebhook(status)).toBeNull();
  });

  it("returns null on non-text message", () => {
    const audio = JSON.parse(JSON.stringify(validPayload));
    audio.entry[0].changes[0].value.messages[0].type = "audio";
    delete audio.entry[0].changes[0].value.messages[0].text;
    expect(parseInboundWebhook(audio)).toBeNull();
  });

  it("returns null on garbage payload", () => {
    expect(parseInboundWebhook({})).toBeNull();
    expect(parseInboundWebhook(null)).toBeNull();
    expect(parseInboundWebhook("nope")).toBeNull();
  });
});
