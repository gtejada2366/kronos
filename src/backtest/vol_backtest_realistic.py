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
    spread_pct: float = 0.03,
    fee_per_trade: float = 2.0,
    # Risk management (all optional, default disabled)
    position_pct: float = 0.0,        # 0 = use fixed `notional`. >0 = % of equity per trade
    trailing_rv_lookback_days: int = 0,  # 0 = no filter. >0 = check recent RV
    trailing_rv_block_ratio: float = 1.0,  # block when recent_rv / implied >= this
    stop_loss_dd_pct: float = 0.0,    # 0 = disabled. >0 = pause if equity DD from peak >= this
    stop_loss_pause_days: int = 30,
) -> dict:
    """Run baseline always-sell-vol with realistic costs and optional risk mgmt.

    Cost args:
        spread_pct: round-trip bid-ask spread as fraction of theoretical premium.
        fee_per_trade: fixed $ commission round-trip per trade.

    Risk mgmt args (all optional):
        position_pct: if > 0, notional = position_pct * current_equity (dynamic sizing).
            Overrides the fixed `notional` arg. e.g. 0.5 = 50% of equity per trade.
        trailing_rv_lookback_days: if > 0, compute realized vol over the last N days
            BEFORE the trade. If recent_rv / implied_vol >= trailing_rv_block_ratio,
            skip the trade. This avoids entering during already-stressed regimes.
        trailing_rv_block_ratio: threshold for the trailing filter. e.g. 1.2 = block
            when recent realized vol is 20% above implied.
        stop_loss_dd_pct: if equity is below peak by this fraction, pause trading
            for `stop_loss_pause_days`. e.g. 0.30 = 30% drawdown triggers pause.
        stop_loss_pause_days: duration of the pause after stop-loss triggers.
    """
    pair = f"{currency}USDT"
    interval = get("trading", "interval", "15m")
    step_candles = step_size_hours * 4
    hold_candles = hold_days * 24 * 4
    trailing_lookback_candles = trailing_rv_lookback_days * 24 * 4
    lookback_candles = max(1, trailing_lookback_candles)

    ohlcv = load_pair(pair, interval)
    dvol = load_df("dvol", currency)

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
        "%s realistic backtest: %d steps | costs spread=%.1f%% fee=$%.2f | "
        "pos_pct=%.0f%% trail_filter=%dd@%.2f stop_loss=%.0f%%",
        currency, total_steps, spread_pct * 100, fee_per_trade,
        position_pct * 100, trailing_rv_lookback_days, trailing_rv_block_ratio,
        stop_loss_dd_pct * 100,
    )

    trades: list[RealisticTrade] = []
    equity = [initial_capital]
    equity_timestamps = [ohlcv_in_range.iloc[start_idx]["timestamp"]]
    capital = initial_capital
    peak_equity = initial_capital
    pause_until_ts: pd.Timestamp | None = None

    skipped_by_trail = 0
    skipped_by_stop = 0

    for i in range(start_idx, end_idx, step_candles):
        current_ts = ohlcv_in_range.iloc[i]["timestamp"]

        # --- Risk: stop-loss pause ---
        if pause_until_ts is not None and current_ts < pause_until_ts:
            skipped_by_stop += 1
            equity.append(capital)
            equity_timestamps.append(current_ts)
            continue
        elif pause_until_ts is not None and current_ts >= pause_until_ts:
            pause_until_ts = None
            # Reset peak after pause to current capital so we don't immediately re-trigger
            peak_equity = capital

        implied_vol = _interpolate_dvol(dvol, current_ts)
        if implied_vol <= 0:
            continue

        # --- Risk: trailing realized vol filter ---
        if trailing_lookback_candles > 0:
            past_closes = ohlcv_in_range.iloc[i - trailing_lookback_candles : i]["close"].values
            recent_rv = _compute_realized_vol(past_closes)
            if recent_rv / implied_vol >= trailing_rv_block_ratio:
                skipped_by_trail += 1
                equity.append(capital)
                equity_timestamps.append(current_ts)
                continue

        # --- Position sizing ---
        trade_notional = notional
        if position_pct > 0:
            trade_notional = max(0.0, position_pct * capital)

        if trade_notional <= 0:
            equity.append(capital)
            equity_timestamps.append(current_ts)
            continue

        underlying_price = float(ohlcv_in_range.iloc[i]["close"])
        future_closes = ohlcv_in_range.iloc[i : i + hold_candles]["close"].values
        realized_vol = _compute_realized_vol(future_closes)

        sqrt_t = math.sqrt(hold_days / 365)
        premium = trade_notional * (implied_vol / 100) * sqrt_t
        spread_cost = premium * spread_pct

        trade = RealisticTrade(
            timestamp=current_ts,
            direction="SELL_VOL",
            implied_vol=implied_vol,
            realized_vol=realized_vol,
            underlying_price=underlying_price,
            notional=trade_notional,
            hold_days=hold_days,
            spread_cost=spread_cost,
            fee_cost=fee_per_trade,
        )
        trades.append(trade)
        capital += trade.net_pnl
        equity.append(capital)
        equity_timestamps.append(current_ts)

        # --- Update peak + check stop loss ---
        if capital > peak_equity:
            peak_equity = capital
        if stop_loss_dd_pct > 0 and peak_equity > 0:
            current_dd = (peak_equity - capital) / peak_equity
            if current_dd >= stop_loss_dd_pct:
                pause_until_ts = current_ts + pd.Timedelta(days=stop_loss_pause_days)
                log.info(
                    "STOP-LOSS triggered at %s: capital=%.2f peak=%.2f dd=%.1f%%, pausing %d days",
                    current_ts, capital, peak_equity, current_dd * 100, stop_loss_pause_days,
                )

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
        "skipped_by_trail": skipped_by_trail,
        "skipped_by_stop": skipped_by_stop,
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
    parser.add_argument("--position-pct", type=float, default=0.0,
                        help="If > 0, use this fraction of equity per trade instead of fixed notional")
    parser.add_argument("--trail-days", type=int, default=0,
                        help="Trailing realized vol filter lookback in days (0=disabled)")
    parser.add_argument("--trail-ratio", type=float, default=1.0,
                        help="Block trade when recent_rv/implied >= this (default 1.0)")
    parser.add_argument("--stop-loss-dd", type=float, default=0.0,
                        help="Stop loss DD threshold (e.g. 0.30 = 30%%). 0=disabled")
    parser.add_argument("--stop-loss-pause-days", type=int, default=30)
    parser.add_argument("--compare", action="store_true",
                        help="Run all 5 scenarios side-by-side and print comparison table")
    args = parser.parse_args()

    if args.compare:
        scenarios = [
            ("baseline (no risk mgmt)", dict()),
            ("+ position sizing 50%", dict(position_pct=0.5)),
            ("+ trailing RV filter (3d, ratio=1.2)",
                dict(trailing_rv_lookback_days=3, trailing_rv_block_ratio=1.2)),
            ("+ stop loss (-30%, 30d pause)",
                dict(stop_loss_dd_pct=0.30, stop_loss_pause_days=30)),
            ("ALL THREE combined",
                dict(position_pct=0.5, trailing_rv_lookback_days=3,
                     trailing_rv_block_ratio=1.2, stop_loss_dd_pct=0.30,
                     stop_loss_pause_days=30)),
        ]
        results = []
        for name, extra in scenarios:
            r = run_realistic_backtest(
                currency=args.currency, days=args.days,
                step_size_hours=args.step_hours, hold_days=args.hold_days,
                initial_capital=args.capital, notional=args.notional,
                spread_pct=args.spread_pct, fee_per_trade=args.fee_per_trade,
                **extra,
            )
            results.append((name, r))

        print("\n" + "=" * 100)
        print(f"  RISK MANAGEMENT COMPARISON — {args.currency} ({args.days or 'all'}d, "
              f"spread={args.spread_pct*100:.0f}% fee=${args.fee_per_trade:.0f})")
        print("=" * 100)
        print(f"  {'Scenario':<42} {'Trades':>7} {'ROI':>10} {'Sharpe':>8} "
              f"{'MaxDD%':>8} {'Final $':>10}")
        print("  " + "-" * 96)
        for name, r in results:
            dd_pct = r['dd']['max_dd_pct'] * 100
            print(f"  {name:<42} {r['trades']:>7} "
                  f"{r['roi_pct']:>9.1f}% {r['sharpe_correct']:>8.2f} "
                  f"{dd_pct:>7.1f}% ${r['final_capital']:>9.0f}")
        print("=" * 100)
        print()
        print("  Detailed DD periods:")
        for name, r in results:
            dd = r['dd']
            print(f"    {name:<42} peak ${dd['peak_value']:.0f} "
                  f"-> trough ${dd['trough_value']:.0f} "
                  f"({dd['peak_ts'].strftime('%Y-%m-%d') if dd['peak_ts'] else '?'} "
                  f"-> {dd['trough_ts'].strftime('%Y-%m-%d') if dd['trough_ts'] else '?'})")
            if r.get('skipped_by_trail', 0) or r.get('skipped_by_stop', 0):
                print(f"    {'':>42} skipped: trail={r.get('skipped_by_trail', 0)} "
                      f"stop={r.get('skipped_by_stop', 0)}")
        print()
        return

    r = run_realistic_backtest(
        currency=args.currency,
        days=args.days,
        step_size_hours=args.step_hours,
        hold_days=args.hold_days,
        initial_capital=args.capital,
        notional=args.notional,
        spread_pct=args.spread_pct,
        fee_per_trade=args.fee_per_trade,
        position_pct=args.position_pct,
        trailing_rv_lookback_days=args.trail_days,
        trailing_rv_block_ratio=args.trail_ratio,
        stop_loss_dd_pct=args.stop_loss_dd,
        stop_loss_pause_days=args.stop_loss_pause_days,
    )
    print_summary(r, args.days)


if __name__ == "__main__":
    main()
