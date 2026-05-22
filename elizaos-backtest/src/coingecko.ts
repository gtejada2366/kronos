import axios from "axios";
import { CONFIG } from "./config";
import { log, sleep } from "./logger";
import { toDateStr } from "./dates";
import type { TokenPrice } from "./types";

export interface PriceFetchResult {
  prices: TokenPrice[];
  available: boolean;
  note?: string;
}

/**
 * Fetches daily price history for a CoinGecko coin id.
 *
 * Uses /coins/{id}/market_chart with days=180 — for windows >= 90 days the
 * free API returns one data point per day automatically. That endpoint gives a
 * daily CLOSE price and daily VOLUME but no intraday OHLC. We therefore
 * synthesise the bar:
 *   open  = previous day's close   (first day: open = close)
 *   high  = max(open, close)
 *   low   = min(open, close)
 * The backtest only consumes close-to-close returns, so this synthesis is
 * cosmetic for the token_prices table and documented as such.
 */
export async function fetchTokenPrices(coingeckoId: string): Promise<PriceFetchResult> {
  const url = `${CONFIG.coingecko.apiBase}/coins/${coingeckoId}/market_chart`;
  const reqHeaders: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "elizaos-token-backtest"
  };
  if (CONFIG.coingecko.apiKey) reqHeaders["x-cg-demo-api-key"] = CONFIG.coingecko.apiKey;

  let lastErr = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await axios.get(url, {
      params: { vs_currency: "usd", days: CONFIG.windowDays },
      headers: reqHeaders,
      timeout: 30000,
      validateStatus: () => true
    });

    if (res.status === 200) {
      return { prices: parseMarketChart(res.data, coingeckoId), available: true };
    }
    if (res.status === 404) {
      return {
        prices: [],
        available: false,
        note: `CoinGecko: coin id '${coingeckoId}' not found (404) — skipped`
      };
    }
    if (res.status === 429) {
      const waitMs = 6000 * (attempt + 1);
      log.warn(`CoinGecko 429 for '${coingeckoId}'; backing off ${waitMs}ms`);
      await sleep(waitMs);
      lastErr = "429 rate limited";
      continue;
    }
    lastErr = `HTTP ${res.status}`;
    await sleep(3000 * (attempt + 1));
  }

  return {
    prices: [],
    available: false,
    note: `CoinGecko: failed to fetch '${coingeckoId}' after retries (${lastErr})`
  };
}

function parseMarketChart(data: unknown, coingeckoId: string): TokenPrice[] {
  const body = data as {
    prices?: Array<[number, number]>;
    total_volumes?: Array<[number, number]>;
  };
  const priceArr = body.prices ?? [];
  const volArr = body.total_volumes ?? [];

  const closeByDate = new Map<string, number>();
  for (const [tsMs, price] of priceArr) {
    closeByDate.set(toDateStr(new Date(tsMs)), price);
  }
  const volByDate = new Map<string, number>();
  for (const [tsMs, vol] of volArr) {
    volByDate.set(toDateStr(new Date(tsMs)), vol);
  }

  const dates = [...closeByDate.keys()].sort();
  const out: TokenPrice[] = [];
  let prevClose: number | null = null;
  for (const date of dates) {
    const close = closeByDate.get(date) as number;
    const open = prevClose ?? close;
    out.push({
      date,
      token_id: coingeckoId,
      open,
      high: Math.max(open, close),
      low: Math.min(open, close),
      close,
      volume: volByDate.get(date) ?? 0
    });
    prevClose = close;
  }
  return out;
}
