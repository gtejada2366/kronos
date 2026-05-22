/** Per-day GitHub activity for the ElizaOS repo. */
export interface GitHubActivity {
  date: string; // YYYY-MM-DD (UTC)
  commits: number;
  releases: number;
  stars_delta: number;
  forks_delta: number;
}

/** Per-day token price bar. */
export interface TokenPrice {
  date: string; // YYYY-MM-DD (UTC)
  token_id: string; // CoinGecko id
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TokenConfig {
  symbol: string; // e.g. "AI16Z"
  coingeckoId: string; // e.g. "ai16z"
}

export type MetricName = "commits" | "releases" | "stars_delta";
export type TimeWindow = "24h" | "48h" | "72h";

/** One row of the correlation/return analysis grid. */
export interface ResultRow {
  token: string; // symbol
  metric: MetricName;
  time_window: TimeWindow;
  correlation: number; // Pearson r between metric(D) and forward return(D)
  avg_return_signal_days: number; // % return after "signal" days
  avg_return_baseline_days: number; // % return averaged over all days
  signal_minus_baseline: number; // edge in percentage points
  sample_size: number; // # of signal days with a valid forward return
  correlation_pairs: number; // # of (metric, return) pairs used for Pearson
}

export interface BestSignal {
  metric: MetricName;
  token: string;
  time_window: TimeWindow;
  avg_return_signal_days: number;
  avg_return_baseline_days: number;
  correlation: number;
  sample_size: number;
}

export interface DataCoverage {
  github_days: number;
  github_complete: boolean;
  github_total_commits: number;
  github_total_releases: number;
  github_stars_tracked: number;
  github_forks_tracked: number;
  tokens: Array<{
    symbol: string;
    coingecko_id: string;
    price_days: number;
    available: boolean;
    note?: string;
  }>;
}

export interface BacktestResults {
  hypothesis_supported: boolean | "inconclusive";
  generated_at: string;
  window_days: number;
  return_units: "percent";
  data_coverage: DataCoverage;
  best_signal: BestSignal | null;
  full_results: ResultRow[];
  signal_days: string[];
  notes: string[];
  recommendation: string;
}
