"""Volatility predictor using Kronos.

Uses multi-trajectory sampling from the Kronos foundation model to predict
future realized volatility, then compares it against market implied volatility
from Deribit to find mispricing.

The core insight: if Kronos predicts low future realized vol but the market
is pricing high implied vol, options are expensive -> sell vol. And vice versa.

Usage:
    from src.volatility.predictor import predict_realized_vol, compare_with_implied
    vol = predict_realized_vol(engine, df, pred_len=96, n_trajectories=20)
    signal = compare_with_implied(vol["mean"], implied_vol=65.0)
"""
from __future__ import annotations

import logging
import math

import numpy as np
import pandas as pd

from src.config import get

log = logging.getLogger("kronos.volatility")

# For 15-minute candles: 365.25 days * 24 hours * 4 candles/hour
PERIODS_PER_YEAR_15M = 365.25 * 24 * 4  # 35064


def predict_realized_vol(
    engine,
    df: pd.DataFrame,
    pred_len: int | None = None,
    n_trajectories: int | None = None,
    temperature: float | None = None,
    top_p: float | None = None,
) -> dict:
    """Predict future realized volatility using Kronos multi-trajectory sampling.

    For each trajectory, Kronos generates a possible future price path.
    We compute realized volatility on each path using log returns,
    then aggregate across trajectories for a distributional estimate.

    Args:
        engine: Loaded KronosEngine instance.
        df: OHLCV DataFrame (at least [open, high, low, close]).
        pred_len: Number of future candles to predict (default: 96 = 24h of 15m candles).
        n_trajectories: Number of independent trajectory samples.
        temperature: Sampling temperature (0.9 recommended for vol prediction).
        top_p: Nucleus sampling threshold.

    Returns:
        dict with:
            - mean: mean annualized vol across trajectories (%)
            - std: std of vol estimates (%)
            - p5, p25, p50, p75, p95: percentiles (%)
            - raw_vols: list of individual trajectory vols (%)
            - n_trajectories: number of trajectories sampled
    """
    _pred_len = pred_len or get("volatility", "pred_len", 96)
    _n_traj = n_trajectories or get("volatility", "n_trajectories", 20)
    _temp = temperature or get("volatility", "temperature", 0.9)
    _top_p = top_p or get("volatility", "top_p", 0.9)

    vols = []

    for i in range(_n_traj):
        # Generate one trajectory (sample_count=1 for independent sample)
        pred_df = engine.predict(
            df, pred_len=_pred_len, sample_count=1,
            temperature=_temp, top_p=_top_p,
        )

        # Compute realized vol from predicted close prices
        closes = pred_df["close"].values
        if len(closes) < 2:
            continue

        # Log returns: r_i = ln(close[i+1] / close[i])
        log_returns = np.diff(np.log(closes))

        # Realized variance = sum of squared log returns
        realized_var = np.sum(log_returns ** 2)

        # Annualize: vol = sqrt(realized_var * periods_per_year / pred_len)
        annualized_vol = math.sqrt(realized_var * PERIODS_PER_YEAR_15M / _pred_len) * 100

        vols.append(annualized_vol)

    if not vols:
        log.error("No valid trajectories generated")
        return {
            "mean": 0.0, "std": 0.0,
            "p5": 0.0, "p25": 0.0, "p50": 0.0, "p75": 0.0, "p95": 0.0,
            "raw_vols": [], "n_trajectories": 0,
        }

    vol_arr = np.array(vols)

    result = {
        "mean": float(np.mean(vol_arr)),
        "std": float(np.std(vol_arr)),
        "p5": float(np.percentile(vol_arr, 5)),
        "p25": float(np.percentile(vol_arr, 25)),
        "p50": float(np.percentile(vol_arr, 50)),
        "p75": float(np.percentile(vol_arr, 75)),
        "p95": float(np.percentile(vol_arr, 95)),
        "raw_vols": vols,
        "n_trajectories": len(vols),
    }

    log.info(
        "Predicted vol: mean=%.1f%% std=%.1f%% [p5=%.1f%%, p95=%.1f%%] (%d trajectories)",
        result["mean"], result["std"], result["p5"], result["p95"], result["n_trajectories"],
    )

    return result


def compare_with_implied(
    predicted_vol: float,
    implied_vol: float,
    sell_ratio: float | None = None,
    buy_ratio: float | None = None,
) -> dict:
    """Compare Kronos-predicted vol with market implied vol.

    Args:
        predicted_vol: Annualized realized vol predicted by Kronos (%).
        implied_vol: Annualized implied vol from Deribit (%).
        sell_ratio: Threshold below which options are expensive (default 0.80).
        buy_ratio: Threshold above which options are cheap (default 1.20).

    Returns:
        dict with:
            - signal: "SELL_VOL", "BUY_VOL", or "HOLD"
            - ratio: predicted / implied
            - predicted_vol: the predicted vol
            - implied_vol: the implied vol
            - edge: absolute difference in vol points
    """
    _sell_ratio = sell_ratio or get("volatility", "sell_vol_ratio", 0.80)
    _buy_ratio = buy_ratio or get("volatility", "buy_vol_ratio", 1.20)

    if implied_vol <= 0:
        log.warning("Implied vol is zero or negative, cannot compare")
        return {
            "signal": "HOLD",
            "ratio": 0.0,
            "predicted_vol": predicted_vol,
            "implied_vol": implied_vol,
            "edge": 0.0,
        }

    ratio = predicted_vol / implied_vol

    if ratio < _sell_ratio:
        signal = "SELL_VOL"
    elif ratio > _buy_ratio:
        signal = "BUY_VOL"
    else:
        signal = "HOLD"

    edge = abs(predicted_vol - implied_vol)

    log.info(
        "Vol comparison: predicted=%.1f%% implied=%.1f%% ratio=%.2f -> %s (edge=%.1f%%)",
        predicted_vol, implied_vol, ratio, signal, edge,
    )

    return {
        "signal": signal,
        "ratio": ratio,
        "predicted_vol": predicted_vol,
        "implied_vol": implied_vol,
        "edge": edge,
    }
