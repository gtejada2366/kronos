import { CONFIG } from "./config";
import { addDays } from "./dates";
import { mean, pearson, round, stddev } from "./stats";
import type {
  BacktestResults,
  BestSignal,
  DataCoverage,
  GitHubActivity,
  MetricName,
  ResultRow,
  TimeWindow,
  TokenPrice
} from "./types";

const METRICS: MetricName[] = ["commits", "releases", "stars_delta"];
const WINDOW_LABEL: Record<number, TimeWindow> = { 1: "24h", 2: "48h", 3: "72h" };

export interface AnalysisInput {
  github: GitHubActivity[];
  tokens: Array<{ symbol: string; coingeckoId: string; prices: TokenPrice[] }>;
  coverage: DataCoverage;
  notes: string[];
}

/** % forward return from close[date] to close[date + windowDays]. */
function forwardReturn(
  closeByDate: Map<string, number>,
  date: string,
  windowDays: number
): number | null {
  const c0 = closeByDate.get(date);
  const cN = closeByDate.get(addDays(date, windowDays));
  if (c0 === undefined || cN === undefined || c0 <= 0) return null;
  return ((cN - c0) / c0) * 100;
}

function metricValue(activity: GitHubActivity | undefined, metric: MetricName): number {
  if (!activity) return 0;
  return activity[metric];
}

/**
 * Dates on which a metric "fires":
 *  - commits / stars_delta: value > mean + 1 std dev (a genuine activity spike)
 *  - releases: value >= 1 (a release happened that day)
 */
function computeSignalDates(
  ghByDate: Map<string, GitHubActivity>,
  ghDates: string[],
  metric: MetricName
): string[] {
  if (metric === "releases") {
    return ghDates.filter((d) => (ghByDate.get(d)?.releases ?? 0) >= 1);
  }
  const values = ghDates.map((d) => metricValue(ghByDate.get(d), metric));
  const threshold = mean(values) + stddev(values);
  return ghDates.filter((d) => metricValue(ghByDate.get(d), metric) > threshold);
}

export function runAnalysis(input: AnalysisInput): BacktestResults {
  const notes = [...input.notes];
  const ghByDate = new Map<string, GitHubActivity>();
  for (const g of input.github) ghByDate.set(g.date, g);
  const ghDates = [...ghByDate.keys()].sort();

  const fullResults: ResultRow[] = [];

  for (const token of input.tokens) {
    const closeByDate = new Map<string, number>();
    for (const p of token.prices) closeByDate.set(p.date, p.close);

    if (closeByDate.size < CONFIG.analysis.minHistoryDays) {
      notes.push(
        `${token.symbol}: only ${closeByDate.size} price days (< ${CONFIG.analysis.minHistoryDays}) — excluded from analysis`
      );
      continue;
    }

    for (const metric of METRICS) {
      const signalDates = computeSignalDates(ghByDate, ghDates, metric);

      for (const windowDays of CONFIG.analysis.windowsDays) {
        // Correlation pairs + baseline universe.
        const metricSeries: number[] = [];
        const returnSeries: number[] = [];
        for (const d of ghDates) {
          const ret = forwardReturn(closeByDate, d, windowDays);
          if (ret === null) continue;
          metricSeries.push(metricValue(ghByDate.get(d), metric));
          returnSeries.push(ret);
        }
        const correlation = pearson(metricSeries, returnSeries);
        const baseline = returnSeries.length > 0 ? mean(returnSeries) : NaN;

        // Signal-day returns.
        const signalReturns: number[] = [];
        for (const d of signalDates) {
          const ret = forwardReturn(closeByDate, d, windowDays);
          if (ret !== null) signalReturns.push(ret);
        }
        const avgSignal = signalReturns.length > 0 ? mean(signalReturns) : NaN;

        fullResults.push({
          token: token.symbol,
          metric,
          time_window: WINDOW_LABEL[windowDays],
          correlation: round(correlation, 4),
          avg_return_signal_days: round(avgSignal, 4),
          avg_return_baseline_days: round(baseline, 4),
          signal_minus_baseline: round(
            Number.isFinite(avgSignal) && Number.isFinite(baseline) ? avgSignal - baseline : 0,
            4
          ),
          sample_size: signalReturns.length,
          correlation_pairs: returnSeries.length
        });
      }
    }
  }

  return buildVerdict(fullResults, ghByDate, ghDates, input.coverage, notes);
}

