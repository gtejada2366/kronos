import * as dotenv from "dotenv";
import type { TokenConfig } from "./types";

dotenv.config();

export const CONFIG = {
  /** How many days of history to analyse. */
  windowDays: 180,

  github: {
    owner: "elizaOS",
    repo: "eliza",
    apiBase: "https://api.github.com",
    token: process.env.GITHUB_TOKEN ?? "",
    // Page caps keep runtime + rate-limit usage bounded on a very active repo.
    maxCommitPages: 80,
    maxStarPages: 60,
    maxForkPages: 60,
    interPageDelayMs: 350
  },

  coingecko: {
    apiBase: "https://api.coingecko.com/api/v3",
    apiKey: process.env.COINGECKO_API_KEY ?? "",
    // Free tier ~ 30 calls/min; we make very few calls but stay polite.
    interCallDelayMs: 2500
  },

  supabase: {
    url: process.env.SUPABASE_URL ?? "",
    anonKey: process.env.SUPABASE_ANON_KEY ?? ""
  },

  tokens: [
    { symbol: "AI16Z", coingeckoId: "ai16z" },
    { symbol: "VIRTUAL", coingeckoId: "virtual-protocol" },
    { symbol: "AIXBT", coingeckoId: "aixbt" }
  ] as TokenConfig[],

  analysis: {
    /** Forward-return windows in days: 1d=24h, 2d=48h, 3d=72h. */
    windowsDays: [1, 2, 3] as const,
    /** Minimum signal days for a result row to be eligible as "best signal". */
    minSignalDays: 4,
    /** Minimum (metric, return) pairs for a correlation to be trusted. */
    minCorrelationPairs: 20,
    /** Signal must beat baseline by this many percentage points to count as "strong". */
    edgePctThreshold: 2.0,
    /** A token needs at least this many price days to be analysed. */
    minHistoryDays: 60
  },

  outputFile: "results.json"
};
