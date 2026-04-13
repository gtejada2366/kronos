"""Paper trading daily runner for the short-vol strategy.

Runs once per day, manages a simulated portfolio without placing real
orders. Replicates vol_backtest_realistic.py logic in incremental mode:
fetch fresh data, settle due positions, decide next trade, save state,
print report.

Idempotent: running twice on the same UTC day will not double-trade
(but will still settle any positions whose hold period elapsed).

State is persisted to data/paper/state_<currency>.json.
The same file accumulates the closed_trades log over time.

Usage:
    # First time only — initialize state with default config
    python -m src.paper.daily_runner --currency BTC --init

    # Daily run (fetch data + settle + decide + report)
    python -m src.paper.daily_runner --currency BTC

    # Show current state without running anything
    python -m src.paper.daily_runner --currency BTC --status

    # Dry run: show what the action would be, do not modify state
    python -m src.paper.daily_runner --currency BTC --dry-run
"""
from __future__ import annotations

import argparse
import json
import logging
import math
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from src.backtest.vol_backtest import _compute_realized_vol, _interpolate_dvol
from src.data.deribit import fetch_dvol_history
from src.data.fetch import fetch_klines

log = logging.getLogger("kronos.paper")

PAPER_DIR = Path(__file__).parent.parent.parent / "data" / "paper"

# Default config matches the recommended deployment from Path B analysis:
# trailing filter (3d, ratio 1.2) + stop loss (-30%, 30d pause) on BTC.
DEFAULT_CONFIG = {
    "notional": 1000.0,
    "hold_days": 7,
    "spread_pct": 0.03,         # 3% bid-ask of theoretical premium
    "fee_per_trade": 2.0,        # $2 round-trip commission
    "trail_days": 3,             # trailing realized vol filter lookback
    "trail_ratio": 1.2,          # block when recent_rv/implied >= 1.2
    "stop_loss_dd_pct": 0.30,    # 30% DD from peak triggers pause
    "stop_loss_pause_days": 30,  # pause duration
    "initial_capital": 2000.0,
}


# ---------- State persistence ----------

def state_path(currency: str) -> Path:
    return PAPER_DIR / f"state_{currency}.json"


def init_state(currency: str, config: dict) -> dict:
    return {
        "currency": currency,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "last_decision_date": None,
        "capital": config["initial_capital"],
        "initial_capital": config["initial_capital"],
        "peak_equity": config["initial_capital"],
        "stop_loss_pause_until": None,
        "config": config,
        "open_positions": [],
        "closed_trades": [],
        "skipped": {"by_trail": 0, "by_stop": 0, "by_idempotent": 0},
    }


def load_state(currency: str) -> dict | None:
    p = state_path(currency)
    if not p.exists():
        return None
    return json.loads(p.read_text())


def save_state(state: dict) -> None:
    PAPER_DIR.mkdir(parents=True, exist_ok=True)
    p = state_path(state["currency"])
    p.write_text(json.dumps(state, indent=2, default=str))


# ---------- Data fetch ----------

