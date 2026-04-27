import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { exchangeCodeForRefreshToken } from "@/lib/calendar/google";
import { getCurrentContext } from "@/lib/data";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const ctx = await getCurrentContext();
  if (!ctx) return NextResponse.redirect(new URL("/login", req.url));

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (!code || !state) {
    return NextResponse.redirect(new URL("/settings?google=missing_code", req.url));
  }
  if (state !== ctx.clinic.id) {
    logger.warn("google_oauth_state_mismatch", { state, clinic_id: ctx.clinic.id });
    return NextResponse.redirect(new URL("/settings?google=state_mismatch", req.url));
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin}/api/google/callback`;
  try {
    const tokens = await exchangeCodeForRefreshToken(code, redirectUri);
    if (!tokens.refreshToken) {
      return NextResponse.redirect(new URL("/settings?google=no_refresh_token", req.url));
    }
    const admin = createSupabaseServiceClient();
    await admin
      .from("clinics")
      .update({
        google_refresh_token: tokens.refreshToken,
        google_calendar_id: ctx.clinic.google_calendar_id ?? "primary"
      })
      .eq("id", ctx.clinic.id);
    return NextResponse.redirect(new URL("/settings?google=connected", req.url));
  } catch (err) {
    logger.error("google_oauth_exchange_failed", {
      error: err instanceof Error ? err.message : String(err)
    });
    return NextResponse.redirect(new URL("/settings?google=exchange_failed", req.url));
  }
}
