"""Deribit options data fetcher.

Downloads option instruments, implied volatility surface, DVOL index history,
and historical realized volatility from Deribit public API.
No API key required for market data.

Usage:
    python -m src.data.deribit --action instruments --currency BTC
    python -m src.data.deribit --action iv-surface --currency BTC
    python -m src.data.deribit --action dvol-history --currency BTC --days 365
    python -m src.data.deribit --action all --currency BTC
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pandas as pd

from src.config import get

log = logging.getLogger("kronos.deribit")

BASE_URL = "https://www.deribit.com/api/v2/public"
DERIBIT_DIR = Path(__file__).parent.parent.parent / "data" / "raw" / "deribit"

MAX_RETRIES = 3
RATE_LIMIT_SLEEP = 0.5


def _request(endpoint: str, params: dict | None = None) -> dict:
    """Make a GET request to Deribit public API with retries and rate limiting."""
    url = f"{BASE_URL}/{endpoint}"
    for attempt in range(MAX_RETRIES):
        try:
            with httpx.Client(timeout=30.0) as client:
                resp = client.get(url, params=params or {})
                resp.raise_for_status()
                data = resp.json()
                if "result" not in data:
                    raise ValueError(f"Unexpected response: {data}")
                time.sleep(RATE_LIMIT_SLEEP)
                return data["result"]
        except (httpx.HTTPError, httpx.ConnectError) as e:
            log.warning("Request failed (attempt %d/%d): %s", attempt + 1, MAX_RETRIES, e)
            if attempt < MAX_RETRIES - 1:
                time.sleep(2 ** attempt)
            else:
                raise


def fetch_instruments(currency: str = "BTC", min_days: int = 1, max_days: int = 30) -> pd.DataFrame:
    """Fetch active option instruments filtered by expiry range.

    Returns DataFrame with columns:
        instrument_name, strike, option_type, expiration_timestamp,
        expiry_days, creation_timestamp, min_trade_amount
    """
    data = _request("get_instruments", {
        "currency": currency,
        "kind": "option",
        "expired": "false",
    })

    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    min_ms = now_ms + min_days * 86400 * 1000
    max_ms = now_ms + max_days * 86400 * 1000

    rows = []
    for inst in data:
        exp_ts = inst["expiration_timestamp"]
        if exp_ts < min_ms or exp_ts > max_ms:
            continue

        expiry_days = (exp_ts - now_ms) / (86400 * 1000)
        rows.append({
            "instrument_name": inst["instrument_name"],
            "strike": inst["strike"],
            "option_type": inst["option_type"],
            "expiration_timestamp": pd.Timestamp(exp_ts, unit="ms", tz="UTC"),
            "expiry_days": round(expiry_days, 1),
            "creation_timestamp": pd.Timestamp(inst["creation_timestamp"], unit="ms", tz="UTC"),
            "min_trade_amount": inst.get("min_trade_amount", 0),
        })

    df = pd.DataFrame(rows)
    if not df.empty:
        df = df.sort_values(["expiry_days", "strike"]).reset_index(drop=True)

    log.info("%s: found %d option instruments (expiry %d-%d days)", currency, len(df), min_days, max_days)
    return df


def fetch_iv_surface(currency: str = "BTC", min_days: int = 1, max_days: int = 30) -> pd.DataFrame:
    """Build implied volatility surface from order book data.

    For each active option, fetches mark_iv from the order book.

    Returns DataFrame with columns:
        instrument, strike, expiry_days, option_type, mark_iv,
        underlying_price, bid_iv, ask_iv
    """
    instruments = fetch_instruments(currency, min_days, max_days)
    if instruments.empty:
        log.warning("No instruments found for IV surface")
        return pd.DataFrame()

    rows = []
    total = len(instruments)
    for idx, inst in instruments.iterrows():
        name = inst["instrument_name"]
        try:
            book = _request("get_order_book", {"instrument_name": name})
            rows.append({
                "instrument": name,
                "strike": inst["strike"],
                "expiry_days": inst["expiry_days"],
                "option_type": inst["option_type"],
                "mark_iv": book.get("mark_iv", 0.0),
                "underlying_price": book.get("underlying_price", 0.0),
                "bid_iv": book.get("bid_iv", 0.0),
                "ask_iv": book.get("ask_iv", 0.0),
            })
        except Exception as e:
            log.warning("Failed to fetch order book for %s: %s", name, e)

        if (idx + 1) % 20 == 0:
            log.info("  IV surface: %d/%d instruments fetched", idx + 1, total)

    df = pd.DataFrame(rows)
    if not df.empty:
        df = df.sort_values(["expiry_days", "strike"]).reset_index(drop=True)

    log.info("%s: IV surface built with %d options", currency, len(df))
    return df


def fetch_dvol_history(currency: str = "BTC", days: int = 365) -> pd.DataFrame:
    """Download DVOL index (implied volatility index) historical data.

    Paginates through Deribit's 1000-record limit to get full history.

    Returns DataFrame with columns: timestamp, open, high, low, close
    """
    end_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    start_ms = end_ms - days * 86400 * 1000
    resolution = 3600  # 1 hour in seconds
    chunk_ms = 1000 * resolution * 1000  # 1000 candles worth of ms

    all_rows = []
    current_start = start_ms

    while current_start < end_ms:
        current_end = min(current_start + chunk_ms, end_ms)

        data = _request("get_volatility_index_data", {
            "currency": currency,
            "start_timestamp": current_start,
            "end_timestamp": current_end,
            "resolution": str(resolution),
        })

        candles = data
        if isinstance(data, dict) and "data" in data:
            candles = data["data"]

        if not candles:
            current_start = current_end + 1
            continue

        for candle in candles:
            all_rows.append({
                "timestamp": pd.Timestamp(candle[0], unit="ms", tz="UTC"),
                "open": float(candle[1]),
                "high": float(candle[2]),
                "low": float(candle[3]),
                "close": float(candle[4]),
            })

        # Move to after the last candle
        last_ts = candles[-1][0]
        current_start = last_ts + resolution * 1000

        log.info("  DVOL chunk: %d candles (up to %s)", len(candles),
                 pd.Timestamp(last_ts, unit="ms", tz="UTC").strftime("%Y-%m-%d"))

    df = pd.DataFrame(all_rows)
    if not df.empty:
        df = df.drop_duplicates(subset="timestamp").sort_values("timestamp").reset_index(drop=True)

    log.info("%s DVOL: fetched %d data points (%d days)", currency, len(df), days)
    return df


def fetch_historical_vol(currency: str = "BTC") -> pd.DataFrame:
    """Download historical realized volatility published by Deribit.

    Returns DataFrame with columns: timestamp, volatility
    """
    data = _request("get_historical_volatility", {"currency": currency})

    rows = []
    for entry in data:
        rows.append({
            "timestamp": pd.Timestamp(int(entry[0]), unit="ms", tz="UTC"),
            "volatility": float(entry[1]),
        })

    df = pd.DataFrame(rows)
    if not df.empty:
        df = df.sort_values("timestamp").reset_index(drop=True)

    log.info("%s: fetched %d historical volatility entries", currency, len(df))
    return df


# --- Save / Load helpers ---


def save_df(df: pd.DataFrame, name: str, currency: str) -> Path:
    """Save DataFrame to parquet in data/raw/deribit/."""
    DERIBIT_DIR.mkdir(parents=True, exist_ok=True)
    path = DERIBIT_DIR / f"{currency}_{name}.parquet"
    df.to_parquet(path, index=False)
    log.info("Saved -> %s", path)
    return path


def load_df(name: str, currency: str) -> pd.DataFrame:
    """Load DataFrame from parquet."""
    path = DERIBIT_DIR / f"{currency}_{name}.parquet"
    if not path.exists():
        raise FileNotFoundError(
            f"No data for {currency} {name}. Run: python -m src.data.deribit --action all --currency {currency}"
        )
    return pd.read_parquet(path)


# --- CLI ---


def main():
    import argparse
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    parser = argparse.ArgumentParser(description="Fetch Deribit options data")
    parser.add_argument("--action", choices=["instruments", "iv-surface", "dvol-history", "hist-vol", "all"],
                        default="all")
    parser.add_argument("--currency", type=str, default="BTC")
    parser.add_argument("--days", type=int, default=365)
    args = parser.parse_args()

    actions = [args.action] if args.action != "all" else ["instruments", "iv-surface", "dvol-history", "hist-vol"]

    for action in actions:
        try:
            if action == "instruments":
                df = fetch_instruments(args.currency)
                if not df.empty:
                    save_df(df, "instruments", args.currency)
                    print(df.to_string(index=False, max_rows=20))

            elif action == "iv-surface":
                df = fetch_iv_surface(args.currency)
                if not df.empty:
                    save_df(df, "iv_surface", args.currency)
                    print(df.to_string(index=False, max_rows=20))

            elif action == "dvol-history":
                df = fetch_dvol_history(args.currency, days=args.days)
                if not df.empty:
                    save_df(df, "dvol", args.currency)
                    print(f"DVOL history: {len(df)} rows, range {df['timestamp'].min()} to {df['timestamp'].max()}")

            elif action == "hist-vol":
                df = fetch_historical_vol(args.currency)
                if not df.empty:
                    save_df(df, "hist_vol", args.currency)
                    print(f"Historical vol: {len(df)} rows")

        except Exception as e:
            log.error("Failed action '%s': %s", action, e)


if __name__ == "__main__":
    main()
