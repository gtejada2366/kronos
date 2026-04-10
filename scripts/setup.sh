#!/bin/bash
# Setup script for Kronos Trading System
# Clones the official Kronos model repo and installs dependencies

set -e

echo "=== Kronos Trading System Setup ==="

# 1. Install Python dependencies
echo "Installing Python dependencies..."
pip install -r requirements.txt

# 2. Clone official Kronos repo (for model code)
if [ ! -d "vendor/Kronos" ]; then
    echo "Cloning official Kronos model repo..."
    mkdir -p vendor
    git clone --depth 1 https://github.com/shiyu-coder/Kronos.git vendor/Kronos
    echo "Kronos model code cloned to vendor/Kronos"
else
    echo "Kronos model code already exists at vendor/Kronos"
fi

# 3. Copy config if needed
if [ ! -f "config/settings.toml" ]; then
    cp config/settings.example.toml config/settings.toml
    echo "Created config/settings.toml — edit with your settings"
else
    echo "config/settings.toml already exists"
fi

# 4. Create data directories
mkdir -p data/raw data/cache

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Edit config/settings.toml (optional — defaults work for backtesting)"
echo "  2. Fetch data:    python -m src.data.fetch --pairs BTCUSDT,ETHUSDT,SOLUSDT --days 365"
echo "  3. Run backtest:  python -m src.backtest.run --pairs BTCUSDT,ETHUSDT,SOLUSDT"
echo ""
