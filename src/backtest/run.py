"""Walk-forward backtester with real Binance fees.

This is the critical file. It answers: "Is there edge after fees?"

Walks through historical data, generates signals at each step,
simulates trades with real fee structure, and reports P&L.

Usage:
    python -m src.backtest.run --pairs BTCUSDT,ETHUSDT,SOLUSDT
    python -m src.backtest.run --pairs BTCUSDT --lookback 400 --pred-len 12
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from src.config import get

log = logging.getLogger("kronos.backtest")


@dataclass
class Trade:
    pair: str
    direction: str
    entry_price: float
    exit_price: float
    size_usd: float
    fee_rate: float
    entry_idx: int
    exit_idx: int

    @property
    def gross_pnl(self) -> float:
        if self.direction == "BUY":
            return (self.exit_price - self.entry_price) / self.entry_price * self.size_usd
        else:
            return (self.entry_price - self.exit_price) / self.entry_price * self.size_usd

    @property
    def fees(self) -> float:
        return self.size_usd * self.fee_rate * 2  # entry + exit

    @property
    def net_pnl(self) -> float:
        return self.gross_pnl - self.fees


@dataclass
class BacktestResult:
    pair: str
    total_trades: int = 0
    winning_trades: int = 0
    losing_trades: int = 0
    gross_pnl: float = 0.0
    total_fees: float = 0.0
    net_pnl: float = 0.0
    win_rate: float = 0.0
    avg_trade_pnl: float = 0.0
    max_drawdown: float = 0.0
    sharpe: float = 0.0
    initial_capital: float = 0.0
    final_capital: float = 0.0
    trades: list[Trade] = field(default_factory=list)

    def summary(self) -> str:
        roi = (self.final_capital - self.initial_capital) / self.initial_capital * 100 if self.initial_capital > 0 else 0
        return (
            f"\n{'='*60}\n"
            f"  BACKTEST: {self.pair}\n"
            f"{'='*60}\n"
            f"  Capital:       ${self.initial_capital:.2f} → ${self.final_capital:.2f} ({roi:+.1f}%)\n"
            f"  Net P&L:       ${self.net_pnl:+.2f}\n"
            f"  Gross P&L:     ${self.gross_pnl:+.2f}\n"
            f"  Total fees:    ${self.total_fees:.2f}\n"
            f"  Trades:        {self.total_trades} ({self.winning_trades}W / {self.losing_trades}L)\n"
            f"  Win rate:      {self.win_rate:.1%}\n"
            f"  Avg trade:     ${self.avg_trade_pnl:+.2f}\n"
            f"  Max drawdown:  ${self.max_drawdown:.2f}\n"
            f"  Sharpe:        {self.sharpe:.2f}\n"
            f"{'='*60}"
        )


def run_backtest(
    pair: str,
    engine,
    lookback: int | None = None,
    pred_len: int | None = None,
    step_size: int | None = None,
    hold_period: int | None = None,
    initial_capital: float | None = None,
    max_position: float | None = None,
    fee_rate: float | None = None,
    buy_threshold: float | None = None,
    sell_threshold: float | None = None,
    min_agreement: float | None = None,
    sample_count: int | None = None,
) -> BacktestResult:
    """Walk-forward backtest for a single pair."""
    from src.data.fetch import load_pair
    from src.signals.scanner import generate_signal

    _lookback = lookback or get("trading", "lookback", 400)
    _pred_len = pred_len or get("trading", "pred_len", 12)
    _step = step_size or get("backtest", "step_size", 12)
    _hold = hold_period or get("backtest", "hold_period", 12)
    _capital = initial_capital or get("backtest", "initial_capital", 500.0)
    _max_pos = max_position or get("backtest", "max_position", 50.0)
    _fee = fee_rate or get("backtest", "fee_rate", 0.001)
    _buy_thresh = buy_threshold or get("signals", "buy_threshold", 0.005)
    _sell_thresh = sell_threshold or get("signals", "sell_threshold", -0.005)
    _min_agree = min_agreement or get("signals", "min_agreement", 0.60)
    _samples = sample_count or get("trading", "sample_count", 10)

    interval = get("trading", "interval", "15m")
    df = load_pair(pair, interval)

    if len(df) < _lookback + _hold + _step:
        log.error("%s: not enough data (%d candles)", pair, len(df))
        return BacktestResult(pair=pair, initial_capital=_capital, final_capital=_capital)

    capital = _capital
    trades: list[Trade] = []
    equity_curve = [capital]

    # Walk forward
    start_idx = _lookback
    end_idx = len(df) - _hold
    total_steps = (end_idx - start_idx) // _step

    log.info("%s: backtesting %d steps (candles %d → %d)", pair, total_steps, start_idx, end_idx)

    in_position = False
    position_entry_idx = 0
    position_direction = ""
    position_entry_price = 0.0

    step_count = 0
    for i in range(start_idx, end_idx, _step):
        step_count += 1

        # Exit existing position if hold period reached
        if in_position and (i - position_entry_idx) >= _hold:
            exit_price = df.iloc[i]["close"]
            trade = Trade(
                pair=pair,
                direction=position_direction,
                entry_price=position_entry_price,
                exit_price=exit_price,
                size_usd=min(_max_pos, capital * 0.1),
                fee_rate=_fee,
                entry_idx=position_entry_idx,
                exit_idx=i,
            )
            trades.append(trade)
            capital += trade.net_pnl
            equity_curve.append(capital)
            in_position = False

        if in_position:
            continue

        # Generate signal
        window = df.iloc[i - _lookback : i].reset_index(drop=True)

        try:
            signal = generate_signal(
                pair, engine, window,
                n_trajectories=_samples,
                buy_threshold=_buy_thresh,
                sell_threshold=_sell_thresh,
                min_agreement=_min_agree,
            )
        except Exception as e:
            log.warning("Step %d/%d prediction failed: %s", step_count, total_steps, e)
            continue

        # Enter if actionable
        if signal.is_actionable():
            in_position = True
            position_entry_idx = i
            position_direction = signal.direction
            position_entry_price = df.iloc[i]["close"]

        # Progress logging
        if step_count % 50 == 0:
            log.info(
                "  Step %d/%d | capital: $%.2f | trades: %d",
                step_count, total_steps, capital, len(trades)
            )

    # Compute results
    result = _compute_result(pair, trades, equity_curve, _capital, capital)
    return result


def _compute_result(
    pair: str,
    trades: list[Trade],
    equity_curve: list[float],
    initial: float,
    final: float,
) -> BacktestResult:
    if not trades:
        return BacktestResult(
            pair=pair, initial_capital=initial, final_capital=final, trades=trades
        )

    pnls = [t.net_pnl for t in trades]
    winners = [p for p in pnls if p > 0]
    losers = [p for p in pnls if p <= 0]

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

    return BacktestResult(
        pair=pair,
        total_trades=len(trades),
        winning_trades=len(winners),
        losing_trades=len(losers),
        gross_pnl=sum(t.gross_pnl for t in trades),
        total_fees=sum(t.fees for t in trades),
        net_pnl=sum(pnls),
        win_rate=len(winners) / len(trades),
        avg_trade_pnl=float(np.mean(pnls)),
        max_drawdown=max_dd,
        sharpe=sharpe,
        initial_capital=initial,
        final_capital=final,
        trades=trades,
    )


# --- CLI ---


def main():
    import argparse
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    parser = argparse.ArgumentParser(description="Backtest Kronos signals")
    parser.add_argument("--pairs", type=str, default="BTCUSDT,ETHUSDT,SOLUSDT")
    parser.add_argument("--lookback", type=int, default=None)
    parser.add_argument("--pred-len", type=int, default=None)
    parser.add_argument("--samples", type=int, default=None)
    args = parser.parse_args()

    from src.signals.predictor import KronosEngine
    engine = KronosEngine()
    engine.load()

    pairs = [p.strip() for p in args.pairs.split(",")]
    total_pnl = 0.0

    for pair in pairs:
        result = run_backtest(
            pair, engine,
            lookback=args.lookback,
            pred_len=args.pred_len,
            sample_count=args.samples,
        )
        print(result.summary())
        total_pnl += result.net_pnl

    print(f"\n{'='*60}")
    print(f"  TOTAL NET P&L ACROSS ALL PAIRS: ${total_pnl:+.2f}")
    print(f"{'='*60}")

    if total_pnl > 0:
        print("\n✅ Positive edge detected. Consider paper trading next.")
    else:
        print("\n❌ No edge after fees. Do NOT proceed to live trading.")


if __name__ == "__main__":
    main()