def fetch_recent_data(currency: str, days: int = 30) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Fetch last N days of OHLCV and DVOL fresh from public APIs."""
    pair = f"{currency}USDT"
    end = datetime.now(timezone.utc)
    start = end - pd.Timedelta(days=days)

    log.info("Fetching %s 15m OHLCV (last %d days)...", pair, days)
    ohlcv = fetch_klines(pair, "15m", start, end)
    log.info("  got %d candles, range %s -> %s",
             len(ohlcv), ohlcv["timestamp"].min(), ohlcv["timestamp"].max())

    log.info("Fetching %s DVOL (last %d days)...", currency, days)
    dvol = fetch_dvol_history(currency, days=days)
    log.info("  got %d points, range %s -> %s",
             len(dvol), dvol["timestamp"].min(), dvol["timestamp"].max())

    return ohlcv, dvol


# ---------- Settlement ----------

def settle_due_positions(state: dict, ohlcv: pd.DataFrame) -> list[dict]:
    """Settle any open positions whose settle_ts has passed.

    Returns list of newly closed trades.
    """
    config = state["config"]
    now = pd.Timestamp.now(tz="UTC")
    newly_closed: list[dict] = []
    still_open: list[dict] = []

    for pos in state["open_positions"]:
        settle_ts = pd.Timestamp(pos["settle_ts"])
        if settle_ts > now:
            still_open.append(pos)
            continue

        entry_ts = pd.Timestamp(pos["entry_ts"])
        mask = (ohlcv["timestamp"] >= entry_ts) & (ohlcv["timestamp"] <= settle_ts)
        closes = ohlcv.loc[mask, "close"].values
        if len(closes) < 2:
            log.warning(
                "Cannot settle position from %s — only %d candles in window, leaving open",
                entry_ts, len(closes),
            )
            still_open.append(pos)
            continue

        realized_vol = _compute_realized_vol(closes)
        sqrt_t = math.sqrt(config["hold_days"] / 365)
        gross_pnl = pos["notional"] * (pos["implied_vol"] - realized_vol) / 100 * sqrt_t
        net_pnl = gross_pnl - pos["spread_cost"] - pos["fee_cost"]

        state["capital"] += net_pnl
        if state["capital"] > state["peak_equity"]:
            state["peak_equity"] = state["capital"]

        closed = {
            **pos,
            "realized_vol": float(realized_vol),
            "gross_pnl": float(gross_pnl),
            "net_pnl": float(net_pnl),
            "capital_after": float(state["capital"]),
            "settled_at": datetime.now(timezone.utc).isoformat(),
        }
        state["closed_trades"].append(closed)
        newly_closed.append(closed)
        log.info(
            "Settled %s: implied=%.1f%% realized=%.1f%% gross=$%.2f net=$%.2f capital=$%.2f",
            entry_ts.strftime("%Y-%m-%d"), pos["implied_vol"], realized_vol,
            gross_pnl, net_pnl, state["capital"],
        )

    state["open_positions"] = still_open
    return newly_closed


# ---------- Decision ----------

def decide_action(state: dict, ohlcv: pd.DataFrame, dvol: pd.DataFrame) -> dict:
    """Decide whether to open a new SELL_VOL position today."""
    config = state["config"]
    now = pd.Timestamp.now(tz="UTC")
    today = now.strftime("%Y-%m-%d")

    # 1. Idempotency: at most one decision per UTC day
    if state["last_decision_date"] == today:
        state["skipped"]["by_idempotent"] += 1
        return {"action": "skip", "reason": "already decided today (idempotent)"}

    # 2. Stop loss pause check
    if state["stop_loss_pause_until"]:
        pause_until = pd.Timestamp(state["stop_loss_pause_until"])
        if now < pause_until:
            state["skipped"]["by_stop"] += 1
            state["last_decision_date"] = today
            return {
                "action": "skip",
                "reason": f"stop-loss pause until {pause_until.strftime('%Y-%m-%d')}",
            }
        else:
            state["stop_loss_pause_until"] = None
            state["peak_equity"] = state["capital"]
            log.info("Stop-loss pause ended, peak reset to $%.2f", state["capital"])

    # 3. Get current implied vol
    implied_vol = _interpolate_dvol(dvol, now)
    if implied_vol <= 0:
        return {"action": "skip", "reason": "no DVOL data near current ts"}

    # 4. Trailing realized vol filter
    if config["trail_days"] > 0:
        trail_start = now - pd.Timedelta(days=config["trail_days"])
        trail_mask = (ohlcv["timestamp"] >= trail_start) & (ohlcv["timestamp"] <= now)
        trail_closes = ohlcv.loc[trail_mask, "close"].values
        if len(trail_closes) >= 2:
            recent_rv = _compute_realized_vol(trail_closes)
            ratio = recent_rv / implied_vol
            if ratio >= config["trail_ratio"]:
                state["skipped"]["by_trail"] += 1
                state["last_decision_date"] = today
                return {
                    "action": "skip",
                    "reason": (
                        f"trailing filter (recent_rv={recent_rv:.1f}% "
                        f"implied={implied_vol:.1f}% ratio={ratio:.2f} >= {config['trail_ratio']})"
                    ),
                }

    # 5. Open a new SELL_VOL position
    underlying_price = float(ohlcv.iloc[-1]["close"])
    sqrt_t = math.sqrt(config["hold_days"] / 365)
    premium = config["notional"] * (implied_vol / 100) * sqrt_t
    spread_cost = premium * config["spread_pct"]

    settle_ts = now + pd.Timedelta(days=config["hold_days"])

    new_pos = {
        "entry_ts": now.isoformat(),
        "settle_ts": settle_ts.isoformat(),
        "implied_vol": float(implied_vol),
        "underlying_at_entry": underlying_price,
        "notional": config["notional"],
        "spread_cost": float(spread_cost),
        "fee_cost": config["fee_per_trade"],
    }
    state["open_positions"].append(new_pos)
    state["last_decision_date"] = today

    # Check stop loss against current SETTLED equity (not unsettled positions)
    if config["stop_loss_dd_pct"] > 0 and state["peak_equity"] > 0:
        current_dd = (state["peak_equity"] - state["capital"]) / state["peak_equity"]
        if current_dd >= config["stop_loss_dd_pct"]:
            pause_until = now + pd.Timedelta(days=config["stop_loss_pause_days"])
            state["stop_loss_pause_until"] = pause_until.isoformat()
            log.info(
                "STOP-LOSS triggered: dd=%.1f%%, pausing until %s",
                current_dd * 100, pause_until.strftime("%Y-%m-%d"),
            )

    return {
        "action": "open",
        "implied_vol": float(implied_vol),
        "settle_ts": settle_ts.isoformat(),
        "underlying": underlying_price,
        "premium": float(premium),
        "spread_cost": float(spread_cost),
    }


# ---------- Reporting ----------

def print_report(state: dict, action: dict, newly_closed: list[dict]) -> None:
    n_open = len(state["open_positions"])
    n_closed = len(state["closed_trades"])
    pnl_total = state["capital"] - state["initial_capital"]
    pnl_pct = pnl_total / state["initial_capital"] * 100
    dd_now = (
        (state["peak_equity"] - state["capital"]) / state["peak_equity"] * 100
        if state["peak_equity"] > 0 else 0.0
    )

    print()
    print("=" * 72)
    print(
        f"  PAPER TRADING — {state['currency']}  "
        f"({datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')})"
    )
    print("=" * 72)
    print(f"  Capital:        ${state['capital']:>10.2f}  "
          f"({pnl_pct:+.2f}% from ${state['initial_capital']:.2f})")
    print(f"  Peak equity:    ${state['peak_equity']:>10.2f}")
    print(f"  Current DD:     {dd_now:>10.2f}%")
    print(f"  Open positions: {n_open:>10d}")
    print(f"  Closed trades:  {n_closed:>10d}")
    sk = state["skipped"]
    print(f"  Skipped total:  trail={sk['by_trail']}  stop={sk['by_stop']}  "
          f"idempotent={sk['by_idempotent']}")
    print()

    if newly_closed:
        print(f"  SETTLED THIS RUN ({len(newly_closed)}):")
        for c in newly_closed:
            print(
                f"    {c['entry_ts'][:10]} -> {c['settle_ts'][:10]}: "
                f"implied={c['implied_vol']:.1f}% realized={c['realized_vol']:.1f}% "
                f"net=${c['net_pnl']:+8.2f}"
            )
        print()

    print(f"  TODAY'S DECISION: {action['action'].upper()}")
    if action["action"] == "open":
        print(f"    implied_vol={action['implied_vol']:.1f}%  "
              f"underlying=${action['underlying']:,.0f}")
        print(f"    settle_ts={action['settle_ts'][:19]}")
        print(f"    premium=${action['premium']:.2f}  "
              f"spread_cost=${action['spread_cost']:.2f}")
    elif action.get("reason"):
        print(f"    reason: {action['reason']}")

    if state["open_positions"]:
        print()
        print(f"  OPEN POSITIONS ({n_open}):")
        for pos in sorted(state["open_positions"], key=lambda p: p["settle_ts"]):
            print(
                f"    entry {pos['entry_ts'][:10]}  settle {pos['settle_ts'][:10]}  "
                f"implied={pos['implied_vol']:.1f}%  notional=${pos['notional']:.0f}"
            )

    print("=" * 72)
    print()


# ---------- CLI ----------

def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )

    parser = argparse.ArgumentParser(description="Daily paper trading runner")
    parser.add_argument("--currency", type=str, default="BTC")
    parser.add_argument("--init", action="store_true",
                        help="Initialize fresh state (DESTRUCTIVE if state exists)")
    parser.add_argument("--status", action="store_true",
                        help="Show full state JSON without running")
    parser.add_argument("--dry-run", action="store_true",
                        help="Run the decision logic but do NOT save state")
    args = parser.parse_args()

    PAPER_DIR.mkdir(parents=True, exist_ok=True)
    state = load_state(args.currency)

    if args.init:
        if state is not None:
            print(f"WARNING: state already exists for {args.currency} at {state_path(args.currency)}")
            confirm = input("Overwrite and start fresh? [y/N]: ")
            if confirm.lower() != "y":
                print("Aborted.")
                return
        state = init_state(args.currency, dict(DEFAULT_CONFIG))
        save_state(state)
        print(f"Initialized state for {args.currency} at {state_path(args.currency)}")
        print(f"  Initial capital: ${state['capital']:.2f}")
        print("  Config:")
        for k, v in state["config"].items():
            print(f"    {k} = {v}")
        print()
        print("Next: run without --init to fetch data and decide today's trade.")
        return

    if state is None:
        print(f"No state found for {args.currency}. Run with --init first.")
        return

    if args.status:
        print(json.dumps(state, indent=2, default=str))
        return

    # Daily run
    ohlcv, dvol = fetch_recent_data(args.currency, days=30)
    newly_closed = settle_due_positions(state, ohlcv)
    action = decide_action(state, ohlcv, dvol)

    if args.dry_run:
        log.info("DRY RUN: state will NOT be saved")
    else:
        save_state(state)

    print_report(state, action, newly_closed)


if __name__ == "__main__":
    main()
