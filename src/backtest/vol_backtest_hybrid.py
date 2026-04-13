"""Hybrid volatility backtest: always-sell-vol with Kronos as risk filter.

Strategy:
- Default action at each step: SELL_VOL (the baseline that already wins).
- BUT skip the trade when Kronos predicts vol >> implied
  (predicted/implied >= risk_filter_ratio, default 1.3).
- The hypothesis: Kronos cannot beat always-sell on average, but it can
  identify the rare regimes where shorting vol is dangerous, reducing
  drawdown without sacrificing too much return.

Reports the hybrid against the pure always-sell baseline, and breaks down
the filtered trades (would they have been winners or losers?) so we know
if Kronos is filtering the right ones.

Usage:
    python -m src.backtest.vol_backtest_hybrid --currency BTC --filter 1.3
"""
from __future__ import annotations

import json
import logging
import math
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd
from tqdm import tqdm

from src.backtest.vol_backtest import (
    VolTrade,
    _compute_realized_vol,
    _interpolate_dvol,
)
from src.config import get

log = logging.getLogger("kronos.vol_backtest_hybrid")


@dataclass
class HybridResult:
    currency: str
    risk_filter_ratio: float

    # Hybrid (always-sell with Kronos filter)
    hybrid_trades: int = 0
    hybrid_pnl: float = 0.0
    hybrid_win_rate: float = 0.0
    hybrid_sharpe: float = 0.0
    hybrid_max_dd: float = 0.0
    hybrid_final_capital: float = 0.0

    # Pure baseline (always sell, no filter)
    baseline_trades: int = 0
    baseline_pnl: float = 0.0
    baseline_win_rate: float = 0.0
    baseline_sharpe: float = 0.0
    baseline_max_dd: float = 0.0
    baseline_final_capital: float = 0.0

    # Filter analysis
    filtered_count: int = 0
    filtered_would_be_winners: int = 0
    filtered_would_be_losers: int = 0
    filtered_avoided_pnl: float = 0.0  # negative = saved money, positive = lost opportunity

    initial_capital: float = 0.0

    def summary(self) -> str:
        ic = self.initial_capital
        h_roi = (self.hybrid_final_capital - ic) / ic * 100 if ic > 0 else 0
        b_roi = (self.baseline_final_capital - ic) / ic * 100 if ic > 0 else 0

        filter_correct = (
            self.filtered_would_be_losers / self.filtered_count
            if self.filtered_count > 0 else 0
        )

        delta_pnl = self.hybrid_pnl - self.baseline_pnl
        delta_dd = self.baseline_max_dd - self.hybrid_max_dd  # positive = hybrid better

        return (
            f"\n{'='*70}\n"
            f"  HYBRID VOL BACKTEST: {self.currency} (filter ratio = {self.risk_filter_ratio})\n"
            f"{'='*70}\n"
            f"  HYBRID (always-sell + Kronos risk filter):\n"
            f"    Capital:       ${ic:.2f} -> ${self.hybrid_final_capital:.2f} ({h_roi:+.1f}%)\n"
            f"    Net P&L:       ${self.hybrid_pnl:+.2f}\n"
            f"    Trades:        {self.hybrid_trades}\n"
            f"    Win rate:      {self.hybrid_win_rate:.1%}\n"
            f"    Sharpe:        {self.hybrid_sharpe:.2f}\n"
            f"    Max drawdown:  ${self.hybrid_max_dd:.2f}\n"
            f"{'-'*70}\n"
            f"  PURE BASELINE (always-sell, no filter):\n"
            f"    Capital:       ${ic:.2f} -> ${self.baseline_final_capital:.2f} ({b_roi:+.1f}%)\n"
            f"    Net P&L:       ${self.baseline_pnl:+.2f}\n"
            f"    Trades:        {self.baseline_trades}\n"
            f"    Win rate:      {self.baseline_win_rate:.1%}\n"
            f"    Sharpe:        {self.baseline_sharpe:.2f}\n"
            f"    Max drawdown:  ${self.baseline_max_dd:.2f}\n"
            f"{'-'*70}\n"
            f"  HYBRID vs BASELINE:\n"
            f"    Delta P&L:     ${delta_pnl:+.2f}  ({'HYBRID better' if delta_pnl > 0 else 'BASELINE better'})\n"
            f"    Delta MaxDD:   ${delta_dd:+.2f}  ({'HYBRID lower DD' if delta_dd > 0 else 'BASELINE lower DD'})\n"
            f"{'-'*70}\n"
            f"  FILTER ANALYSIS (Kronos blocked these trades):\n"
            f"    Filtered:      {self.filtered_count} trades\n"
            f"    Would be W:    {self.filtered_would_be_winners}\n"
            f"    Would be L:    {self.filtered_would_be_losers}\n"
            f"    Filter precision (% of blocks that were losers): {filter_correct:.1%}\n"
            f"    Avoided P&L:   ${self.filtered_avoided_pnl:+.2f}  "
            f"({'saved money' if self.filtered_avoided_pnl < 0 else 'missed gains'})\n"
            f"{'='*70}"
        )


