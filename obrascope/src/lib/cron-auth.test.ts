import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";
import { isAuthorizedCron } from "./cron-auth";

function makeReq(opts: { auth?: string; secretParam?: string } = {}): NextRequest {
  const headers = new Map<string, string>();
  if (opts.auth) headers.set("authorization", opts.auth);
  const url = new URL("http://localhost/api/cron/sync");
  if (opts.secretParam) url.searchParams.set("secret", opts.secretParam);
  return {
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    nextUrl: url
  } as unknown as NextRequest;
}

describe("isAuthorizedCron", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "shhh";
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("rejects when CRON_SECRET is unset", () => {
    delete process.env.CRON_SECRET;
    expect(isAuthorizedCron(makeReq({ auth: "Bearer x" }))).toBe(false);
  });

  it("accepts Authorization: Bearer <secret>", () => {
    expect(isAuthorizedCron(makeReq({ auth: "Bearer shhh" }))).toBe(true);
  });

  it("rejects wrong bearer", () => {
    expect(isAuthorizedCron(makeReq({ auth: "Bearer nope" }))).toBe(false);
  });

  it("accepts ?secret= query string", () => {
    expect(isAuthorizedCron(makeReq({ secretParam: "shhh" }))).toBe(true);
  });

  it("rejects wrong query secret", () => {
    expect(isAuthorizedCron(makeReq({ secretParam: "nope" }))).toBe(false);
  });

  it("rejects empty request", () => {
    expect(isAuthorizedCron(makeReq())).toBe(false);
  });
});