function buildVerdict(
  fullResults: ResultRow[],
  ghByDate: Map<string, GitHubActivity>,
  ghDates: string[],
  coverage: DataCoverage,
  notes: string[]
): BacktestResults {
  const { minSignalDays, minCorrelationPairs, edgePctThreshold } = CONFIG.analysis;

  const eligible = fullResults.filter(
    (r) =>
      r.sample_size >= minSignalDays &&
      r.correlation_pairs >= minCorrelationPairs &&
      Number.isFinite(r.avg_return_signal_days)
  );

  // Best signal = largest edge over baseline among eligible rows.
  let best: ResultRow | null = null;
  for (const r of eligible) {
    if (!best || r.signal_minus_baseline > best.signal_minus_baseline) best = r;
  }

  const coveragePoor =
    !coverage.github_complete ||
    coverage.tokens.some((t) => !t.available || t.price_days < CONFIG.analysis.minHistoryDays) ||
    coverage.github_total_commits === 0;

  let verdict: boolean | "inconclusive";
  if (!best || eligible.length === 0) {
    verdict = "inconclusive";
  } else {
    const supporting = eligible.filter(
      (r) => r.signal_minus_baseline > 0 && r.correlation > 0
    );
    const breadth = supporting.length / eligible.length;
    const strong =
      best.signal_minus_baseline >= edgePctThreshold &&
      best.correlation > 0.1 &&
      best.sample_size >= minSignalDays;

    if (strong && breadth >= 0.34 && !coveragePoor) {
      verdict = true;
    } else if (best.signal_minus_baseline > 0) {
      verdict = "inconclusive";
    } else {
      verdict = false;
    }
  }

  const bestSignal: BestSignal | null = best
    ? {
        metric: best.metric,
        token: best.token,
        time_window: best.time_window,
        avg_return_signal_days: best.avg_return_signal_days,
        avg_return_baseline_days: best.avg_return_baseline_days,
        correlation: best.correlation,
        sample_size: best.sample_size
      }
    : null;

  // Signal days for the winning metric (token-independent).
  const signalDays = best
    ? computeSignalDates(ghByDate, ghDates, best.metric).sort()
    : [];

  if (coveragePoor) {
    notes.push(
      "Data coverage is partial (GitHub pagination capped/rate-limited or short token history) — treat results as indicative, not definitive."
    );
  }

  return {
    hypothesis_supported: verdict,
    generated_at: new Date().toISOString(),
    window_days: CONFIG.windowDays,
    return_units: "percent",
    data_coverage: coverage,
    best_signal: bestSignal,
    full_results: fullResults.sort(
      (a, b) => b.signal_minus_baseline - a.signal_minus_baseline
    ),
    signal_days: signalDays,
    notes,
    recommendation: buildRecommendation(verdict, best, eligible.length, coveragePoor)
  };
}

function buildRecommendation(
  verdict: boolean | "inconclusive",
  best: ResultRow | null,
  eligibleCount: number,
  coveragePoor: boolean
): string {
  const parts: string[] = [];

  if (verdict === true && best) {
    parts.push(
      `The hypothesis holds in-sample: ${best.metric} spikes precede a ${best.signal_minus_baseline.toFixed(
        2
      )}pp edge over baseline for ${best.token} at the ${best.time_window} horizon (r=${best.correlation.toFixed(
        2
      )}, n=${best.sample_size}).`
    );
    parts.push(
      "Next steps: (1) re-run on a longer window and an out-of-sample period to check stability; (2) account for ~27 metric/token/window combinations tested — apply a multiple-comparisons correction (e.g. Bonferroni) before trusting any single result; (3) net out trading fees/slippage and test position sizing; (4) only then consider a small paper-traded allocation."
    );
  } else if (verdict === "inconclusive") {
    if (eligibleCount === 0) {
      parts.push(
        "Inconclusive: too few signal days or price-history pairs to evaluate the hypothesis. Widen the window beyond 180 days and ensure full GitHub + price coverage."
      );
    } else {
      parts.push(
        "Inconclusive: the best signal shows a positive but weak edge over baseline that is not robust enough to act on."
      );
      parts.push(
        "Next steps: extend history, reduce noise (e.g. smooth commit counts over 3-day windows), and validate out-of-sample before drawing conclusions."
      );
    }
  } else {
    parts.push(
      "The hypothesis is not supported in this sample: high-activity days did not beat baseline returns. GitHub activity appears to be a coincident or lagging indicator rather than a leading one for these tokens."
    );
    parts.push(
      "Next steps: test the reverse (do prices lead activity?), try longer horizons, or abandon this signal."
    );
  }

  if (coveragePoor) {
    parts.push(
      "Caveat: data coverage was partial — set GITHUB_TOKEN and re-run for a complete dataset before relying on these numbers."
    );
  }

  return parts.join(" ");
}
