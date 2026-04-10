"""Binance OHLCV data fetcher.

Downloads historical K-line data from Binance public API.
No API key required for historical data.

Usage:
    python -m src.data.fetch --pairs BTCUSDT,ETHUSDT --interval 15m --days 365
"""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pandas as pd

from src.config import get

log = logging.getLogger("kronos.data")
BASE_URL = "https://api.binance.com"
RAW_DIR = Path(__file__).parent.parent.parent / "data" / "raw"


def fetch_klines(
    pair: str,
    interval: str = "15m",
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int = 1000,
) -> pd.DataFrame:
    """Fetch K-lines from Binance public API.

    Returns DataFrame with columns: timestamp, open, high, low, close, volume, amount
    """
    if start is None:
        start = datetime.now(timezone.utc) - timedelta(days=30)
    if end is None:
        end = datetime.now(timezone.utc)

    all_rows = []
    current_start = int(start.timestamp() * 1000)
    end_ms = int(end.timestamp() * 1000)

    with httpx.Client(timeout=30.0) as client:
        while current_start < end_ms:
            params = {
                "symbol": pair,
                "interval": interval,
                "startTime": current_start,
                "endTime": end_ms,
                "limit": limit,
            }

            resp = client.get(f"{BASE_URL}/api/v3/klines", params=params)
            resp.raise_for_status()
            data = resp.json()

            if not data:
                break

            for k in data:
                all_rows.append({
                    "timestamp": pd.Timestamp(k[0], unit="ms", tz="UTC"),
                    "open": float(k[1]),
                    "high": float(k[2]),
                    "low": float(k[3]),
                    "close": float(k[4]),
                    "volume": float(k[5]),
                    "amount": float(k[7]),  # quote asset volume ≈ turnover
                })

            # Move start to after last candle
            current_start = data[-1][0] + 1

            # Rate limit
            time.sleep(0.2)

    df = pd.DataFrame(all_rows)
    if not df.empty:
        df = df.drop_duplicates(subset="timestamp").sort_values("timestamp").reset_index(drop=True)

    log.info("%s: fetched %d candles (%s)", pair, len(df), interval)
    return df


def save_pair(df: pd.DataFrame, pair: str, interval: str) -> Path:
    """Save pair data to parquet."""
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    path = RAW_DIR / f"{pair}_{interval}.parquet"
    df.to_parquet(path, index=False)
    log.info("Saved → %s", path)
    return path


def load_pair(pair: str, interval: str) -> pd.DataFrame:
    """Load pair data from parquet."""
    path = RAW_DIR / f"{pair}_{interval}.parquet"
    if not path.exists():
        raise FileNotFoundError(f"No data for {pair}. Run: python -m src.data.fetch --pairs {pair}")
    return pd.read_parquet(path)


def fetch_and_save(
    pairs: list[str] | None = None,
    interval: str | None = None,
    days: int = 365,
):
    """Fetch and save historical data for multiple pairs."""
    _pairs = pairs or get("trading", "pairs", ["BTCUSDT", "ETHUSDT"])
    _interval = interval or get("trading", "interval", "15m")
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days)

    for pair in _pairs:
        try:
            df = fetch_klines(pair, _interval, start, end)
            if not df.empty:
                save_pair(df, pair, _interval)
        except Exception as e:
            log.error("Failed %s: %s", pair, e)


# --- CLI ---


def main():
    import argparse
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    parser = argparse.ArgumentParser(description="Fetch Binance OHLCV data")
    parser.add_argument("--pairs", type=str, default="BTCUSDT,ETHUSDT,SOLUSDT")
    parser.add_argument("--interval", type=str, default="15m")
    parser.add_argument("--days", type=int, default=365)
    args = parser.parse_args()

    pairs = [p.strip() for p in args.pairs.split(",")]
    fetch_and_save(pairs, args.interval, args.days)


if __name__ == "__main__":
    main()
