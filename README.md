# Kronos Trading System

Zero-shot crypto trading signals using the Kronos foundation model.
No training required — the model is pre-trained on 12B+ K-line records from 45 global exchanges.

## Strategy

```
Binance OHLCV → Kronos (zero-shot) → Multi-trajectory sampling → Signal generation → Execution
```

## Phases

1. **Backtest** — Validate edge on historical data with real fees (weeks 1-2)
2. **Paper trade** — Live signals to Telegram, no capital (week 3)
3. **Live trade** — Minimum capital, automated execution (week 4+)

## Quick Start

```bash
# 1. Clone and install
cp config/settings.example.toml config/settings.toml
pip install -r requirements.txt

# 2. Download historical data from Binance
python -m src.data.fetch --pairs BTCUSDT,ETHUSDT,SOLUSDT --interval 15m --days 365

# 3. Run backtest (the money question)
python -m src.backtest.run --pairs BTCUSDT,ETHUSDT,SOLUSDT

# 4. If backtest is positive, start paper trading
python -m src.signals.scanner --mode paper

# 5. If paper trading confirms, go live (careful!)
python -m src.signals.scanner --mode live --capital 500
```

## Architecture

- **src/data/** — Binance OHLCV fetcher + data management
- **src/backtest/** — Walk-forward backtest with real fees
- **src/signals/** — Signal generation from Kronos predictions
- **src/execution/** — Telegram alerts + Binance order execution
- **config/** — Settings, no secrets in git
- **scripts/** — Utility scripts

## Volatility Trading

Uses Kronos to predict future realized volatility and compares it against Deribit's implied volatility (DVOL). When Kronos predicts vol significantly lower than what the market prices, options are expensive — sell vol (straddle). When Kronos predicts higher vol, options are cheap — buy vol.

```bash
# Volatility trading pipeline
python -m src.data.deribit --action all --currency BTC         # fetch Deribit data
python -m src.backtest.vol_backtest --currency BTC --days 365  # THE backtest
python -m src.volatility.signals --mode scan                   # one-shot scan
python -m src.volatility.signals --mode paper                  # continuous paper
```

## Requirements

- Python 3.10+
- PyTorch 2.1+
- ~2GB disk for Kronos-base model weights (downloaded automatically from HuggingFace)
- Binance API key (for live trading only — data fetch is public)
- Deribit API key (for live vol trading only — market data is public)
