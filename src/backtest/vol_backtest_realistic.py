"""Realistic vol backtest: always-sell-vol baseline with proper costs and Sharpe.

Pure baseline strategy (no Kronos) so it runs on CPU in seconds. Built to fix
the two methodology problems found in vol_backtest_hybrid.py:

  1. Sharpe calculation bug: previous code annualized by sqrt(N_trades) instead
     of sqrt(periods_per_year). For step_size=24h, the right divisor is
     sqrt(365), not sqrt(N).

  2. No transaction costs at all. Real Deribit options have:
       - taker fee ~0.03% of underlying per side (round trip ~0.06%)
       - bid-ask spread on options that varies but is meaningful (1-3 vol points
         on ATM, more on OTM)
       - hedging costs if you delta-hedge
     We model the spread as a percentage of theoretical premium.

Also outputs:
  - Month-by-month equity curve and PnL
  - The exact period containing the max drawdown
  - Sharpe both ways (old buggy formula and corrected) for transparency

Usage:
    python -m src.backtest.vol_backtest_realistic --currency BTC --days 1825
    python -m src.backtest.vol_backtest_realistic --currency BTC --days 1825 \
        --spread-pct 0.03 --fee-per-trade 2.0
"""
from __future__ import annotations

import argparse
import logging
import math
from dataclasses import dataclass

import numpy as np
import pandas as pd

from src.backtest.vol_backtest import _compute_realized_vol, _interpolate_dvol
from src.config import get
from src.data.deribit import load_df
from src.data.fetch import load_pair

log = logging.getLogger("kronos.vol_backtest_realistic")


@dataclass
class RealisticTrade:
    timestamp: pd.Timestamp
    direction: str  # always "SELL_VOL" in this backtest
    implied_vol: float  # %
    realized_vol: float  # %
    underlying_price: float
    notional: float
    hold_days: float
    spread_cost: float
    fee_cost: float

    @property
    def gross_pnl(self) -> float:
        sqrt_t = math.sqrt(self.hold_days / 365)
        return self.notional * (self.implied_vol - self.realized_vol) / 100 * sqrt_t

    @property
    def net_pnl(self) -> float:
        return self.gross_pnl - self.spread_cost - self.fee_cost

    @property
    def premium(self) -> float:
        sqrt_t = math.sqrt(self.hold_days / 365)
        return self.notional * (self.implied_vol / 100) * sqrt_t


def _annualized_sharpe(pnls: list[float], step_size_hours: int) -> float:
    """Correctly annualized Sharpe.

    Per-period Sharpe = mean / std.
    Annualized = per-period * sqrt(periods_per_year).
    With step_size_hours=24, periods_per_year = 365.
    """
    if len(pnls) < 2:
        return 0.0
    arr = np.array(pnls)
    s = float(np.std(arr))
    if s == 0:
        return 0.0
    periods_per_year = (365 * 24) / step_size_hours
    return float(np.mean(arr) / s * math.sqrt(periods_per_year))


def _buggy_sharpe(pnls: list[float]) -> float:
    """The old broken Sharpe formula, kept for transparency / before/after."""
    if len(pnls) < 2:
        return 0.0
    arr = np.array(pnls)
    s = float(np.std(arr))
    if s == 0:
        return 0.0
    return float(np.mean(arr) / s * math.sqrt(len(arr)))


def _max_drawdown_with_period(equity: list[float], timestamps: list[pd.Timestamp]) -> dict:
    """Returns max DD value, peak timestamp, trough timestamp, and recovery (if any)."""
    if not equity:
        return {"max_dd": 0.0, "peak_ts": None, "trough_ts": None, "recovery_ts": None,
                "max_dd_pct": 0.0, "peak_value": 0.0, "trough_value": 0.0}

    peak = equity[0]
    peak_idx = 0
    max_dd = 0.0
    max_dd_peak_idx = 0
    max_dd_trough_idx = 0

    for i, v in enumerate(equity):
        if v > peak:
            peak = v
            peak_idx = i
        dd = peak - v
        if dd > max_dd:
            max_dd = dd
            max_dd_peak_idx = peak_idx
            max_dd_trough_idx = i

    # Find recovery — first index after trough where equity >= peak
    recovery_idx = None
    peak_value = equity[max_dd_peak_idx]
    for j in range(max_dd_trough_idx + 1, len(equity)):
        if equity[j] >= peak_value:
            recovery_idx = j
            break

    return {
        "max_dd": max_dd,
        "max_dd_pct": max_dd / peak_value if peak_value > 0 else 0.0,
        "peak_value": peak_value,
        "trough_value": equity[max_dd_trough_idx],
        "peak_ts": timestamps[max_dd_peak_idx] if timestamps else None,
        "trough_ts": timestamps[max_dd_trough_idx] if timestamps else None,
        "recovery_ts": timestamps[recovery_idx] if recovery_idx is not None else None,
    }


