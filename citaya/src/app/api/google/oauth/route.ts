import { NextResponse, type NextRequest } from "next/server";
import { getCurrentContext } from "@/lib/data";
import { buildGoogleAuthUrl } from "@/lib/calendar/google";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const ctx = await getCurrentContext();
  if (!ctx) return NextResponse.redirect(new URL("/login", req.url));

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin}/api/google/callback`;
  try {
    const url = buildGoogleAuthUrl(ctx.clinic.id, redirectUri);
    return NextResponse.redirect(url);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
