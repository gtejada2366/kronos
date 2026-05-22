import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { CONFIG } from "./config";
import { log } from "./logger";
import type { GitHubActivity, TokenPrice } from "./types";

/** Returns a Supabase client, or null if credentials are not configured. */
export function getSupabase(): SupabaseClient | null {
  const { url, anonKey } = CONFIG.supabase;
  if (!url || !anonKey) {
    log.warn(
      "Supabase not configured (SUPABASE_URL / SUPABASE_ANON_KEY missing) — DB storage skipped, analysis continues in memory"
    );
    return null;
  }
  return createClient(url, anonKey, { auth: { persistSession: false } });
}

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export async function storeGitHubActivity(
  client: SupabaseClient,
  rows: GitHubActivity[]
): Promise<void> {
  for (const batch of chunk(rows, 500)) {
    const { error } = await client.from("github_activity").upsert(batch, { onConflict: "date" });
    if (error) throw new Error(`github_activity upsert failed: ${error.message}`);
  }
  log.info(`Stored ${rows.length} rows into github_activity`);
}

export async function storeTokenPrices(
  client: SupabaseClient,
  rows: TokenPrice[]
): Promise<void> {
  for (const batch of chunk(rows, 500)) {
    const { error } = await client
      .from("token_prices")
      .upsert(batch, { onConflict: "date,token_id" });
    if (error) throw new Error(`token_prices upsert failed: ${error.message}`);
  }
  log.info(`Stored ${rows.length} rows into token_prices`);
}
