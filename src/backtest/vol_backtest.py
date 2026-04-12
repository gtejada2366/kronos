"""Walk-forward volatility backtest.

This is the critical file for the vol strategy. It answers:
"Can Kronos predict vol better than the market?"

Uses DVOL index as a proxy for historical implied volatility, and compares
Kronos predictions against actual realized vol to simulate straddle P&L.

The approximation: for an ATM straddle,
    premium ~= underlying * IV * sqrt(T/365)
    pnl ~= underlying * (realized_vol - IV) * sqrt(T/365) * direction

Where direction is +1 for buy_vol and -1 for sell_vol.

Usage:
    python -m src.backtest.vol_backtest --currency BTC --days 365
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from tqdm import tqdm

from src.config import get

log = logging.getLogger("kronos.vol_backtest")

PERIODS_PER_YEAR_15M = 365.25 * 24 * 4  # 35064


@dataclass
class VolTrade:
    currency: str
    direction: str  # "SELL_VOL" or "BUY_VOL"
    entry_idx: int
    exit_idx: int
    predicted_vol: float  # annualized %
    implied_vol: float  # annualized % (DVOL at entry)
    realized_vol: float  # annualized % (actual, computed at exit)
    underlying_price: float
    notional: float
    hold_days: float

    @property
    def premium(self) -> float:
        """Straddle premium approximation."""
        return self.underlying_price * (self.implied_vol / 100) * math.sqrt(self.hold_days / 365)

    @property
    def gross_pnl(self) -> float:
        """P&L from vol difference."""
        vol_diff = (self.realized_vol - self.implied_vol) / 100
        sqrt_t = math.sqrt(self.hold_days / 365)
        if self.direction == "SELL_VOL":
            # Profit when realized < implied
            return self.notional * (self.implied_vol - self.realized_vol) / 100 * sqrt_t
        else:
            # Profit when realized > implied
            return self.notional * (self.realized_vol - self.implied_vol) / 100 * sqrt_t

    @property
    def net_pnl(self) -> float:
        return self.gross_pnl

    @property
    def vol_prediction_correct(self) -> bool:
        """Did Kronos correctly predict the direction of vol vs market?"""
        if self.direction == "SELL_VOL":
            return self.realized_vol < self.implied_vol
        else:
            return self.realized_vol > self.implied_vol


@dataclass
class VolBacktestResult:
    currency: str
    total_trades: int = 0
    winning_trades: int = 0
    losing_trades: int = 0
    gross_pnl: float = 0.0
    net_pnl: float = 0.0
    win_rate: float = 0.0
    avg_trade_pnl: float = 0.0
    max_drawdown: float = 0.0
    sharpe: float = 0.0
    vol_hit_rate: float = 0.0  # how often Kronos got vol direction right
    initial_capital: float = 0.0
    final_capital: float = 0.0
    # Baseline: always sell vol
    baseline_pnl: float = 0.0
    baseline_win_rate: float = 0.0
    trades: list[VolTrade] = field(default_factory=list)

    def summary(self) -> str:
        roi = (self.final_capital - self.initial_capital) / self.initial_capital * 100 if self.initial_capital > 0 else 0
        baseline_roi = self.baseline_pnl / self.initial_capital * 100 if self.initial_capital > 0 else 0
        return (
            f"\n{'='*65}\n"
            f"  VOL BACKTEST: {self.currency}\n"
            f"{'='*65}\n"
            f"  Capital:         ${self.initial_capital:.2f} -> ${self.final_capital:.2f} ({roi:+.1f}%)\n"
            f"  Net P&L:         ${self.net_pnl:+.2f}\n"
            f"  Trades:          {self.total_trades} ({self.winning_trades}W / {self.losing_trades}L)\n"
            f"  Win rate:        {self.win_rate:.1%}\n"
            f"  Avg trade:       ${self.avg_trade_pnl:+.2f}\n"
            f"  Max drawdown:    ${self.max_drawdown:.2f}\n"
            f"  Sharpe:          {self.sharpe:.2f}\n"
            f"  Vol hit rate:    {self.vol_hit_rate:.1%} (Kronos vol direction accuracy)\n"
            f"{'='*65}\n"
            f"  BASELINE (always sell vol):\n"
            f"  Baseline P&L:    ${self.baseline_pnl:+.2f} ({baseline_roi:+.1f}%)\n"
            f"  Baseline win:    {self.baseline_win_rate:.1%}\n"
            f"{'='*65}"
        )


def _compute_realized_vol(closes: np.ndarray) -> float:
    """Compute annualized realized volatility from close prices.

    Uses log-return squared formula, annualized for 15-minute candles.
    Returns volatility as a percentage.
    """
    if len(closes) < 2:
        return 0.0
    log_returns = np.diff(np.log(closes))
    realized_var = np.sum(log_returns ** 2)
    n_periods = len(log_returns)
    annualized_vol = math.sqrt(realized_var * PERIODS_PER_YEAR_15M / n_periods) * 100
    return annualized_vol


def _interpolate_dvol(dvol_df: pd.DataFrame, target_ts: pd.Timestamp) -> float:
    """Get DVOL value at a specific timestamp by nearest match.

    DVOL is hourly, OHLCV is 15min — find the closest DVOL value.
    Returns DVOL in % (already annualized by Deribit).
    """
    if dvol_df.empty:
        return 0.0

    # Find nearest timestamp
    diffs = abs(dvol_df["timestamp"] - target_ts)
    nearest_idx = diffs.idxmin()
    return float(dvol_df.loc[nearest_idx, "close"])


def run_vol_backtest(
    currency: str = "BTC",
    engine=None,
    lookback: int | None = None,
    pred_len: int | None = None,
    n_trajectories: int | None = None,
    step_size_hours: int | None = None,
    hold_days: int | None = None,
    initial_capital: float | None = None,
    max_position: float | None = None,
    notional: float | None = None,
    sell_ratio: float | None = None,
    buy_ratio: float | None = None,
) -> VolBacktestResult:
    """Walk-forward volatility backtest.

    Steps through historical data, at each point:
    1. Predict future realized vol with Kronos
    2. Compare with DVOL (proxy for IV) at that moment
    3. If discrepancy is large enough, enter vol trade
    4. After hold period, compute actual realized vol and P&L
    """
    from src.data.deribit import load_df
    from src.data.fetch import load_pair
    from src.volatility.predictor import compare_with_implied, predict_realized_vol

    _lookback = lookback or get("volatility", "lookback", 400)
    _pred_len = pred_len or get("volatility", "pred_len", 96)
    _n_traj = n_trajectories or get("volatility", "n_trajectories", 20)
    _step_hours = step_size_hours or get("volatility", "step_size_hours", 24)
    _hold_days = hold_days or get("volatility", "hold_days", 7)
    _capital = initial_capital or get("volatility", "initial_capital", 2000.0)
    _max_pos = max_position or get("volatility", "max_position", 200.0)
    _notional = notional or get("volatility", "notional", 1000.0)
    _sell_ratio = sell_ratio or get("volatility", "sell_vol_ratio", 0.80)
    _buy_ratio = buy_ratio or get("volatility", "buy_vol_ratio", 1.20)

    pair = f"{currency}USDT"
    interval = get("trading", "interval", "15m")

    # Step size in candles (15-min candles)
    step_candles = _step_hours * 4
    # Hold period in candles
    hold_candles = _hold_days * 24 * 4

    # Load data
    ohlcv = load_pair(pair, interval)
    try:
        dvol = load_df("dvol", currency)
    except FileNotFoundError:
        log.error(
            "DVOL data not found. Run: python -m src.data.deribit --action dvol-history --currency %s",
            currency,
        )
        return VolBacktestResult(currency=currency, initial_capital=_capital, final_capital=_capital)

    if len(ohlcv) < _lookback + hold_candles + step_candles:
        log.error("%s: not enough OHLCV data (%d candles)", pair, len(ohlcv))
        return VolBacktestResult(currency=currency, initial_capital=_capital, final_capital=_capital)

    # Align: only use OHLCV data that overlaps with DVOL data
    dvol_start = dvol["timestamp"].min()
    dvol_end = dvol["timestamp"].max()
    ohlcv_in_range = ohlcv[
        (ohlcv["timestamp"] >= dvol_start) & (ohlcv["timestamp"] <= dvol_end)
    ].reset_index(drop=True)

    if len(ohlcv_in_range) < _lookback + hold_candles:
        log.warning("Limited overlap between OHLCV and DVOL data, using all OHLCV")
        ohlcv_in_range = ohlcv

    capital = _capital
    trades: list[VolTrade] = []
    baseline_trades: list[VolTrade] = []
    equity_curve = [capital]

    start_idx = _lookback
    end_idx = len(ohlcv_in_range) - hold_candles
    total_steps = max(0, (end_idx - start_idx) // step_candles)

    log.info(
        "%s vol backtest: %d steps (step=%dh, hold=%dd, lookback=%d candles)",
        currency, total_steps, _step_hours, _hold_days, _lookback,
    )

    if total_steps == 0:
        log.error("Not enough data for any backtest steps")
        return VolBacktestResult(currency=currency, initial_capital=_capital, final_capital=_capital)

    in_position = False
    position_entry_idx = 0

    for step, i in enumerate(tqdm(range(start_idx, end_idx, step_candles), total=total_steps, desc=currency)):
        # Exit existing position if hold period reached
        if in_position and (i - position_entry_idx) >= hold_candles:
            in_position = False

        if in_position:
            continue

        # Get current timestamp for DVOL lookup
        current_ts = ohlcv_in_range.iloc[i]["timestamp"]
        implied_vol = _interpolate_dvol(dvol, current_ts)
        if implied_vol <= 0:
            continue

        # Get window for Kronos prediction
        window = ohlcv_in_range.iloc[i - _lookback : i].reset_index(drop=True)
        underlying_price = float(window.iloc[-1]["close"])

        # Predict realized vol with Kronos
        try:
            vol_pred = predict_realized_vol(
                engine, window,
                pred_len=_pred_len,
                n_trajectories=_n_traj,
            )
        except Exception as e:
            log.warning("Step %d/%d prediction failed: %s", step + 1, total_steps, e)
            continue

        if vol_pred["n_trajectories"] == 0:
            continue

        predicted_vol = vol_pred["mean"]

        # Compare with implied
        comparison = compare_with_implied(predicted_vol, implied_vol, _sell_ratio, _buy_ratio)
        direction = comparison["signal"]

        # Compute actual realized vol over the hold period
        future_closes = ohlcv_in_range.iloc[i : i + hold_candles]["close"].values
        realized_vol = _compute_realized_vol(future_closes)

        # --- Baseline: always sell vol ---
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
        baseline_trades.append(baseline_trade)

        # --- Kronos signal ---
        if direction == "HOLD":
            continue

        trade = VolTrade(
            currency=currency,
            direction=direction,
            entry_idx=i,
            exit_idx=i + hold_candles,
            predicted_vol=predicted_vol,
            implied_vol=implied_vol,
            realized_vol=realized_vol,
            underlying_price=underlying_price,
            notional=min(_notional, _max_pos),
            hold_days=_hold_days,
        )
        trades.append(trade)
        capital += trade.net_pnl
        equity_curve.append(capital)

        in_position = True
        position_entry_idx = i

        if (step + 1) % 20 == 0:
            log.info(
                "  Step %d/%d | capital: $%.2f | trades: %d",
                step + 1, total_steps, capital, len(trades),
            )

    # Compute results
    result = _compute_vol_result(currency, trades, baseline_trades, equity_curve, _capital, capital)
    return result


def _compute_vol_result(
    currency: str,
    trades: list[VolTrade],
    baseline_trades: list[VolTrade],
    equity_curve: list[float],
    initial: float,
    final: float,
) -> VolBacktestResult:
    if not trades:
        # Still compute baseline
        baseline_pnl = sum(t.net_pnl for t in baseline_trades)
        baseline_winners = sum(1 for t in baseline_trades if t.net_pnl > 0)
        baseline_win_rate = baseline_winners / len(baseline_trades) if baseline_trades else 0

        return VolBacktestResult(
            currency=currency,
            initial_capital=initial,
            final_capital=final,
            baseline_pnl=baseline_pnl,
            baseline_win_rate=baseline_win_rate,
            trades=trades,
        )

    pnls = [t.net_pnl for t in trades]
    winners = [p for p in pnls if p > 0]
    losers = [p for p in pnls if p <= 0]

    # Vol hit rate: how often Kronos got the direction right
    vol_hits = sum(1 for t in trades if t.vol_prediction_correct)
    vol_hit_rate = vol_hits / len(trades)

    # Max drawdown
    peak = equity_curve[0]
    max_dd = 0.0
    for val in equity_curve:
        peak = max(peak, val)
        max_dd = max(max_dd, peak - val)

    # Sharpe
    pnl_arr = np.array(pnls)
    sharpe = 0.0
    if len(pnl_arr) > 1 and np.std(pnl_arr) > 0:
        sharpe = float(np.mean(pnl_arr) / np.std(pnl_arr) * np.sqrt(len(pnl_arr)))

    # Baseline
    baseline_pnl = sum(t.net_pnl for t in baseline_trades)
    baseline_winners = sum(1 for t in baseline_trades if t.net_pnl > 0)
    baseline_win_rate = baseline_winners / len(baseline_trades) if baseline_trades else 0

    return VolBacktestResult(
        currency=currency,
        total_trades=len(trades),
        winning_trades=len(winners),
        losing_trades=len(losers),
        gross_pnl=sum(t.gross_pnl for t in trades),
        net_pnl=sum(pnls),
        win_rate=len(winners) / len(trades),
        avg_trade_pnl=float(np.mean(pnls)),
        max_drawdown=max_dd,
        sharpe=sharpe,
        vol_hit_rate=vol_hit_rate,
        initial_capital=initial,
        final_capital=final,
        baseline_pnl=baseline_pnl,
        baseline_win_rate=baseline_win_rate,
        trades=trades,
    )


# --- CLI ---


def main():
    import argparse
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    parser = argparse.ArgumentParser(description="Backtest volatility trading strategy")
    parser.add_argument("--currency", type=str, default="BTC")
    parser.add_argument("--days", type=int, default=None)
    parser.add_argument("--trajectories", type=int, default=None)
    args = parser.parse_args()

    from src.signals.predictor import KronosEngine
    engine = KronosEngine()
    engine.load()

    result = run_vol_backtest(
        currency=args.currency,
        engine=engine,
        n_trajectories=args.trajectories,
    )
    print(result.summary())

    if result.net_pnl > 0 and result.net_pnl > result.baseline_pnl:
        print("\n[OK] Kronos vol strategy beats both baseline and zero. Edge detected.")
    elif result.net_pnl > 0:
        print("\n[WARN] Positive P&L but underperforms always-sell baseline. Investigate.")
    else:
        print("\n[X] No edge in vol strategy. Do NOT proceed to live trading.")


if __name__ == "__main__":
    main()
