# ElizaOS Activity → AI-Agent Token Backtest

A standalone backtest that tests one hypothesis:

> **When the [ElizaOS GitHub repo](https://github.com/elizaOS/eliza) sees a
> burst of activity (commits, releases, stars), the prices of AI-agent
> ecosystem tokens — AI16Z, VIRTUAL, AIXBT — rise over the following
> 24–72 hours.**

It fetches GitHub activity and token prices, stores them in Supabase, runs a
correlation + signal-vs-baseline analysis, and writes a verdict to
`results.json`.

## What it does

1. **GitHub activity** (`elizaOS/eliza`, last 180 days)
   - daily commit counts
   - releases per day
   - new stars per day (`stars_delta`)
   - new forks per day (`forks_delta`)
2. **Token prices** via CoinGecko free API — 180 days of daily close + volume
   for `ai16z`, `virtual-protocol`, `aixbt`.
3. **Stores** everything in Supabase tables `github_activity` and `token_prices`.
4. **Analysis**
   - Pearson correlation between each GitHub metric on day *D* and the token's
     forward return at 24h / 48h / 72h.
   - Average return after **signal days** (commits or stars > mean + 1 std dev;
     any release day) vs the **baseline** (average forward return over all
     days — the expected value of picking a random day).
5. **Report** to console + `results.json`, including a yes/no/inconclusive
   verdict and the single best-performing signal.

## Setup

```bash
cd elizaos-backtest
npm install
cp .env.example .env
# edit .env — fill SUPABASE_URL and SUPABASE_ANON_KEY
```

In the Supabase SQL editor, run [`schema.sql`](./schema.sql) once to create the
two tables and their RLS policies.

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | yes* | Supabase project URL |
| `SUPABASE_ANON_KEY` | yes* | Supabase anon key (writes via the policies in `schema.sql`) |
| `GITHUB_TOKEN` | recommended | Classic PAT, no scopes needed. Raises the GitHub limit from **60/hour** to **5,000/hour** — without it, 180 days of commits/stars on a busy repo will be only partially fetched. |
| `COINGECKO_API_KEY` | optional | Free CoinGecko demo key for better rate limits |

\* If Supabase credentials are missing the script still runs the full analysis
in memory and writes `results.json` — it just skips the DB write.

## Run

```bash
npx ts-node backtest.ts
```

Runtime is typically 1–4 minutes (most of it is polite delays between GitHub
pages and CoinGecko calls).

## Output — `results.json`

```jsonc
{
  "hypothesis_supported": true,            // true | false | "inconclusive"
  "best_signal": {
    "metric": "commits",                   // commits | releases | stars_delta
    "token": "AI16Z",                      // AI16Z | VIRTUAL | AIXBT
    "time_window": "48h",                  // 24h | 48h | 72h
    "avg_return_signal_days": 4.1,         // % return after signal days
    "avg_return_baseline_days": 0.6,       // % return on an average day
    "correlation": 0.21,
    "sample_size": 22
  },
  "full_results": [ /* every token × metric × window row */ ],
  "signal_days": [ "2025-01-14", "2025-01-22", ... ],
  "recommendation": "…what to do next…"
}
```

Returns are expressed in **percent**. `full_results` is sorted by edge over
baseline (best first).

## How the verdict is decided

- A result row is **eligible** if it has ≥ 4 signal days and ≥ 20 correlation
  pairs.
- **`true`** — the best signal beats baseline by ≥ 2 percentage points with a
  positive correlation, at least a third of eligible rows also show a positive
  edge, and data coverage is complete.
- **`false`** — the best signal underperforms baseline.
- **`"inconclusive"`** — a positive but weak/unreliable edge, partial data
  coverage, or too few signal days.

## Important caveats (read before trusting any number)

- **Multiple comparisons.** The grid tests up to 3 tokens × 3 metrics × 3
  windows = 27 combinations. With that many tries, one will look good by
  chance. Apply a correction (Bonferroni / false-discovery-rate) before
  believing a single result.
- **Small sample.** 180 days yields only ~15–30 high-activity signal days per
  metric. That is thin for statistical confidence.
- **In-sample only.** This is a single-period fit with no out-of-sample
  validation and no walk-forward. A positive verdict is a *reason to keep
  testing*, not a reason to trade.
- **No costs.** Returns ignore fees, slippage and spread.
- **OHLC synthesis.** CoinGecko's free `market_chart` endpoint gives one daily
  *close* + *volume* per day, not intraday OHLC. The `token_prices` table
  therefore synthesises `open` = prior close and `high`/`low` = the
  open/close range. The backtest itself only uses close-to-close returns, so
  this does not affect the result — but the stored OHLC is approximate.
- **Stars/forks are best-effort.** GitHub has no "stars on date X" endpoint;
  the script walks the stargazer/fork pages newest-first and is page-capped, so
  on a very large repo `stars_delta` may be partial. `commits` and `releases`
  are the most reliable signals.

## Project layout

```
elizaos-backtest/
  backtest.ts          # entry point / orchestrator
  schema.sql           # Supabase tables + RLS policies
  src/
    config.ts          # env + tunable parameters
    types.ts           # shared interfaces
    dates.ts           # UTC date helpers
    stats.ts           # mean, stddev, Pearson correlation
    github.ts          # GitHub REST fetchers (rate-limit aware)
    coingecko.ts       # CoinGecko price fetcher
    supabase.ts        # DB storage
    analysis.ts        # correlation + signal-vs-baseline + verdict
    logger.ts          # timestamped logging
```
