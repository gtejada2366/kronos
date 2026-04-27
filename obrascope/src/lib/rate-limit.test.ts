import { describe, expect, it } from "vitest";
import { clientKey, rateLimit } from "./rate-limit";

describe("rateLimit", () => {
  it("allows up to limit then rejects", () => {
    const key = `test-${Math.random()}`;
    const a = rateLimit(key, 3, 60_000);
    const b = rateLimit(key, 3, 60_000);
    const c = rateLimit(key, 3, 60_000);
    const d = rateLimit(key, 3, 60_000);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(c.ok).toBe(true);
    expect(d.ok).toBe(false);
    expect(d.remaining).toBe(0);
  });

  it("returns the same resetAt across the window", () => {
    const key = `test-${Math.random()}`;
    const a = rateLimit(key, 5, 60_000);
    const b = rateLimit(key, 5, 60_000);
    expect(a.resetAt).toBe(b.resetAt);
  });

  it("decrements remaining", () => {
    const key = `test-${Math.random()}`;
    const a = rateLimit(key, 5, 60_000);
    const b = rateLimit(key, 5, 60_000);
    expect(a.remaining).toBe(4);
    expect(b.remaining).toBe(3);
  });
});

describe("clientKey", () => {
  it("prefers x-forwarded-for first IP", () => {
    const h = new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
    expect(clientKey(h)).toBe("1.2.3.4");
  });
  it("falls back to x-real-ip", () => {
    const h = new Headers({ "x-real-ip": "9.8.7.6" });
    expect(clientKey(h)).toBe("9.8.7.6");
  });
  it("returns 'unknown' if no header", () => {
    expect(clientKey(new Headers())).toBe("unknown");
  });
});
