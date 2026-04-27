import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";
import { isAuthorizedCron } from "./cron-auth";

function makeReq(opts: { auth?: string; secretParam?: string } = {}): NextRequest {
  const headers = new Map<string, string>();
  if (opts.auth) headers.set("authorization", opts.auth);
  const url = new URL("http://localhost/api/cron/x");
  if (opts.secretParam) url.searchParams.set("secret", opts.secretParam);
  return {
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    nextUrl: url
  } as unknown as NextRequest;
}

describe("isAuthorizedCron", () => {
  beforeEach(() => { process.env.CRON_SECRET = "shh"; });
  afterEach(() => { delete process.env.CRON_SECRET; });

  it("rejects when no CRON_SECRET", () => {
    delete process.env.CRON_SECRET;
    expect(isAuthorizedCron(makeReq({ auth: "Bearer x" }))).toBe(false);
  });
  it("accepts Bearer", () => {
    expect(isAuthorizedCron(makeReq({ auth: "Bearer shh" }))).toBe(true);
  });
  it("rejects wrong Bearer", () => {
    expect(isAuthorizedCron(makeReq({ auth: "Bearer no" }))).toBe(false);
  });
  it("accepts ?secret=", () => {
    expect(isAuthorizedCron(makeReq({ secretParam: "shh" }))).toBe(true);
  });
  it("rejects empty", () => {
    expect(isAuthorizedCron(makeReq())).toBe(false);
  });
});