def _metrics(pnls: list[float], initial: float) -> dict:
    """Compute equity curve, final capital, max DD, sharpe, win rate."""
    capital = initial
    equity = [capital]
    for p in pnls:
        capital += p
        equity.append(capital)

    peak = equity[0]
    max_dd = 0.0
    for v in equity:
        peak = max(peak, v)
        max_dd = max(max_dd, peak - v)

    arr = np.array(pnls) if pnls else np.array([0.0])
    sharpe = 0.0
    if len(pnls) > 1 and np.std(arr) > 0:
        sharpe = float(np.mean(arr) / np.std(arr) * np.sqrt(len(arr)))

    winners = sum(1 for p in pnls if p > 0)
    win_rate = winners / len(pnls) if pnls else 0.0

    return {
        "final_capital": capital,
        "max_dd": max_dd,
        "sharpe": sharpe,
        "win_rate": win_rate,
        "winners": winners,
    }


def run_hybrid_backtest(
    currency: str = "BTC",
    engine=None,
    risk_filter_ratio: float = 1.3,
    lookback: int | None = None,
    pred_len: int | None = None,
    n_trajectories: int | None = None,
    step_size_hours: int | None = None,
    hold_days: int | None = None,
    initial_capital: float | None = None,
    notional: float | None = None,
    days: int | None = None,
) -> HybridResult:
    """Walk-forward hybrid vol backtest.

    At each step:
      1. Compute realized vol over the next hold_days (for evaluation).
      2. Build the baseline trade (always SELL_VOL).
      3. Predict vol with Kronos.
      4. If predicted/implied >= risk_filter_ratio → SKIP (filter triggers).
         Otherwise → keep the trade (sell vol).
      5. Track which filtered trades would have been winners vs losers.
    """
    from src.data.deribit import load_df
    from src.data.fetch import load_pair
    from src.volatility.predictor import predict_realized_vol

    _lookback = lookback or get("volatility", "lookback", 400)
    _pred_len = pred_len or get("volatility", "pred_len", 96)
    _n_traj = n_trajectories or get("volatility", "n_trajectories", 20)
    _step_hours = step_size_hours or get("volatility", "step_size_hours", 24)
    _hold_days = hold_days or get("volatility", "hold_days", 7)
    _capital = initial_capital or get("volatility", "initial_capital", 2000.0)
    _notional = notional or get("volatility", "notional", 1000.0)

    pair = f"{currency}USDT"
    interval = get("trading", "interval", "15m")
    step_candles = _step_hours * 4
    hold_candles = _hold_days * 24 * 4

    # Load data
    ohlcv = load_pair(pair, interval)
    try:
        dvol = load_df("dvol", currency)
    except FileNotFoundError:
        log.error("DVOL data not found for %s", currency)
        return HybridResult(currency=currency, risk_filter_ratio=risk_filter_ratio,
                            initial_capital=_capital, hybrid_final_capital=_capital,
                            baseline_final_capital=_capital)

    if len(ohlcv) < _lookback + hold_candles + step_candles:
        log.error("Not enough OHLCV data")
        return HybridResult(currency=currency, risk_filter_ratio=risk_filter_ratio,
                            initial_capital=_capital, hybrid_final_capital=_capital,
                            baseline_final_capital=_capital)

    dvol_start = dvol["timestamp"].min()
    dvol_end = dvol["timestamp"].max()
    ohlcv_in_range = ohlcv[
        (ohlcv["timestamp"] >= dvol_start) & (ohlcv["timestamp"] <= dvol_end)
    ].reset_index(drop=True)

    if len(ohlcv_in_range) < _lookback + hold_candles:
        log.warning("Limited overlap, falling back to full OHLCV")
        ohlcv_in_range = ohlcv

    # Trim to last `days` if requested (most recent N days)
    if days is not None and days > 0:
        cutoff = ohlcv_in_range["timestamp"].max() - pd.Timedelta(days=days)
        trimmed = ohlcv_in_range[ohlcv_in_range["timestamp"] >= cutoff].reset_index(drop=True)
        if len(trimmed) >= _lookback + hold_candles:
            ohlcv_in_range = trimmed
            log.info("Trimmed to last %d days: %d candles", days, len(ohlcv_in_range))
        else:
            log.warning("Requested %d days but not enough data after trim, using full range", days)

    start_idx = _lookback
    end_idx = len(ohlcv_in_range) - hold_candles
    total_steps = max(0, (end_idx - start_idx) // step_candles)

    log.info(
        "%s hybrid backtest: %d steps | filter_ratio=%.2f | pred_len=%d, traj=%d",
        currency, total_steps, risk_filter_ratio, _pred_len, _n_traj,
    )

    if total_steps == 0:
        return HybridResult(currency=currency, risk_filter_ratio=risk_filter_ratio,
                            initial_capital=_capital, hybrid_final_capital=_capital,
                            baseline_final_capital=_capital)

    # --- Checkpoint setup ---
    ckpt_dir = Path(__file__).parent.parent.parent / "data" / "checkpoints"
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    ckpt_path = ckpt_dir / f"hybrid_{currency}_{risk_filter_ratio}_{days or 'full'}.json"

    baseline_pnls: list[float] = []
    hybrid_pnls: list[float] = []
    filtered_pnls: list[float] = []
    resume_step = 0

    if ckpt_path.exists():
        try:
            ck = json.loads(ckpt_path.read_text())
            resume_step = ck["step"]
            baseline_pnls = ck["baseline_pnls"]
            hybrid_pnls = ck["hybrid_pnls"]
            filtered_pnls = ck["filtered_pnls"]
            log.info("RESUMED from checkpoint %s at step %d", ckpt_path.name, resume_step)
        except Exception as e:
            log.warning("Failed to read checkpoint %s: %s (starting fresh)", ckpt_path, e)
            resume_step = 0

    for step, i in enumerate(tqdm(range(start_idx, end_idx, step_candles), total=total_steps, desc=currency)):
        if step < resume_step:
            continue

        t_step = time.time()
        current_ts = ohlcv_in_range.iloc[i]["timestamp"]
        implied_vol = _interpolate_dvol(dvol, current_ts)
        if implied_vol <= 0:
            continue

        window = ohlcv_in_range.iloc[i - _lookback : i].reset_index(drop=True)
        underlying_price = float(window.iloc[-1]["close"])

        # Realized vol over hold period (ground truth for evaluation)
        future_closes = ohlcv_in_range.iloc[i : i + hold_candles]["close"].values
        realized_vol = _compute_realized_vol(future_closes)

        # Predict with Kronos — verbose timing to catch freezes
        t_pred = time.time()
        log.info("[step %d/%d] pred start ts=%s", step + 1, total_steps, current_ts)
        try:
            vol_pred = predict_realized_vol(
                engine, window,
                pred_len=_pred_len,
                n_trajectories=_n_traj,
            )
        except Exception as e:
            log.warning("Step %d/%d prediction failed: %s", step + 1, total_steps, e)
            continue
        pred_elapsed = time.time() - t_pred
        log.info("[step %d/%d] pred done in %.2fs", step + 1, total_steps, pred_elapsed)

        if vol_pred["n_trajectories"] == 0:
            continue

        predicted_vol = vol_pred["mean"]
        ratio = predicted_vol / implied_vol if implied_vol > 0 else 0

        baseline_trade = VolTrade(
            currency=currency,
            direction="SELL_VOL",
            entry_idx=i,
            exit_idx=i + hold_candles,
            predicted_vol=predicted_vol,
            implied_vol=implied_vol,
            realized_vol=realized_vol,
            underlying_price=underlying_price,
            notional=_notional,
            hold_days=_hold_days,
        )
        baseline_pnls.append(baseline_trade.net_pnl)

        # Filter logic
        if ratio >= risk_filter_ratio:
            filtered_pnls.append(baseline_trade.net_pnl)
        else:
            hybrid_pnls.append(baseline_trade.net_pnl)

        # Checkpoint every 10 steps — cheap, negligible I/O
        if (step + 1) % 10 == 0:
            try:
                ckpt_path.write_text(json.dumps({
                    "step": step + 1,
                    "baseline_pnls": baseline_pnls,
                    "hybrid_pnls": hybrid_pnls,
                    "filtered_pnls": filtered_pnls,
                }))
            except Exception as e:
                log.warning("Checkpoint write failed: %s", e)

        if (step + 1) % 50 == 0:
            log.info(
                "  Step %d/%d | hybrid trades: %d | filtered: %d | hybrid P&L: $%.2f | step_time=%.1fs",
                step + 1, total_steps, len(hybrid_pnls), len(filtered_pnls),
                sum(hybrid_pnls), time.time() - t_step,
            )

    # Clean up checkpoint on successful completion
    if ckpt_path.exists():
        try:
            ckpt_path.unlink()
        except Exception:
            pass

    # Aggregate
    h = _metrics(hybrid_pnls, _capital)
    b = _metrics(baseline_pnls, _capital)

    filtered_winners = sum(1 for p in filtered_pnls if p > 0)
    filtered_losers = sum(1 for p in filtered_pnls if p <= 0)

    return HybridResult(
        currency=currency,
        risk_filter_ratio=risk_filter_ratio,
        hybrid_trades=len(hybrid_pnls),
        hybrid_pnl=sum(hybrid_pnls),
        hybrid_win_rate=h["win_rate"],
        hybrid_sharpe=h["sharpe"],
        hybrid_max_dd=h["max_dd"],
        hybrid_final_capital=h["final_capital"],
        baseline_trades=len(baseline_pnls),
        baseline_pnl=sum(baseline_pnls),
        baseline_win_rate=b["win_rate"],
        baseline_sharpe=b["sharpe"],
        baseline_max_dd=b["max_dd"],
        baseline_final_capital=b["final_capital"],
        filtered_count=len(filtered_pnls),
        filtered_would_be_winners=filtered_winners,
        filtered_would_be_losers=filtered_losers,
        filtered_avoided_pnl=sum(filtered_pnls),
        initial_capital=_capital,
    )


# --- CLI ---


def main():
    import argparse
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    parser = argparse.ArgumentParser(description="Hybrid vol backtest: always-sell + Kronos risk filter")
    parser.add_argument("--currency", type=str, default="BTC")
    parser.add_argument("--filter", type=float, default=1.3,
                        help="Risk filter ratio: skip trade when predicted/implied >= this")
    parser.add_argument("--days", type=int, default=None,
                        help="Limit backtest to last N days (default: all available data)")
    parser.add_argument("--trajectories", type=int, default=None)
    args = parser.parse_args()

    from src.signals.predictor import KronosEngine
    engine = KronosEngine()
    engine.load()

    result = run_hybrid_backtest(
        currency=args.currency,
        engine=engine,
        risk_filter_ratio=args.filter,
        n_trajectories=args.trajectories,
        days=args.days,
    )
    print(result.summary())

    # Verdict
    delta_pnl = result.hybrid_pnl - result.baseline_pnl
    delta_dd = result.baseline_max_dd - result.hybrid_max_dd

    if delta_pnl >= 0 and delta_dd > 0:
        print("\n[OK] Hybrid wins on BOTH dimensions: more P&L AND lower drawdown.")
    elif delta_dd > 0 and delta_pnl > -0.2 * abs(result.baseline_pnl):
        print("\n[OK] Hybrid reduces drawdown with acceptable P&L cost (<20%). Worth deploying.")
    elif delta_pnl > 0:
        print("\n[~] Hybrid has more P&L but doesn't reduce drawdown. Marginal win.")
    else:
        print("\n[X] Hybrid does not improve over pure baseline. Kronos filter is not adding value.")


if __name__ == "__main__":
    main()
