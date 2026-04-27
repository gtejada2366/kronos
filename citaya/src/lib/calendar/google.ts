import { google } from "googleapis";
import { logger } from "../logger";

const SCOPES = ["https://www.googleapis.com/auth/calendar.events"];

export function getOAuthClient(redirectUri?: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET no configurados");
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function buildGoogleAuthUrl(stateToken: string, redirectUri: string): string {
  const oauth = getOAuthClient(redirectUri);
  return oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state: stateToken
  });
}

export async function exchangeCodeForRefreshToken(code: string, redirectUri: string): Promise<{
  refreshToken: string | null;
  accessToken: string | null;
}> {
  const oauth = getOAuthClient(redirectUri);
  const { tokens } = await oauth.getToken(code);
  return {
    refreshToken: tokens.refresh_token ?? null,
    accessToken: tokens.access_token ?? null
  };
}

export async function pushEventToGoogle(opts: {
  refreshToken: string;
  calendarId: string;
  summary: string;
  description: string;
  startIso: string;
  endIso: string;
  timezone: string;
  attendeePhone?: string;
}): Promise<string | null> {
  try {
    const oauth = getOAuthClient();
    oauth.setCredentials({ refresh_token: opts.refreshToken });
    const calendar = google.calendar({ version: "v3", auth: oauth });
    const res = await calendar.events.insert({
      calendarId: opts.calendarId,
      requestBody: {
        summary: opts.summary,
        description: opts.description,
        start: { dateTime: opts.startIso, timeZone: opts.timezone },
        end: { dateTime: opts.endIso, timeZone: opts.timezone }
      }
    });
    return res.data.id ?? null;
  } catch (err) {
    logger.error("google_calendar_insert_failed", {
      error: err instanceof Error ? err.message : String(err)
    });
    return null;
  }
}

export async function deleteEventFromGoogle(opts: {
  refreshToken: string;
  calendarId: string;
  eventId: string;
}): Promise<boolean> {
  try {
    const oauth = getOAuthClient();
    oauth.setCredentials({ refresh_token: opts.refreshToken });
    const calendar = google.calendar({ version: "v3", auth: oauth });
    await calendar.events.delete({ calendarId: opts.calendarId, eventId: opts.eventId });
    return true;
  } catch (err) {
    logger.warn("google_calendar_delete_failed", {
      eventId: opts.eventId,
      error: err instanceof Error ? err.message : String(err)
    });
    return false;
  }
}
