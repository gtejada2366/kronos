import type { NextRequest } from "next/server";

export function isAuthorizedCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  // Vercel Cron sends Authorization: Bearer <CRON_SECRET>.
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;

  // Manual triggers can pass ?secret=… for testing.
  const qsSecret = req.nextUrl.searchParams.get("secret");
  if (qsSecret && qsSecret === secret) return true;

  return false;
}
