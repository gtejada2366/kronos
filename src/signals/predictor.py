"""Kronos model wrapper.

Loads the official Kronos pre-trained model from HuggingFace and provides
a simple interface for generating predictions on Binance OHLCV data.

The model handles tokenization, normalization, and denormalization internally.

Usage:
    from src.signals.predictor import KronosEngine
    engine = KronosEngine()
    predictions = engine.predict(df, pred_len=12, sample_count=10)
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path

import pandas as pd
import numpy as np

from src.config import get

log = logging.getLogger("kronos.predictor")

# We need the official Kronos model code. It's loaded from the cloned repo
# or installed as a package. The user should clone the Kronos repo and
# add it to their path, or we vendor the model/ directory.
#
# For now, we expect the official Kronos repo's `model/` dir to be available.
# The setup script handles this.

_MODEL = None
_TOKENIZER = None
_PREDICTOR = None


def _ensure_kronos_importable():
    """Ensure the Kronos model package is importable.

    The official Kronos repo has a `model/` directory with the model code.
    We need this on the Python path.
    """
    # Check if already importable
    try:
        from model import Kronos, KronosTokenizer, KronosPredictor
        return True
    except ImportError:
        pass

    # Try common locations
    candidates = [
        Path(__file__).parent.parent.parent / "vendor" / "Kronos",
        Path(__file__).parent.parent.parent / "Kronos",
        Path.home() / "Kronos",
    ]
    for p in candidates:
        if (p / "model").exists():
            sys.path.insert(0, str(p))
            try:
                from model import Kronos, KronosTokenizer, KronosPredictor
                log.info("Found Kronos model at %s", p)
                return True
            except ImportError:
                sys.path.pop(0)

    return False


class KronosEngine:
    """Wrapper around the official Kronos model for trading signals."""

    def __init__(
        self,
        model_name: str | None = None,
        tokenizer_name: str | None = None,
        device: str | None = None,
        max_context: int | None = None,
    ):
        self.model_name = model_name or get("kronos", "model_name", "NeoQuasar/Kronos-small")
        self.tokenizer_name = tokenizer_name or get("kronos", "tokenizer_name", "NeoQuasar/Kronos-Tokenizer-base")
        self.device = device or get("kronos", "device", "cpu")
        self.max_context = max_context or get("kronos", "max_context", 512)

        self._model = None
        self._tokenizer = None
        self._predictor = None
        self._loaded = False

    def load(self):
        """Load the Kronos model and tokenizer from HuggingFace."""
        if self._loaded:
            return

        if not _ensure_kronos_importable():
            raise ImportError(
                "Cannot import Kronos model. Please either:\n"
                "1. Clone the official repo: git clone https://github.com/shiyu-coder/Kronos.git vendor/Kronos\n"
                "2. Or symlink it: ln -s /path/to/Kronos vendor/Kronos"
            )

        from model import Kronos, KronosTokenizer, KronosPredictor

        log.info("Loading tokenizer: %s", self.tokenizer_name)
        self._tokenizer = KronosTokenizer.from_pretrained(self.tokenizer_name)

        log.info("Loading model: %s (this may download ~500MB first time)", self.model_name)
        self._model = Kronos.from_pretrained(self.model_name)

        self._predictor = KronosPredictor(
            self._model, self._tokenizer, max_context=self.max_context
        )

        self._loaded = True
        log.info("Kronos loaded on device: %s", self.device)

    def predict(
        self,
        df: pd.DataFrame,
        pred_len: int | None = None,
        sample_count: int | None = None,
        temperature: float | None = None,
        top_p: float | None = None,
    ) -> pd.DataFrame:
        """Generate price predictions from OHLCV data.

        Args:
            df: DataFrame with columns [open, high, low, close, volume, amount].
                'volume' and 'amount' are optional.
            pred_len: Number of future candles to predict.
            sample_count: Number of trajectories to sample and average.
            temperature: Sampling temperature.
            top_p: Nucleus sampling threshold.

        Returns:
            DataFrame with predicted OHLCV values for pred_len future candles.
        """
        self.load()

        _pred_len = pred_len or get("trading", "pred_len", 12)
        _sample = sample_count or get("trading", "sample_count", 10)
        _temp = temperature or get("trading", "temperature", 0.6)
        _top_p = top_p or get("trading", "top_p", 0.9)

        # Ensure required columns
        required = ["open", "high", "low", "close"]
        for col in required:
            if col not in df.columns:
                raise ValueError(f"Missing column: {col}")

        # Prepare input DataFrame (Kronos expects lowercase column names)
        input_df = df[["open", "high", "low", "close"]].copy()
        if "volume" in df.columns:
            input_df["volume"] = df["volume"]
        if "amount" in df.columns:
            input_df["amount"] = df["amount"]

        # Prepare timestamps
        if "timestamp" in df.columns:
            x_timestamp = pd.Series(df["timestamp"].values)
        else:
            # Generate synthetic timestamps if not provided
            x_timestamp = pd.Series(pd.date_range(
                end=pd.Timestamp.now(tz="UTC"),
                periods=len(df),
                freq="15min",
            ))

        # Generate future timestamps
        last_ts = x_timestamp.iloc[-1]
        if hasattr(last_ts, "freq") and last_ts.freq:
            freq = last_ts.freq
        else:
            # Infer from data
            if len(x_timestamp) > 1:
                delta = x_timestamp.iloc[-1] - x_timestamp.iloc[-2]
            else:
                delta = pd.Timedelta(minutes=15)
            freq = delta

        y_timestamp = pd.Series([
            last_ts + freq * (i + 1) for i in range(_pred_len)
        ])

        # Run prediction
        pred_df = self._predictor.predict(
            df=input_df,
            x_timestamp=x_timestamp,
            y_timestamp=y_timestamp,
            pred_len=_pred_len,
            T=_temp,
            top_p=_top_p,
            sample_count=_sample,
        )

        return pred_df

    def predict_return(
        self,
        df: pd.DataFrame,
        pred_len: int | None = None,
        sample_count: int | None = None,
        temperature: float | None = None,
        top_p: float | None = None,
    ) -> dict:
        """Predict expected return and direction.

        Returns dict with:
            - expected_return: float (predicted % change in close price)
            - direction: "up" or "down"
            - pred_close: predicted close at end of horizon
            - current_close: current close price
        """
        pred_df = self.predict(df, pred_len, sample_count, temperature, top_p)

        current_close = df["close"].iloc[-1]
        pred_close = pred_df["close"].iloc[-1]
        expected_return = (pred_close - current_close) / current_close

        return {
            "expected_return": expected_return,
            "direction": "up" if expected_return > 0 else "down",
            "pred_close": pred_close,
            "current_close": current_close,
            "pred_df": pred_df,
        }

    def predict_trajectories(
        self,
        df: pd.DataFrame,
        n_trajectories: int = 10,
        pred_len: int | None = None,
        temperature: float | None = None,
        top_p: float | None = None,
    ) -> list[dict]:
        """Generate multiple independent trajectories for probabilistic analysis.

        Each trajectory is a separate sample from the model.
        This gives us a distribution over possible futures.
        """
        trajectories = []
        for i in range(n_trajectories):
            result = self.predict_return(
                df, pred_len, sample_count=1, temperature=temperature, top_p=top_p
            )
            trajectories.append(result)

        return trajectories
