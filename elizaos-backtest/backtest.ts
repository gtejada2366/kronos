/**
 * ElizaOS GitHub-activity → AI-agent token backtest.
 *
 * Hypothesis: bursts of activity in the ElizaOS GitHub repo (commits, releases,
 * stars) precede positive returns in AI16Z / VIRTUAL / AIXBT over the next
 * 24-72 hours.
 *
 * Run:  npx ts-node backtest.ts
 */

import * as fs from "fs";
import { CONFIG } from "./src/config";
import { log, sleep } from "./src/logger";
import { addDays, dateRange, todayUTC } from "./src/dates";
import { fetchCommits, fetchForks, fetchReleases, fetchStars } from "./src/github";
import { fetchTokenPrices } from "./src/coingecko";
import { getSupabase, storeGitHubActivity, storeTokenPrices } from "./src/supabase";
import { runAnalysis, AnalysisInput } from "./src/analysis";
import type { BacktestResults, DataCoverage, GitHubActivity, TokenPrice } from "./src/types";

async function main(): Promise<void> {
  const startedAt = Date.now();
  const endStr = todayUTC();
  const startStr = addDays(endStr, -CONFIG.windowDays);
  const allDates = dateRange(startStr, endStr);

  log.step(`ElizaOS token backtest — window ${startStr} → ${endStr} (${CONFIG.windowDays}d)`);
  if (!CONFIG.github.token) {
    log.warn("No GITHUB_TOKEN set — GitHub API is limited to 60 req/hour; data may be partial.");
  }

  // ---------------------------------------------------------------- GitHub
  log.step("1/5  Fetching GitHub activity for elizaOS/eliza");
  const commitsRes = await fetchCommits(startStr, endStr);
  const releasesRes = await fetchReleases(startStr, endStr);
  const starsRes = await fetchStars(startStr);
  const forksRes = await fetchForks(startStr);

  const githubComplete =
    commitsRes.complete && releasesRes.complete && starsRes.complete && forksRes.complete;

  const githubActivity: GitHubActivity[] = allDates.map((date) => ({
    date,
    commits: commitsRes.data.counts.get(date) ?? 0,
    releases: releasesRes.data.counts.get(date) ?? 0,
    stars_delta: starsRes.data.deltas.get(date) ?? 0,
    forks_delta: forksRes.data.deltas.get(date) ?? 0
  }));

  log.info(
    `GitHub: ${commitsRes.data.total} commits, ${releasesRes.data.total} releases, ` +
      `${starsRes.data.total} stars, ${forksRes.data.total} forks within window`
  );

  const notes: string[] = [];
  for (const r of [commitsRes, releasesRes, starsRes, forksRes]) {
    if (r.note) notes.push(r.note);
  }

  // ------------------------------------------------------------- CoinGecko
  log.step("2/5  Fetching token prices from CoinGecko");
  const tokenData: Array<{ symbol: string; coingeckoId: string; prices: TokenPrice[] }> = [];
  const allPrices: TokenPrice[] = [];

  for (let i = 0; i < CONFIG.tokens.length; i++) {
    const token = CONFIG.tokens[i];
    log.info(`Fetching ${token.symbol} (${token.coingeckoId})…`);
    const result = await fetchTokenPrices(token.coingeckoId);
    if (result.available) {
      log.info(`  ${token.symbol}: ${result.prices.length} daily bars`);
      tokenData.push({ symbol: token.symbol, coingeckoId: token.coingeckoId, prices: result.prices });
      allPrices.push(...result.prices);
    } else {
      log.warn(`  ${token.symbol}: ${result.note}`);
      tokenData.push({ symbol: token.symbol, coingeckoId: token.coingeckoId, prices: [] });
    }
    if (result.note) notes.push(result.note);
    if (i < CONFIG.tokens.length - 1) await sleep(CONFIG.coingecko.interCallDelayMs);
  }

  // -------------------------------------------------------------- Supabase
  log.step("3/5  Storing data in Supabase");
  const supabase = getSupabase();
  if (supabase) {
    try {
      await storeGitHubActivity(supabase, githubActivity);
      if (allPrices.length > 0) await storeTokenPrices(supabase, allPrices);
      else log.warn("No token prices to store.");
    } catch (err) {
      const msg = (err as Error).message;
      log.error(`Supabase storage failed: ${msg}`);
      notes.push(
        `Supabase storage failed (${msg}). If this is an RLS error, run schema.sql which sets permissive insert policies, or use a service-role key.`
      );
    }
  }

  // --------------------------------------------------------------- Analyse
  log.step("4/5  Running correlation + signal analysis");
  const coverage: DataCoverage = {
    github_days: githubActivity.length,
    github_complete: githubComplete,
    github_total_commits: commitsRes.data.total,
    github_total_releases: releasesRes.data.total,
    github_stars_tracked: starsRes.data.total,
    github_forks_tracked: forksRes.data.total,
    tokens: tokenData.map((t) => ({
      symbol: t.symbol,
      coingecko_id: t.coingeckoId,
      price_days: t.prices.length,
      available: t.prices.length > 0,
      note:
        t.prices.length > 0 && t.prices.length < CONFIG.analysis.minHistoryDays
          ? `only ${t.prices.length} days of history`
          : undefined
    }))
  };

  const analysisInput: AnalysisInput = { github: githubActivity, tokens: tokenData, coverage, notes };
  const results = runAnalysis(analysisInput);

  // ----------------------------------------------------------------- Report
  log.step("5/5  Report");
  printReport(results);

  fs.writeFileSync(CONFIG.outputFile, JSON.stringify(results, null, 2));
  log.info(`Full results written to ${CONFIG.outputFile}`);
  log.info(`Done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

function printReport(r: BacktestResults): void {
  const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

  console.log("\n  DATA COVERAGE");
  console.log(
    `  GitHub: ${r.data_coverage.github_total_commits} commits · ` +
      `${r.data_coverage.github_total_releases} releases · ` +
      `${r.data_coverage.github_stars_tracked} stars · ` +
      `${r.data_coverage.github_forks_tracked} forks · ` +
      `complete=${r.data_coverage.github_complete}`
  );
  for (const t of r.data_coverage.tokens) {
    console.log(
      `  ${t.symbol.padEnd(9)} ${t.available ? `${t.price_days} price days` : "UNAVAILABLE"}` +
        (t.note ? ` (${t.note})` : "")
    );
  }

  console.log("\n  FULL RESULTS  (sorted by edge over baseline)");
  console.log(
    "  " +
      ["TOKEN", "METRIC", "WIN", "CORR", "SIGNAL", "BASELINE", "EDGE", "N"]
        .map((h, i) => h.padEnd([9, 12, 5, 8, 9, 9, 9, 4][i]))
        .join("")
  );
  for (const row of r.full_results) {
    console.log(
      "  " +
        row.token.padEnd(9) +
        row.metric.padEnd(12) +
        row.time_window.padEnd(5) +
        row.correlation.toFixed(2).padEnd(8) +
        pct(row.avg_return_signal_days).padEnd(9) +
        pct(row.avg_return_baseline_days).padEnd(9) +
        pct(row.signal_minus_baseline).padEnd(9) +
        String(row.sample_size).padEnd(4)
    );
  }

  console.log("\n  BEST SIGNAL");
  if (r.best_signal) {
    const b = r.best_signal;
    console.log(`  ${b.metric} → ${b.token} @ ${b.time_window}`);
    console.log(`  signal days avg: ${pct(b.avg_return_signal_days)}`);
    console.log(`  baseline avg:    ${pct(b.avg_return_baseline_days)}`);
    console.log(`  edge:            ${pct(b.avg_return_signal_days - b.avg_return_baseline_days)}`);
    console.log(`  correlation:     ${b.correlation.toFixed(3)}`);
    console.log(`  sample size:     ${b.sample_size} signal days`);
  } else {
    console.log("  none — not enough eligible signal days");
  }

  const verdictText =
    r.hypothesis_supported === true
      ? "SUPPORTED"
      : r.hypothesis_supported === false
      ? "NOT SUPPORTED"
      : "INCONCLUSIVE";
  console.log(`\n  VERDICT: hypothesis ${verdictText}`);

  if (r.notes.length > 0) {
    console.log("\n  NOTES");
    for (const n of r.notes) console.log(`  - ${n}`);
  }

  console.log("\n  RECOMMENDATION");
  console.log(`  ${r.recommendation}`);
  console.log("");
}

main().catch((err) => {
  log.error(`Backtest failed: ${(err as Error).message}`);
  if ((err as Error).stack) console.error((err as Error).stack);
  process.exit(1);
});
