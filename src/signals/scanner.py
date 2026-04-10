"""Signal scanner — generates trading signals from Kronos predictions.

Runs Kronos on each tracked pair, samples multiple trajectories,
and emits BUY/SELL/HOLD signals based on agreement and edge.

Usage:
    python -m src.signals.scanner                    # one-shot scan
    python -m src.signals.scanner --mode paper       # continuous paper trading
    python -m src.signals.scanner --mode live        # continuous + execution
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

import numpy as np

from src.config import get

log = logging.getLogger("kronos.signals")


@dataclass
class Signal:
    pair: str
    direction: str  # "BUY", "SELL", "HOLD"
    expected_return: float
    agreement: float  # fraction of trajectories agreeing on direction
    confidence: str  # "low", "medium", "high"
    current_price: float
    pred_price: float
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    n_trajectories: int = 0

    def is_actionable(self) -> bool:
        return self.direction in ("BUY", "SELL")

    def __str__(self) -> str:
        emoji = {"BUY": "🟢", "SELL": "🔴", "HOLD": "⚪"}.get(self.direction, "⚪")
        return (
            f"{emoji} {self.direction} {self.pair} | "
            f"return: {self.expected_return:+.2%} | "
            f"agreement: {self.agreement:.0%} | "
            f"confidence: {self.confidence} | "
            f"price: {self.current_price:.2f} → {self.pred_price:.2f}"
        )


def generate_signal(
    pair: str,
    engine,
    df,
    n_trajectories: int | None = None,
    buy_threshold: float | None = None,
    sell_threshold: float | None = None,
    min_agreement: float | None = None,
) -> Signal:
    """Generate a signal for a single pair using multi-trajectory sampling."""
    _n_traj = n_trajectories or get("trading", "sample_count", 10)
    _buy_thresh = buy_threshold or get("signals", "buy_threshold", 0.005)
    _sell_thresh = sell_threshold or get("signals", "sell_threshold", -0.005)
    _min_agree = min_agreement or get("signals", "min_agreement", 0.60)

    # Generate multiple independent trajectories
    trajectories = engine.predict_trajectories(
        df, n_trajectories=_n_traj
    )

    # Analyze agreement
    returns = [t["expected_return"] for t in trajectories]
    up_count = sum(1 for r in returns if r > 0)
    down_count = sum(1 for r in returns if r < 0)

    mean_return = float(np.mean(returns))
    agreement_up = up_count / len(returns)
    agreement_down = down_count / len(returns)

    current_price = trajectories[0]["current_close"]
    pred_prices = [t["pred_close"] for t in trajectories]
    mean_pred = float(np.mean(pred_prices))

    # Determine signal
    if mean_return > _buy_thresh and agreement_up >= _min_agree:
        direction = "BUY"
        agreement = agreement_up
    elif mean_return < _sell_thresh and agreement_down >= _min_agree:
        direction = "SELL"
        agreement = agreement_down
    else:
        direction = "HOLD"
        agreement = max(agreement_up, agreement_down)

    # Confidence
    if agreement >= 0.85 and abs(mean_return) > abs(_buy_thresh) * 2:
        confidence = "high"
    elif agreement >= 0.70:
        confidence = "medium"
    else:
        confidence = "low"

    return Signal(
        pair=pair,
        direction=direction,
        expected_return=mean_return,
        agreement=agreement,
        confidence=confidence,
        current_price=current_price,
        pred_price=mean_pred,
        n_trajectories=_n_traj,
    )


def scan_all(engine=None, mode: str = "scan") -> list[Signal]:
    """Scan all configured pairs and return signals."""
    from src.data.fetch import load_pair
    from src.signals.predictor import KronosEngine

    if engine is None:
        engine = KronosEngine()
        engine.load()

    pairs = get("trading", "pairs", ["BTCUSDT", "ETHUSDT"])
    interval = get("trading", "interval", "15m")
    lookback = get("trading", "lookback", 400)

    signals = []

    for pair in pairs:
        try:
            df = load_pair(pair, interval)

            # Take most recent lookback candles
            if len(df) < lookback:
                log.warning("%s: only %d candles, need %d", pair, len(df), lookback)
                continue

            recent = df.tail(lookback).reset_index(drop=True)
            signal = generate_signal(pair, engine, recent)
            signals.append(signal)

            log.info(str(signal))

        except FileNotFoundError:
            log.warning("%s: no data file. Run fetch first.", pair)
        except Exception as e:
            log.error("%s: %s", pair, e)

    # Summary
    actionable = [s for s in signals if s.is_actionable()]
    log.info(
        "Scan complete: %d pairs, %d actionable signals",
        len(signals), len(actionable)
    )

    return signals


async def send_telegram(signal: Signal):
    """Send signal to Telegram."""
    import httpx

    bot_token = get("telegram", "bot_token", "")
    chat_id = get("telegram", "chat_id", "")
    if not bot_token or not chat_id:
        return

    text = (
        f"*{signal.direction}* — `{signal.pair}`\n"
        f"Expected return: `{signal.expected_return:+.2%}`\n"
        f"Agreement: `{signal.agreement:.0%}` ({signal.n_trajectories} paths)\n"
        f"Confidence: `{signal.confidence}`\n"
        f"Price: `{signal.current_price:.2f}` → `{signal.pred_price:.2f}`"
    )

    async with httpx.AsyncClient() as client:
        await client.post(
            f"https://api.telegram.org/bot{bot_token}/sendMessage",
            json={"chat_id": chat_id, "text": text, "parse_mode": "Markdown"},
        )


# --- CLI ---


def main():
    import argparse
    import asyncio

    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["scan", "paper", "live"], default="scan")
    args = parser.parse_args()

    from src.signals.predictor import KronosEngine
    engine = KronosEngine()
    engine.load()

    if args.mode == "scan":
        signals = scan_all(engine)
        for s in signals:
            print(s)
    else:
        interval_sec = get("trading", "pred_len", 12) * 15 * 60  # pred_len * candle_minutes * 60
        log.info("Starting %s mode. Scan every %ds", args.mode, interval_sec)

        while True:
            signals = scan_all(engine, mode=args.mode)
            actionable = [s for s in signals if s.is_actionable()]

            for s in actionable:
                print(s)
                if get("telegram", "bot_token"):
                    asyncio.run(send_telegram(s))

            log.info("Next scan in %ds...", interval_sec)
            time.sleep(interval_sec)


if __name__ == "__main__":
    main()
