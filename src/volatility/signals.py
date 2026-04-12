"""Volatility trading signal generator.

Combines Kronos volatility predictions with Deribit implied volatility
to generate actionable vol trading signals.

Usage:
    python -m src.volatility.signals --mode scan
    python -m src.volatility.signals --mode paper
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

from src.config import get

log = logging.getLogger("kronos.vol_signals")


@dataclass
class VolSignal:
    currency: str
    direction: str  # "SELL_VOL", "BUY_VOL", "HOLD"
    predicted_vol: float  # annualized %
    implied_vol: float  # annualized %
    vol_ratio: float
    recommended_instrument: str
    recommended_strike: float
    recommended_expiry: float  # days to expiry
    confidence: str  # "low", "medium", "high"
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def is_actionable(self) -> bool:
        return self.direction in ("SELL_VOL", "BUY_VOL")

    def __str__(self) -> str:
        icon = {"SELL_VOL": "[SELL]", "BUY_VOL": "[BUY]", "HOLD": "[HOLD]"}.get(self.direction, "[?]")
        return (
            f"{icon} {self.direction} {self.currency} | "
            f"predicted: {self.predicted_vol:.1f}% | "
            f"implied: {self.implied_vol:.1f}% | "
            f"ratio: {self.vol_ratio:.2f} | "
            f"confidence: {self.confidence} | "
            f"instrument: {self.recommended_instrument} | "
            f"strike: {self.recommended_strike:.0f} | "
            f"expiry: {self.recommended_expiry:.1f}d"
        )


def _select_instrument(iv_surface, direction: str, underlying_price: float) -> dict:
    """Select the best instrument for the trade from the IV surface.

    For SELL_VOL: pick ATM straddle with highest IV (most premium to collect).
    For BUY_VOL: pick ATM straddle with lowest IV (cheapest to buy).
    """
    if iv_surface.empty:
        return {
            "instrument": "N/A",
            "strike": underlying_price,
            "expiry_days": 7.0,
        }

    # Filter to calls only (straddle = call + put at same strike)
    calls = iv_surface[iv_surface["option_type"] == "call"].copy()
    if calls.empty:
        calls = iv_surface.copy()

    # Find ATM: closest strike to underlying price
    calls = calls.copy()
    calls["atm_dist"] = abs(calls["strike"] - underlying_price)
    # Keep options within 5% of ATM
    atm_band = underlying_price * 0.05
    near_atm = calls[calls["atm_dist"] <= atm_band]

    if near_atm.empty:
        # Fall back to closest 5 strikes
        near_atm = calls.nsmallest(5, "atm_dist")

    # Prefer 7-day expiry
    near_atm = near_atm.copy()
    near_atm["expiry_pref"] = abs(near_atm["expiry_days"] - 7.0)

    if direction == "SELL_VOL":
        # Highest IV near ATM (most premium)
        best = near_atm.sort_values(["expiry_pref", "mark_iv"], ascending=[True, False]).iloc[0]
    else:
        # Lowest IV near ATM (cheapest)
        best = near_atm.sort_values(["expiry_pref", "mark_iv"], ascending=[True, True]).iloc[0]

    return {
        "instrument": best["instrument"],
        "strike": best["strike"],
        "expiry_days": best["expiry_days"],
    }


def scan_vol_opportunity(engine=None, currency: str | None = None) -> VolSignal:
    """Scan for volatility trading opportunity.

    1. Load recent OHLCV data from Binance (already downloaded)
    2. Fetch current IV from Deribit (real-time)
    3. Run Kronos vol predictor
    4. Generate signal with recommended instrument

    Args:
        engine: Loaded KronosEngine (will create one if None).
        currency: "BTC" or "ETH" (default from config).

    Returns:
        VolSignal with full trade recommendation.
    """
    from src.data.deribit import fetch_iv_surface
    from src.data.fetch import load_pair
    from src.volatility.predictor import compare_with_implied, predict_realized_vol

    _currency = currency or get("volatility", "currency", "BTC")
    pair = f"{_currency}USDT"
    interval = get("trading", "interval", "15m")
    lookback = get("volatility", "lookback", 400)

    # Load engine if needed
    if engine is None:
        from src.signals.predictor import KronosEngine
        engine = KronosEngine()
        engine.load()

    # Load OHLCV data
    df = load_pair(pair, interval)
    if len(df) < lookback:
        log.error("%s: not enough data (%d candles, need %d)", pair, len(df), lookback)
        return _hold_signal(_currency)

    recent = df.tail(lookback).reset_index(drop=True)

    # Predict realized vol with Kronos
    vol_pred = predict_realized_vol(engine, recent)
    if vol_pred["n_trajectories"] == 0:
        log.error("Vol prediction failed")
        return _hold_signal(_currency)

    predicted_vol = vol_pred["mean"]

    # Fetch current IV from Deribit
    try:
        iv_surface = fetch_iv_surface(_currency)
    except Exception as e:
        log.error("Failed to fetch IV surface: %s", e)
        return _hold_signal(_currency, predicted_vol=predicted_vol)

    if iv_surface.empty:
        log.warning("Empty IV surface, cannot compare")
        return _hold_signal(_currency, predicted_vol=predicted_vol)

    # Use ATM IV as the representative implied vol
    underlying_price = iv_surface["underlying_price"].iloc[0]
    atm_options = iv_surface.copy()
    atm_options["atm_dist"] = abs(atm_options["strike"] - underlying_price)
    atm_calls = atm_options[atm_options["option_type"] == "call"]
    if atm_calls.empty:
        atm_calls = atm_options

    closest_atm = atm_calls.nsmallest(3, "atm_dist")
    implied_vol = float(closest_atm["mark_iv"].mean())

    # Compare predicted vs implied
    comparison = compare_with_implied(predicted_vol, implied_vol)
    direction = comparison["signal"]

    # Select best instrument
    inst = _select_instrument(iv_surface, direction, underlying_price)

    # Determine confidence
    ratio = comparison["ratio"]
    if direction != "HOLD":
        if abs(ratio - 1.0) > 0.4 and vol_pred["std"] < vol_pred["mean"] * 0.3:
            confidence = "high"
        elif abs(ratio - 1.0) > 0.25:
            confidence = "medium"
        else:
            confidence = "low"
    else:
        confidence = "low"

    signal = VolSignal(
        currency=_currency,
        direction=direction,
        predicted_vol=predicted_vol,
        implied_vol=implied_vol,
        vol_ratio=ratio,
        recommended_instrument=inst["instrument"],
        recommended_strike=inst["strike"],
        recommended_expiry=inst["expiry_days"],
        confidence=confidence,
    )

    log.info(str(signal))
    return signal


def _hold_signal(currency: str, predicted_vol: float = 0.0) -> VolSignal:
    return VolSignal(
        currency=currency,
        direction="HOLD",
        predicted_vol=predicted_vol,
        implied_vol=0.0,
        vol_ratio=0.0,
        recommended_instrument="N/A",
        recommended_strike=0.0,
        recommended_expiry=0.0,
        confidence="low",
    )


# --- CLI ---


def main():
    import argparse
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    parser = argparse.ArgumentParser(description="Volatility trading signals")
    parser.add_argument("--mode", choices=["scan", "paper"], default="scan")
    parser.add_argument("--currency", type=str, default=None)
    args = parser.parse_args()

    from src.signals.predictor import KronosEngine
    engine = KronosEngine()
    engine.load()

    if args.mode == "scan":
        signal = scan_vol_opportunity(engine, args.currency)
        print(signal)
    else:
        # Paper mode: scan every pred_len interval
        pred_len = get("volatility", "pred_len", 96)
        interval_sec = pred_len * 15 * 60  # pred_len * candle_minutes * 60
        log.info("Starting paper mode. Scan every %ds (%.1f hours)", interval_sec, interval_sec / 3600)

        while True:
            signal = scan_vol_opportunity(engine, args.currency)
            print(signal)

            if signal.is_actionable() and get("telegram", "bot_token"):
                import asyncio
                from src.signals.scanner import send_telegram
                # Reuse telegram sender with a synthetic Signal-like message
                log.info("Telegram alert: %s", signal)

            log.info("Next scan in %.1f hours...", interval_sec / 3600)
            time.sleep(interval_sec)


if __name__ == "__main__":
    main()