def run_realistic_backtest(
    currency: str = "BTC",
    days: int | None = None,
    step_size_hours: int = 24,
    hold_days: int = 7,
    initial_capital: float = 2000.0,
    notional: float = 1000.0,
    spread_pct: float = 0.03,  # 3% of theoretical premium for round-trip bid-ask
    fee_per_trade: float = 2.0,  # $2 per round-trip (entry + exit)
) -> dict:
    """Run baseline always-sell-vol with realistic costs.

    Args:
        spread_pct: round-trip bid-ask spread as fraction of theoretical premium.
            3% is conservative-realistic for ATM Deribit options.
        fee_per_trade: fixed $ commission round-trip per trade.
    """
    pair = f"{currency}USDT"
    interval = get("trading", "interval", "15m")
    step_candles = step_size_hours * 4
    hold_candles = hold_days * 24 * 4
    lookback_candles = 1  # we don't need lookback for baseline

    ohlcv = load_pair(pair, interval)
    dvol = load_df("dvol", currency)

    # Align with DVOL availability
    dvol_start = dvol["timestamp"].min()
    dvol_end = dvol["timestamp"].max()
    ohlcv_in_range = ohlcv[
        (ohlcv["timestamp"] >= dvol_start) & (ohlcv["timestamp"] <= dvol_end)
    ].reset_index(drop=True)

    if days is not None and days > 0:
        cutoff = ohlcv_in_range["timestamp"].max() - pd.Timedelta(days=days)
        ohlcv_in_range = ohlcv_in_range[ohlcv_in_range["timestamp"] >= cutoff].reset_index(drop=True)

    start_idx = lookback_candles
    end_idx = len(ohlcv_in_range) - hold_candles
    total_steps = max(0, (end_idx - start_idx) // step_candles)

    log.info(
        "%s realistic backtest: %d steps | step=%dh hold=%dd spread=%.1f%% fee=$%.2f",
        currency, total_steps, step_size_hours, hold_days, spread_pct * 100, fee_per_trade,
    )

    trades: list[RealisticTrade] = []
    equity = [initial_capital]
    equity_timestamps = [ohlcv_in_range.iloc[start_idx]["timestamp"]]
    capital = initial_capital

    for i in range(start_idx, end_idx, step_candles):
        current_ts = ohlcv_in_range.iloc[i]["timestamp"]
        implied_vol = _interpolate_dvol(dvol, current_ts)
        if implied_vol <= 0:
            continue

        underlying_price = float(ohlcv_in_range.iloc[i]["close"])
        future_closes = ohlcv_in_range.iloc[i : i + hold_candles]["close"].values
        realized_vol = _compute_realized_vol(future_closes)

        # Theoretical premium for cost computation
        sqrt_t = math.sqrt(hold_days / 365)
        premium = notional * (implied_vol / 100) * sqrt_t
        spread_cost = premium * spread_pct

        trade = RealisticTrade(
            timestamp=current_ts,
            direction="SELL_VOL",
            implied_vol=implied_vol,
            realized_vol=realized_vol,
            underlying_price=underlying_price,
            notional=notional,
            hold_days=hold_days,
            spread_cost=spread_cost,
            fee_cost=fee_per_trade,
        )
        trades.append(trade)
        capital += trade.net_pnl
        equity.append(capital)
        equity_timestamps.append(current_ts)

    if not trades:
        log.error("No trades generated")
        return {"trades": 0}

    # Aggregate stats
    pnls = [t.net_pnl for t in trades]
    gross_pnls = [t.gross_pnl for t in trades]
    winners = sum(1 for p in pnls if p > 0)
    losers = sum(1 for p in pnls if p <= 0)

    sharpe_correct = _annualized_sharpe(pnls, step_size_hours)
    sharpe_buggy = _buggy_sharpe(pnls)

    dd_info = _max_drawdown_with_period(equity, equity_timestamps)

    # Monthly equity curve
    eq_df = pd.DataFrame({"timestamp": equity_timestamps, "equity": equity})
    eq_df["month"] = eq_df["timestamp"].dt.to_period("M")
    monthly = eq_df.groupby("month").agg(
        equity_end=("equity", "last"),
        equity_start=("equity", "first"),
    )
    monthly["pnl"] = monthly["equity_end"] - monthly["equity_start"]
    monthly["pct"] = monthly["pnl"] / monthly["equity_start"] * 100

    return {
        "currency": currency,
        "trades": len(trades),
        "winners": winners,
        "losers": losers,
        "win_rate": winners / len(trades),
        "gross_pnl": sum(gross_pnls),
        "net_pnl": sum(pnls),
        "total_costs": sum(gross_pnls) - sum(pnls),
        "initial_capital": initial_capital,
        "final_capital": capital,
        "roi_pct": (capital - initial_capital) / initial_capital * 100,
        "sharpe_correct": sharpe_correct,
        "sharpe_buggy": sharpe_buggy,
        "dd": dd_info,
        "monthly": monthly,
        "equity_curve": equity,
        "equity_timestamps": equity_timestamps,
    }


def print_summary(r: dict, days: int | None) -> None:
    print()
    print("=" * 75)
    print(f"  REALISTIC VOL BACKTEST: {r['currency']} ({days or 'all'} days)")
    print("=" * 75)
    print(f"  Trades:               {r['trades']} ({r['winners']}W / {r['losers']}L)")
    print(f"  Win rate:             {r['win_rate']:.1%}")
    print()
    print(f"  Initial capital:      ${r['initial_capital']:.2f}")
    print(f"  Final capital:        ${r['final_capital']:.2f}")
    print(f"  Net P&L:              ${r['net_pnl']:+.2f}  ({r['roi_pct']:+.1f}%)")
    print(f"  Gross P&L (no costs): ${r['gross_pnl']:+.2f}")
    print(f"  Total costs paid:     ${r['total_costs']:.2f}  "
          f"({r['total_costs']/r['gross_pnl']*100 if r['gross_pnl']>0 else 0:.1f}% of gross)")
    print()
    print(f"  Sharpe (corrected):   {r['sharpe_correct']:.2f}")
    print(f"  Sharpe (buggy old):   {r['sharpe_buggy']:.2f}  ← what hybrid backtest reported")
    print()
    dd = r["dd"]
    print(f"  Max drawdown:         ${dd['max_dd']:.2f}  ({dd['max_dd_pct']:.1%} of peak)")
    print(f"  Peak before DD:       ${dd['peak_value']:.2f}  on {dd['peak_ts']}")
    print(f"  Trough of DD:         ${dd['trough_value']:.2f}  on {dd['trough_ts']}")
    if dd["recovery_ts"] is not None:
        days_to_recover = (dd["recovery_ts"] - dd["trough_ts"]).days
        print(f"  Recovered by:         {dd['recovery_ts']}  ({days_to_recover} days from trough)")
    else:
        print("  Recovered by:         NEVER (still under water at end)")
    print()
    print("=" * 75)
    print("  MONTHLY P&L (last 24 months)")
    print("=" * 75)
    monthly = r["monthly"].tail(24)
    for month, row in monthly.iterrows():
        bar_len = int(abs(row["pct"]) / 2)
        bar = ("+" * bar_len) if row["pct"] >= 0 else ("-" * bar_len)
        print(f"  {month}  ${row['pnl']:+8.2f}  {row['pct']:+6.1f}%  {bar}")
    print("=" * 75)
    print()
    print("  WORST 5 MONTHS:")
    worst = r["monthly"].nsmallest(5, "pnl")
    for month, row in worst.iterrows():
        print(f"    {month}  ${row['pnl']:+8.2f}  {row['pct']:+6.1f}%")
    print()
    print("  BEST 5 MONTHS:")
    best = r["monthly"].nlargest(5, "pnl")
    for month, row in best.iterrows():
        print(f"    {month}  ${row['pnl']:+8.2f}  {row['pct']:+6.1f}%")
    print()


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    parser = argparse.ArgumentParser(description="Realistic baseline vol backtest")
    parser.add_argument("--currency", type=str, default="BTC")
    parser.add_argument("--days", type=int, default=None)
    parser.add_argument("--spread-pct", type=float, default=0.03,
                        help="Round-trip bid-ask spread as fraction of premium (default 0.03)")
    parser.add_argument("--fee-per-trade", type=float, default=2.0,
                        help="Fixed $ commission per round-trip trade (default 2.0)")
    parser.add_argument("--step-hours", type=int, default=24)
    parser.add_argument("--hold-days", type=int, default=7)
    parser.add_argument("--notional", type=float, default=1000.0)
    parser.add_argument("--capital", type=float, default=2000.0)
    args = parser.parse_args()

    r = run_realistic_backtest(
        currency=args.currency,
        days=args.days,
        step_size_hours=args.step_hours,
        hold_days=args.hold_days,
        initial_capital=args.capital,
        notional=args.notional,
        spread_pct=args.spread_pct,
        fee_per_trade=args.fee_per_trade,
    )
    print_summary(r, args.days)


if __name__ == "__main__":
    main()
