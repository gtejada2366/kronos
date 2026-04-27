import { describe, expect, it } from "vitest";
import { buildYapeLink, paymentReference } from "./yape";

describe("buildYapeLink", () => {
  it("returns yape provider when handle present", () => {
    const out = buildYapeLink({
      merchantHandle: "@miClinica",
      amount: 50,
      currency: "PEN",
      reference: "ABC123"
    });
    expect(out.provider).toBe("yape");
    expect(out.link).toContain("yape.com.pe/cobrar/miClinica");
    expect(out.link).toContain("monto=50.00");
    expect(out.link).toContain("referencia=ABC123");
    expect(out.reference).toBe("ABC123");
  });

  it("returns manual provider when handle empty", () => {
    const out = buildYapeLink({
      merchantHandle: "",
      amount: 50,
      currency: "PEN",
      reference: "REF1"
    });
    expect(out.provider).toBe("manual");
    expect(out.link).toContain("/pay/REF1");
  });

  it("strips leading @ in handle", () => {
    const out = buildYapeLink({ merchantHandle: "@foo", amount: 1, currency: "PEN", reference: "R" });
    expect(out.link).toContain("/cobrar/foo");
    expect(out.link).not.toContain("/cobrar/%40");
  });

  it("includes description as nota", () => {
    const out = buildYapeLink({
      merchantHandle: "@x",
      amount: 30,
      currency: "PEN",
      reference: "R",
      description: "Señal limpieza"
    });
    expect(out.link).toContain("nota=");
  });
});

describe("paymentReference", () => {
  it("returns 8 uppercase hex chars", () => {
    const r = paymentReference();
    expect(r).toMatch(/^[A-Z0-9]{8}$/);
  });
});
