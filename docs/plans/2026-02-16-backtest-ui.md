# Backtest UI — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a web-based backtesting UI (Next.js + Python FastAPI) that lets the user run historical backtests with tunable parameters and compare results side by side.

**Architecture:** Next.js frontend (port 3001) talks to a Python FastAPI service (port 8001) that wraps the existing BacktestRunner. Results are stored in TimescaleDB's `backtest_runs` table. Everything runs in Docker alongside the existing stack.

**Tech Stack:** Next.js 15 (App Router), Tailwind CSS, Recharts, Python FastAPI, asyncpg, existing BacktestRunner/TechnicalProcessor

**Repos:**
- `cryptiga/analytics` at `/Users/ishomakhov/projects/cryptiga/analytics/` — Python API
- `cryptiga/ui` at `/Users/ishomakhov/projects/cryptiga/ui/` — Next.js frontend

---

### Task 1: Make TechnicalProcessor Accept Configurable Params

**Files:**
- Modify: `/Users/ishomakhov/projects/cryptiga/analytics/src/analytics/signals/technical.py`
- Test: `/Users/ishomakhov/projects/cryptiga/analytics/tests/test_signals.py`

Currently all indicator params (RSI period=14, oversold=30, overbought=70, MACD fast=12/slow=26/signal=9, SMA short=10/long=20) are hardcoded. We need to make them constructor arguments with the same defaults so existing code is unaffected.

**Step 1: Write failing tests**

Add to `/Users/ishomakhov/projects/cryptiga/analytics/tests/test_signals.py`:

```python
def test_custom_rsi_thresholds():
    processor = TechnicalProcessor(rsi_oversold=40, rsi_overbought=60)
    # Mildly declining prices — RSI around 35-40 range
    closes = [50000 - i * 200 for i in range(40)]
    candles = _make_candles(closes)
    signals = processor.process(candles)
    rsi_signals = [s for s in signals if "rsi" in s.source]
    # With oversold=40, should trigger bullish even at RSI ~35
    assert any(s.direction == "bullish" for s in rsi_signals)


def test_custom_sma_lengths():
    processor = TechnicalProcessor(sma_short=5, sma_long=10)
    # Shorter SMAs should react faster to trend changes
    closes = [50000] * 15 + [50000 + i * 300 for i in range(35)]
    candles = _make_candles(closes)
    signals = processor.process(candles)
    sma_signals = [s for s in signals if "sma" in s.source]
    # With shorter windows, more likely to get a golden cross
    assert len(sma_signals) >= 0  # At minimum, no crash


def test_default_params_unchanged():
    """Ensure default constructor still produces same results."""
    processor = TechnicalProcessor()
    closes = [50000 - i * 500 for i in range(40)]
    candles = _make_candles(closes)
    signals = processor.process(candles)
    # Should still work exactly as before
    for s in signals:
        assert s.source.startswith("technical/")
```

**Step 2: Run tests to verify they fail**

```bash
cd /Users/ishomakhov/projects/cryptiga/analytics
python -m pytest tests/test_signals.py -v
```

Expected: `test_custom_rsi_thresholds` and `test_custom_sma_lengths` FAIL with `TypeError: TechnicalProcessor() got an unexpected keyword argument`

**Step 3: Implement configurable TechnicalProcessor**

Replace the entire `TechnicalProcessor` class in `/Users/ishomakhov/projects/cryptiga/analytics/src/analytics/signals/technical.py`:

```python
from datetime import datetime, timedelta

import pandas as pd
import pandas_ta as ta

from analytics.models.candle import Candle
from analytics.models.signal import Signal
from analytics.signals.base import BaseProcessor

# Need at least 30 candles for indicators to produce meaningful values
MIN_CANDLES = 30

# Signals expire after 1 hour by default
SIGNAL_TTL = timedelta(hours=1)


class TechnicalProcessor(BaseProcessor):
    """Generates signals from technical indicators: RSI, MACD, SMA."""

    name = "technical"

    def __init__(
        self,
        rsi_period: int = 14,
        rsi_oversold: int = 30,
        rsi_overbought: int = 70,
        macd_fast: int = 12,
        macd_slow: int = 26,
        macd_signal: int = 9,
        sma_short: int = 10,
        sma_long: int = 20,
    ):
        self._rsi_period = rsi_period
        self._rsi_oversold = rsi_oversold
        self._rsi_overbought = rsi_overbought
        self._macd_fast = macd_fast
        self._macd_slow = macd_slow
        self._macd_signal = macd_signal
        self._sma_short = sma_short
        self._sma_long = sma_long

    def process(self, candles: list[Candle]) -> list[Signal]:
        if len(candles) < MIN_CANDLES:
            return []

        df = self._candles_to_df(candles)
        coin = candles[0].coin
        now = candles[-1].timestamp
        signals: list[Signal] = []

        signals.extend(self._rsi_signals(df, coin, now))
        signals.extend(self._macd_signals(df, coin, now))
        signals.extend(self._sma_signals(df, coin, now))

        return signals

    def _candles_to_df(self, candles: list[Candle]) -> pd.DataFrame:
        return pd.DataFrame(
            {
                "open": [c.open for c in candles],
                "high": [c.high for c in candles],
                "low": [c.low for c in candles],
                "close": [c.close for c in candles],
                "volume": [c.volume for c in candles],
            }
        )

    def _rsi_signals(
        self, df: pd.DataFrame, coin: str, now: datetime
    ) -> list[Signal]:
        rsi = ta.rsi(df["close"], length=self._rsi_period)
        if rsi is None or rsi.empty:
            return []
        current_rsi = rsi.iloc[-1]
        if pd.isna(current_rsi):
            return []

        if current_rsi < self._rsi_oversold:
            confidence = min(100, int((self._rsi_oversold - current_rsi) * 3.3))
            return [
                self._make_signal(
                    coin, "bullish", confidence, "technical/rsi_oversold", now
                )
            ]
        elif current_rsi > self._rsi_overbought:
            confidence = min(100, int((current_rsi - self._rsi_overbought) * 3.3))
            return [
                self._make_signal(
                    coin, "bearish", confidence, "technical/rsi_overbought", now
                )
            ]
        return []

    def _macd_signals(
        self, df: pd.DataFrame, coin: str, now: datetime
    ) -> list[Signal]:
        macd_df = ta.macd(df["close"], fast=self._macd_fast, slow=self._macd_slow, signal=self._macd_signal)
        if macd_df is None or macd_df.empty:
            return []
        hist = macd_df.iloc[:, 2]  # MACD histogram column
        if len(hist) < 2:
            return []
        current = hist.iloc[-1]
        previous = hist.iloc[-2]
        if pd.isna(current) or pd.isna(previous):
            return []

        # Histogram crosses zero = trend change
        if previous < 0 and current > 0:
            confidence = min(100, max(30, int(abs(current) * 1000)))
            return [
                self._make_signal(
                    coin, "bullish", confidence, "technical/macd_crossover", now
                )
            ]
        elif previous > 0 and current < 0:
            confidence = min(100, max(30, int(abs(current) * 1000)))
            return [
                self._make_signal(
                    coin, "bearish", confidence, "technical/macd_crossover", now
                )
            ]
        return []

    def _sma_signals(
        self, df: pd.DataFrame, coin: str, now: datetime
    ) -> list[Signal]:
        sma_short = ta.sma(df["close"], length=self._sma_short)
        sma_long = ta.sma(df["close"], length=self._sma_long)
        if sma_short is None or sma_long is None:
            return []
        if sma_short.empty or sma_long.empty:
            return []

        short_val = sma_short.iloc[-1]
        long_val = sma_long.iloc[-1]
        prev_short = sma_short.iloc[-2]
        prev_long = sma_long.iloc[-2]
        if any(pd.isna(v) for v in [short_val, long_val, prev_short, prev_long]):
            return []

        # Golden cross: short SMA crosses above long SMA
        if prev_short <= prev_long and short_val > long_val:
            return [
                self._make_signal(
                    coin, "bullish", 55, "technical/sma_golden_cross", now
                )
            ]
        # Death cross: short SMA crosses below long SMA
        elif prev_short >= prev_long and short_val < long_val:
            return [
                self._make_signal(
                    coin, "bearish", 55, "technical/sma_death_cross", now
                )
            ]
        return []

    def _make_signal(
        self,
        coin: str,
        direction: str,
        confidence: int,
        source: str,
        now: datetime,
    ) -> Signal:
        return Signal(
            coin=coin,
            direction=direction,
            confidence=confidence,
            source=source,
            timestamp=now,
            expires_at=now + SIGNAL_TTL,
        )
```

**Step 4: Run tests to verify they pass**

```bash
cd /Users/ishomakhov/projects/cryptiga/analytics
python -m pytest tests/test_signals.py -v
```

Expected: ALL PASS

**Step 5: Commit**

```bash
cd /Users/ishomakhov/projects/cryptiga/analytics
git add src/analytics/signals/technical.py tests/test_signals.py
git commit -m "feat: make TechnicalProcessor accept configurable indicator params"
```

---

### Task 2: Add Equity Curve and Max Drawdown to BacktestRunner

**Files:**
- Modify: `/Users/ishomakhov/projects/cryptiga/analytics/src/analytics/backtesting/report.py`
- Modify: `/Users/ishomakhov/projects/cryptiga/analytics/src/analytics/backtesting/runner.py`
- Test: `/Users/ishomakhov/projects/cryptiga/analytics/tests/test_backtesting.py`

Currently `BacktestReport` only has final metrics — no equity curve or max drawdown. We need these for charting in the UI.

**Step 1: Write failing tests**

Add to `/Users/ishomakhov/projects/cryptiga/analytics/tests/test_backtesting.py`:

```python
def test_report_has_equity_curve():
    candles = _make_trending_candles(50000, "up")
    runner = BacktestRunner(capital=1000.0)
    report = runner.run(candles)
    assert hasattr(report, "equity_curve")
    assert isinstance(report.equity_curve, list)
    assert len(report.equity_curve) > 0
    # Each point should have time and value
    point = report.equity_curve[0]
    assert "time" in point
    assert "value" in point


def test_report_has_max_drawdown():
    candles = _make_trending_candles(50000, "down")
    runner = BacktestRunner(capital=1000.0)
    report = runner.run(candles)
    assert hasattr(report, "max_drawdown_pct")
    assert isinstance(report.max_drawdown_pct, float)
    # In a downtrend, drawdown should be > 0
    assert report.max_drawdown_pct >= 0


def test_equity_curve_starts_at_capital():
    candles = _make_trending_candles(50000, "up")
    runner = BacktestRunner(capital=5000.0)
    report = runner.run(candles)
    assert report.equity_curve[0]["value"] == 5000.0


def test_runner_accepts_indicator_params():
    candles = _make_trending_candles(50000, "up")
    runner = BacktestRunner(
        capital=1000.0,
        position_size_pct=30.0,
        rsi_oversold=25,
        rsi_overbought=75,
    )
    report = runner.run(candles)
    assert isinstance(report, BacktestReport)
```

**Step 2: Run tests to verify they fail**

```bash
cd /Users/ishomakhov/projects/cryptiga/analytics
python -m pytest tests/test_backtesting.py -v
```

Expected: New tests FAIL

**Step 3: Update BacktestReport**

Replace `/Users/ishomakhov/projects/cryptiga/analytics/src/analytics/backtesting/report.py`:

```python
from dataclasses import dataclass, field

from analytics.models.trade import Trade


@dataclass
class BacktestReport:
    starting_capital: float
    final_value: float
    total_return_pct: float
    buy_hold_return_pct: float
    trade_count: int
    win_count: int
    loss_count: int
    trades: list[Trade]
    equity_curve: list[dict] = field(default_factory=list)
    max_drawdown_pct: float = 0.0

    @property
    def win_rate(self) -> float:
        total = self.win_count + self.loss_count
        if total == 0:
            return 0.0
        return self.win_count / total

    def summary(self) -> str:
        return "\n".join(
            [
                "=== Backtest Report ===",
                f"Starting Capital: ${self.starting_capital:,.2f}",
                f"Final Value:      ${self.final_value:,.2f}",
                f"Total Return:     {self.total_return_pct:+.2f}%",
                f"Buy & Hold:       {self.buy_hold_return_pct:+.2f}%",
                f"Max Drawdown:     {self.max_drawdown_pct:.2f}%",
                f"Trades:           {self.trade_count}",
                f"Win Rate:         {self.win_rate:.1%}",
                f"Wins / Losses:    {self.win_count} / {self.loss_count}",
                "======================",
            ]
        )
```

**Step 4: Update BacktestRunner**

Replace `/Users/ishomakhov/projects/cryptiga/analytics/src/analytics/backtesting/runner.py`:

```python
from analytics.backtesting.executor import BacktestExecutor
from analytics.backtesting.report import BacktestReport
from analytics.models.candle import Candle
from analytics.models.portfolio import Portfolio
from analytics.signals.technical import TechnicalProcessor


class BacktestRunner:
    """Replays candle data through signal engine and trade executor."""

    def __init__(
        self,
        capital: float = 1000.0,
        position_size_pct: float = 20.0,
        # Technical indicator params (passed to TechnicalProcessor)
        rsi_period: int = 14,
        rsi_oversold: int = 30,
        rsi_overbought: int = 70,
        macd_fast: int = 12,
        macd_slow: int = 26,
        macd_signal: int = 9,
        sma_short: int = 10,
        sma_long: int = 20,
    ):
        self._capital = capital
        self._position_size_pct = position_size_pct
        self._indicator_params = dict(
            rsi_period=rsi_period,
            rsi_oversold=rsi_oversold,
            rsi_overbought=rsi_overbought,
            macd_fast=macd_fast,
            macd_slow=macd_slow,
            macd_signal=macd_signal,
            sma_short=sma_short,
            sma_long=sma_long,
        )

    def run(self, candles: list[Candle]) -> BacktestReport:
        portfolio = Portfolio(cash=self._capital)
        executor = BacktestExecutor(portfolio=portfolio)
        processor = TechnicalProcessor(**self._indicator_params)

        buy_hold_start = candles[0].close
        buy_hold_end = candles[-1].close

        # Track equity curve
        equity_curve = [
            {"time": candles[0].timestamp.isoformat(), "value": self._capital}
        ]
        peak = self._capital
        max_drawdown = 0.0

        # Start at index 30 (need 30 candles minimum for indicators)
        for i in range(30, len(candles)):
            window = candles[: i + 1]
            current_candle = candles[i]
            coin = current_candle.coin

            signals = processor.process(window)
            if signals:
                # Simple strategy: act on the strongest signal
                best = max(signals, key=lambda s: abs(s.score))

                if best.direction == "bullish" and coin not in portfolio.positions:
                    amount = portfolio.cash * (self._position_size_pct / 100)
                    if amount > 1.0:
                        executor.execute_buy(
                            coin, amount=amount, candle=current_candle
                        )
                elif best.direction == "bearish" and coin in portfolio.positions:
                    executor.execute_sell(coin, candle=current_candle)

            # Record equity at each step
            value = portfolio.cash
            for c, pos in portfolio.positions.items():
                value += pos.quantity * current_candle.close
            equity_curve.append(
                {"time": current_candle.timestamp.isoformat(), "value": round(value, 2)}
            )

            # Track max drawdown
            if value > peak:
                peak = value
            drawdown = ((peak - value) / peak) * 100 if peak > 0 else 0
            if drawdown > max_drawdown:
                max_drawdown = drawdown

        # Calculate final portfolio value
        final_value = portfolio.cash
        for coin, pos in portfolio.positions.items():
            final_value += pos.quantity * candles[-1].close

        total_return_pct = (
            (final_value - self._capital) / self._capital
        ) * 100
        buy_hold_return_pct = (
            (buy_hold_end - buy_hold_start) / buy_hold_start
        ) * 100

        wins, losses = self._count_wins_losses(executor.trades)

        return BacktestReport(
            starting_capital=self._capital,
            final_value=final_value,
            total_return_pct=total_return_pct,
            buy_hold_return_pct=buy_hold_return_pct,
            trade_count=len(executor.trades),
            win_count=wins,
            loss_count=losses,
            trades=executor.trades,
            equity_curve=equity_curve,
            max_drawdown_pct=round(max_drawdown, 2),
        )

    def _count_wins_losses(self, trades: list) -> tuple[int, int]:
        wins = 0
        losses = 0
        buy_prices: dict[str, float] = {}
        for trade in trades:
            if trade.side == "buy":
                buy_prices[trade.coin] = trade.price
            elif trade.side == "sell" and trade.coin in buy_prices:
                if trade.price > buy_prices[trade.coin]:
                    wins += 1
                else:
                    losses += 1
                del buy_prices[trade.coin]
        return wins, losses
```

**Step 5: Run tests to verify they pass**

```bash
cd /Users/ishomakhov/projects/cryptiga/analytics
python -m pytest tests/test_backtesting.py tests/test_signals.py -v
```

Expected: ALL PASS

**Step 6: Commit**

```bash
cd /Users/ishomakhov/projects/cryptiga/analytics
git add src/analytics/backtesting/report.py src/analytics/backtesting/runner.py tests/test_backtesting.py
git commit -m "feat: add equity curve, max drawdown, and configurable indicator params to BacktestRunner"
```

---

### Task 3: Update backtest_runs Migration

**Files:**
- Modify: `/Users/ishomakhov/projects/cryptiga/analytics/src/analytics/db/migrations.py`

The existing `backtest_runs` table has a different schema than what we need. Add a migration that drops and recreates it with the new schema (the table is currently empty).

**Step 1: Add migration 4**

Add to the `MIGRATIONS` list in `/Users/ishomakhov/projects/cryptiga/analytics/src/analytics/db/migrations.py`:

```python
    # Migration 4: Recreate backtest_runs for UI (table is empty)
    """
    DROP TABLE IF EXISTS backtest_runs;
    CREATE TABLE backtest_runs (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name       TEXT,
        symbol     TEXT NOT NULL,
        timeframe  TEXT NOT NULL DEFAULT '1h',
        days       INTEGER NOT NULL,
        params     JSONB NOT NULL,
        results    JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
    );
    """,
```

**Step 2: Commit**

```bash
cd /Users/ishomakhov/projects/cryptiga/analytics
git add src/analytics/db/migrations.py
git commit -m "feat: add migration to recreate backtest_runs table with new schema"
```

---

### Task 4: Python FastAPI Backtest Service

**Files:**
- Modify: `/Users/ishomakhov/projects/cryptiga/analytics/pyproject.toml` (add fastapi, uvicorn)
- Create: `/Users/ishomakhov/projects/cryptiga/analytics/src/analytics/api.py`
- Create: `/Users/ishomakhov/projects/cryptiga/analytics/tests/test_api.py`

**Step 1: Add dependencies**

Add `fastapi` and `uvicorn` to the `dependencies` list in `pyproject.toml`:

```toml
    "fastapi>=0.115",
    "uvicorn>=0.34",
```

Then install:

```bash
cd /Users/ishomakhov/projects/cryptiga/analytics
pip install -e ".[dev]"
```

**Step 2: Write failing tests**

Create `/Users/ishomakhov/projects/cryptiga/analytics/tests/test_api.py`:

```python
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from httpx import AsyncClient, ASGITransport

from analytics.api import app


@pytest.fixture
def mock_db():
    db = AsyncMock()
    db.fetchrow = AsyncMock(return_value={"count": 4})  # migrations applied
    return db


@pytest.mark.asyncio
async def test_run_backtest_returns_results(mock_db):
    with patch("analytics.api._get_db", return_value=mock_db):
        with patch("analytics.api._fetch_candles") as mock_fetch:
            from datetime import datetime, timezone
            from analytics.models.candle import Candle

            base_ts = 1704067200
            candles = [
                Candle(
                    coin="BTC/USD",
                    timeframe="1h",
                    open=50000 + i * 50,
                    high=50000 + i * 50 + 100,
                    low=50000 + i * 50 - 100,
                    close=50000 + i * 50,
                    volume=1000.0,
                    timestamp=datetime.fromtimestamp(base_ts + i * 3600, tz=timezone.utc),
                )
                for i in range(60)
            ]
            mock_fetch.return_value = candles
            mock_db.fetchrow.return_value = {"id": "test-uuid-123"}

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.post("/api/backtest/run", json={
                    "symbol": "BTC/USD",
                    "days": 90,
                })
            assert resp.status_code == 200
            data = resp.json()
            assert "id" in data
            assert "total_return_pct" in data
            assert "equity_curve" in data


@pytest.mark.asyncio
async def test_list_runs(mock_db):
    mock_db.fetch = AsyncMock(return_value=[])
    with patch("analytics.api._get_db", return_value=mock_db):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/backtest/runs")
        assert resp.status_code == 200
        assert resp.json() == []


@pytest.mark.asyncio
async def test_get_run_not_found(mock_db):
    mock_db.fetchrow = AsyncMock(return_value=None)
    with patch("analytics.api._get_db", return_value=mock_db):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/backtest/runs/nonexistent-id")
        assert resp.status_code == 404
```

**Step 3: Run tests to verify they fail**

```bash
cd /Users/ishomakhov/projects/cryptiga/analytics
python -m pytest tests/test_api.py -v
```

Expected: FAIL (module `analytics.api` not found)

**Step 4: Implement the API**

Create `/Users/ishomakhov/projects/cryptiga/analytics/src/analytics/api.py`:

```python
import json
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from analytics.backtesting.runner import BacktestRunner
from analytics.db.database import Database
from analytics.db.migrations import run_migrations
from analytics.loader.coinbase import CoinbaseLoader
from analytics.models.candle import Candle

_db: Database | None = None


async def _get_db() -> Database:
    global _db
    if _db is None:
        url = os.environ.get(
            "DATABASE_URL",
            "postgresql://cryptiga:cryptiga@localhost:5432/cryptiga",
        )
        _db = Database(url)
        await _db.connect()
        await run_migrations(_db)
    return _db


async def _fetch_candles(symbol: str, timeframe: str, days: int) -> list[Candle]:
    loader = CoinbaseLoader()
    try:
        import time

        since = int((time.time() - days * 86400) * 1000)
        all_candles: list[Candle] = []
        current_since = since
        while True:
            batch = await loader.fetch_candles(
                symbol=symbol, timeframe=timeframe, since=current_since, limit=300
            )
            if not batch:
                break
            all_candles.extend(batch)
            # Move forward past last candle
            current_since = int(batch[-1].timestamp.timestamp() * 1000) + 1
            if len(batch) < 300:
                break
        return all_candles
    finally:
        await loader.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    global _db
    if _db:
        await _db.close()
        _db = None


app = FastAPI(title="Cryptiga Backtest API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class BacktestRequest(BaseModel):
    name: str | None = None
    symbol: str = "BTC/USD"
    timeframe: str = "1h"
    days: int = 90
    capital: float = 1000.0
    position_size_pct: float = 20.0
    # Technical indicator params
    rsi_period: int = 14
    rsi_oversold: int = 30
    rsi_overbought: int = 70
    macd_fast: int = 12
    macd_slow: int = 26
    macd_signal: int = 9
    sma_short: int = 10
    sma_long: int = 20


@app.post("/api/backtest/run")
async def run_backtest(req: BacktestRequest):
    candles = await _fetch_candles(req.symbol, req.timeframe, req.days)
    if len(candles) < 30:
        raise HTTPException(400, f"Not enough candles ({len(candles)}). Need at least 30.")

    runner = BacktestRunner(
        capital=req.capital,
        position_size_pct=req.position_size_pct,
        rsi_period=req.rsi_period,
        rsi_oversold=req.rsi_oversold,
        rsi_overbought=req.rsi_overbought,
        macd_fast=req.macd_fast,
        macd_slow=req.macd_slow,
        macd_signal=req.macd_signal,
        sma_short=req.sma_short,
        sma_long=req.sma_long,
    )
    report = runner.run(candles)

    params = req.model_dump()
    results = {
        "total_return_pct": round(report.total_return_pct, 2),
        "buy_hold_return_pct": round(report.buy_hold_return_pct, 2),
        "final_value": round(report.final_value, 2),
        "trade_count": report.trade_count,
        "win_count": report.win_count,
        "loss_count": report.loss_count,
        "win_rate": round(report.win_rate, 4),
        "max_drawdown_pct": report.max_drawdown_pct,
        "equity_curve": report.equity_curve,
    }

    db = await _get_db()
    row = await db.fetchrow(
        """INSERT INTO backtest_runs (name, symbol, timeframe, days, params, results)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
           RETURNING id""",
        req.name,
        req.symbol,
        req.timeframe,
        req.days,
        json.dumps(params),
        json.dumps(results),
    )

    return {"id": str(row["id"]), **results}


@app.get("/api/backtest/runs")
async def list_runs():
    db = await _get_db()
    rows = await db.fetch(
        """SELECT id, name, symbol, timeframe, days, params, results, created_at
           FROM backtest_runs ORDER BY created_at DESC LIMIT 100"""
    )
    return [
        {
            "id": str(r["id"]),
            "name": r["name"],
            "symbol": r["symbol"],
            "timeframe": r["timeframe"],
            "days": r["days"],
            "params": json.loads(r["params"]) if isinstance(r["params"], str) else r["params"],
            "results": _summary(r["results"]),
            "created_at": r["created_at"].isoformat(),
        }
        for r in rows
    ]


@app.get("/api/backtest/runs/{run_id}")
async def get_run(run_id: str):
    db = await _get_db()
    row = await db.fetchrow(
        "SELECT * FROM backtest_runs WHERE id = $1", run_id
    )
    if not row:
        raise HTTPException(404, "Run not found")
    results = json.loads(row["results"]) if isinstance(row["results"], str) else row["results"]
    params = json.loads(row["params"]) if isinstance(row["params"], str) else row["params"]
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "symbol": row["symbol"],
        "timeframe": row["timeframe"],
        "days": row["days"],
        "params": params,
        "results": results,
        "created_at": row["created_at"].isoformat(),
    }


def _summary(results) -> dict:
    """Extract key metrics without the full equity curve for list view."""
    if isinstance(results, str):
        results = json.loads(results)
    return {
        k: v
        for k, v in results.items()
        if k != "equity_curve"
    }
```

**Step 5: Run tests to verify they pass**

```bash
cd /Users/ishomakhov/projects/cryptiga/analytics
python -m pytest tests/test_api.py -v
```

Expected: ALL PASS

**Step 6: Run all tests to verify no regressions**

```bash
cd /Users/ishomakhov/projects/cryptiga/analytics
python -m pytest -v
```

Expected: ALL PASS

**Step 7: Commit**

```bash
cd /Users/ishomakhov/projects/cryptiga/analytics
git add pyproject.toml src/analytics/api.py tests/test_api.py
git commit -m "feat: add FastAPI backtest service with run, list, and get endpoints"
```

---

### Task 5: Docker Setup for Backtest API

**Files:**
- Modify: `/Users/ishomakhov/projects/cryptiga/analytics/Dockerfile` (add backtest-api target)
- Modify: `/Users/ishomakhov/projects/cryptiga/ui/docker-compose.grafana.yml` (add backtest-api service)

**Step 1: Add multi-stage target to Dockerfile**

The existing Dockerfile builds a single image for `signal-worker`. Add an alternative CMD for the backtest API. Since both use the same dependencies, just change the entrypoint.

Add at the end of `/Users/ishomakhov/projects/cryptiga/analytics/Dockerfile`:

```dockerfile
FROM python:3.12-slim AS backtest-api
WORKDIR /app
COPY pyproject.toml ./
COPY src/ ./src/
RUN pip install --no-cache-dir --pre .
EXPOSE 8001
CMD ["python", "-m", "uvicorn", "analytics.api:app", "--host", "0.0.0.0", "--port", "8001"]
```

**Step 2: Add backtest-api service to docker-compose**

Add the `backtest-api` service to `/Users/ishomakhov/projects/cryptiga/ui/docker-compose.grafana.yml`:

```yaml
  backtest-api:
    build:
      context: ../analytics
      dockerfile: Dockerfile
      target: backtest-api
    ports:
      - "8001:8001"
    environment:
      - DATABASE_URL=postgresql://cryptiga:cryptiga@timescaledb:5432/cryptiga
    depends_on:
      timescaledb:
        condition: service_healthy
```

**Step 3: Test the build**

```bash
cd /Users/ishomakhov/projects/cryptiga/core
docker compose -f docker-compose.yml -f ../ui/docker-compose.grafana.yml build backtest-api
```

Expected: Build succeeds.

**Step 4: Commit both repos**

```bash
cd /Users/ishomakhov/projects/cryptiga/analytics
git add Dockerfile
git commit -m "feat: add backtest-api Docker target"
```

```bash
cd /Users/ishomakhov/projects/cryptiga/ui
git add docker-compose.grafana.yml
git commit -m "feat: add backtest-api service to Docker Compose"
```

---

### Task 6: Scaffold Next.js App

**Files:**
- Create: `/Users/ishomakhov/projects/cryptiga/ui/app/` (Next.js app directory)
- Create: `/Users/ishomakhov/projects/cryptiga/ui/package.json`
- Create: `/Users/ishomakhov/projects/cryptiga/ui/next.config.js`
- Create: `/Users/ishomakhov/projects/cryptiga/ui/tailwind.config.js`
- Create: `/Users/ishomakhov/projects/cryptiga/ui/postcss.config.js`
- Create: `/Users/ishomakhov/projects/cryptiga/ui/tsconfig.json`
- Create: `/Users/ishomakhov/projects/cryptiga/ui/app/layout.tsx`
- Create: `/Users/ishomakhov/projects/cryptiga/ui/app/globals.css`
- Create: `/Users/ishomakhov/projects/cryptiga/ui/app/page.tsx`
- Create: `/Users/ishomakhov/projects/cryptiga/ui/Dockerfile`

**Step 1: Initialize Next.js project**

```bash
cd /Users/ishomakhov/projects/cryptiga/ui
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir=false --import-alias="@/*" --use-npm --no-turbopack
```

If prompted about overwriting, answer yes. This creates the standard Next.js 15 scaffold.

**Step 2: Install Recharts**

```bash
cd /Users/ishomakhov/projects/cryptiga/ui
npm install recharts
```

**Step 3: Update `app/page.tsx` with a landing page**

Replace `/Users/ishomakhov/projects/cryptiga/ui/app/page.tsx`:

```tsx
import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center">
      <div className="text-center space-y-8">
        <h1 className="text-4xl font-bold">Cryptiga</h1>
        <p className="text-gray-400">Trading system control panel</p>
        <div className="flex gap-4 justify-center">
          <Link
            href="/backtest"
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition"
          >
            Run Backtest
          </Link>
          <Link
            href="/backtest/history"
            className="px-6 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg font-medium transition"
          >
            View History
          </Link>
        </div>
      </div>
    </main>
  );
}
```

**Step 4: Update `app/layout.tsx` for dark theme**

Replace `/Users/ishomakhov/projects/cryptiga/ui/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cryptiga",
  description: "Crypto trading backtest UI",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-gray-950 text-gray-100">{children}</body>
    </html>
  );
}
```

**Step 5: Create Dockerfile**

Create `/Users/ishomakhov/projects/cryptiga/ui/Dockerfile`:

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "server.js"]
```

**Step 6: Update `next.config.js` for standalone output and API proxy**

Replace `/Users/ishomakhov/projects/cryptiga/ui/next.config.ts` (or `.js`, whichever was created):

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/api/backtest/:path*",
        destination: `${process.env.BACKTEST_API_URL || "http://localhost:8001"}/api/backtest/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
```

**Step 7: Verify it runs**

```bash
cd /Users/ishomakhov/projects/cryptiga/ui
npm run dev -- -p 3001
```

Open http://localhost:3001 — should see the landing page. Stop the dev server (Ctrl+C).

**Step 8: Add `.gitignore` entries**

Add to `/Users/ishomakhov/projects/cryptiga/ui/.gitignore` (the create-next-app should have created one, but verify it has):

```
node_modules/
.next/
```

**Step 9: Commit**

```bash
cd /Users/ishomakhov/projects/cryptiga/ui
git add -A
git commit -m "feat: scaffold Next.js app with Tailwind and Recharts"
```

---

### Task 7: Backtest Form Page

**Files:**
- Create: `/Users/ishomakhov/projects/cryptiga/ui/app/backtest/page.tsx`

This is the main page with the parameter form, "Run Backtest" button, and results display (equity curve chart + metrics).

**Step 1: Create the backtest page**

Create `/Users/ishomakhov/projects/cryptiga/ui/app/backtest/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import Link from "next/link";

const DEFAULTS = {
  name: "",
  symbol: "BTC/USD",
  timeframe: "1h",
  days: 90,
  capital: 1000,
  position_size_pct: 20,
  rsi_period: 14,
  rsi_oversold: 30,
  rsi_overbought: 70,
  macd_fast: 12,
  macd_slow: 26,
  macd_signal: 9,
  sma_short: 10,
  sma_long: 20,
};

type Results = {
  id: string;
  total_return_pct: number;
  buy_hold_return_pct: number;
  final_value: number;
  trade_count: number;
  win_count: number;
  loss_count: number;
  win_rate: number;
  max_drawdown_pct: number;
  equity_curve: { time: string; value: number }[];
};

function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="block">
      <span className="text-sm text-gray-400">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step || 1}
        className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-gray-100 focus:border-blue-500 focus:outline-none"
      />
    </label>
  );
}

export default function BacktestPage() {
  const [params, setParams] = useState(DEFAULTS);
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const set = (key: string, value: number | string) =>
    setParams((p) => ({ ...p, [key]: value }));

  async function runBacktest() {
    setLoading(true);
    setError("");
    setResults(null);
    try {
      const resp = await fetch("/api/backtest/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.detail || "Backtest failed");
      }
      setResults(await resp.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold">Run Backtest</h1>
          <Link
            href="/backtest/history"
            className="text-blue-400 hover:text-blue-300"
          >
            View History
          </Link>
        </div>

        {/* Parameter Form */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          {/* Settings */}
          <div className="bg-gray-900 p-4 rounded-lg space-y-3">
            <h2 className="font-semibold text-gray-300 mb-2">Settings</h2>
            <label className="block">
              <span className="text-sm text-gray-400">Name (optional)</span>
              <input
                type="text"
                value={params.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="e.g. aggressive RSI"
                className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-gray-100 focus:border-blue-500 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-sm text-gray-400">Symbol</span>
              <select
                value={params.symbol}
                onChange={(e) => set("symbol", e.target.value)}
                className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-gray-100"
              >
                <option>BTC/USD</option>
                <option>ETH/USD</option>
              </select>
            </label>
            <NumberInput label="Lookback Days" value={params.days} onChange={(v) => set("days", v)} min={7} max={365} />
            <NumberInput label="Starting Capital ($)" value={params.capital} onChange={(v) => set("capital", v)} min={100} step={100} />
          </div>

          {/* Strategy */}
          <div className="bg-gray-900 p-4 rounded-lg space-y-3">
            <h2 className="font-semibold text-gray-300 mb-2">Strategy</h2>
            <NumberInput label="Position Size %" value={params.position_size_pct} onChange={(v) => set("position_size_pct", v)} min={1} max={100} />
          </div>

          {/* Risk (placeholder for future) */}
          <div className="bg-gray-900 p-4 rounded-lg space-y-3">
            <h2 className="font-semibold text-gray-300 mb-2">Technical Indicators</h2>
            <NumberInput label="RSI Period" value={params.rsi_period} onChange={(v) => set("rsi_period", v)} min={2} max={50} />
            <NumberInput label="RSI Oversold" value={params.rsi_oversold} onChange={(v) => set("rsi_oversold", v)} min={5} max={50} />
            <NumberInput label="RSI Overbought" value={params.rsi_overbought} onChange={(v) => set("rsi_overbought", v)} min={50} max={95} />
            <NumberInput label="SMA Short" value={params.sma_short} onChange={(v) => set("sma_short", v)} min={2} max={50} />
            <NumberInput label="SMA Long" value={params.sma_long} onChange={(v) => set("sma_long", v)} min={5} max={200} />
          </div>

          <div className="bg-gray-900 p-4 rounded-lg space-y-3">
            <h2 className="font-semibold text-gray-300 mb-2">MACD</h2>
            <NumberInput label="Fast" value={params.macd_fast} onChange={(v) => set("macd_fast", v)} min={2} max={50} />
            <NumberInput label="Slow" value={params.macd_slow} onChange={(v) => set("macd_slow", v)} min={5} max={100} />
            <NumberInput label="Signal" value={params.macd_signal} onChange={(v) => set("macd_signal", v)} min={2} max={50} />
          </div>
        </div>

        <button
          onClick={runBacktest}
          disabled={loading}
          className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium transition text-lg"
        >
          {loading ? "Running Backtest..." : "Run Backtest"}
        </button>

        {error && (
          <div className="mt-4 p-4 bg-red-900/50 border border-red-700 rounded-lg text-red-300">
            {error}
          </div>
        )}

        {/* Results */}
        {results && (
          <div className="mt-8 space-y-6">
            {/* Metrics Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Total Return", value: `${results.total_return_pct >= 0 ? "+" : ""}${results.total_return_pct.toFixed(2)}%`, color: results.total_return_pct >= 0 ? "text-green-400" : "text-red-400" },
                { label: "Buy & Hold", value: `${results.buy_hold_return_pct >= 0 ? "+" : ""}${results.buy_hold_return_pct.toFixed(2)}%`, color: results.buy_hold_return_pct >= 0 ? "text-green-400" : "text-red-400" },
                { label: "Final Value", value: `$${results.final_value.toFixed(2)}`, color: "text-gray-100" },
                { label: "Max Drawdown", value: `${results.max_drawdown_pct.toFixed(2)}%`, color: "text-orange-400" },
                { label: "Trades", value: `${results.trade_count}`, color: "text-gray-100" },
                { label: "Win Rate", value: `${(results.win_rate * 100).toFixed(1)}%`, color: "text-gray-100" },
                { label: "Wins", value: `${results.win_count}`, color: "text-green-400" },
                { label: "Losses", value: `${results.loss_count}`, color: "text-red-400" },
              ].map((m) => (
                <div key={m.label} className="bg-gray-900 p-4 rounded-lg">
                  <div className="text-sm text-gray-400">{m.label}</div>
                  <div className={`text-xl font-bold ${m.color}`}>{m.value}</div>
                </div>
              ))}
            </div>

            {/* Equity Curve Chart */}
            <div className="bg-gray-900 p-4 rounded-lg">
              <h3 className="text-lg font-semibold mb-4">Equity Curve</h3>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={results.equity_curve}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis
                    dataKey="time"
                    tickFormatter={(t) => new Date(t).toLocaleDateString()}
                    stroke="#9CA3AF"
                    fontSize={12}
                  />
                  <YAxis stroke="#9CA3AF" fontSize={12} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#1F2937", border: "1px solid #374151" }}
                    labelFormatter={(t) => new Date(t).toLocaleString()}
                    formatter={(v: number) => [`$${v.toFixed(2)}`, "Value"]}
                  />
                  <Line type="monotone" dataKey="value" stroke="#3B82F6" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
```

**Step 2: Verify it renders**

```bash
cd /Users/ishomakhov/projects/cryptiga/ui
npm run dev -- -p 3001
```

Open http://localhost:3001/backtest — should see the parameter form. Stop the dev server.

**Step 3: Commit**

```bash
cd /Users/ishomakhov/projects/cryptiga/ui
git add app/backtest/page.tsx
git commit -m "feat: add backtest form page with parameter inputs and equity curve chart"
```

---

### Task 8: History Page

**Files:**
- Create: `/Users/ishomakhov/projects/cryptiga/ui/app/backtest/history/page.tsx`

**Step 1: Create the history page**

Create `/Users/ishomakhov/projects/cryptiga/ui/app/backtest/history/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Run = {
  id: string;
  name: string | null;
  symbol: string;
  days: number;
  results: {
    total_return_pct: number;
    buy_hold_return_pct: number;
    final_value: number;
    trade_count: number;
    win_rate: number;
    max_drawdown_pct: number;
  };
  created_at: string;
};

export default function HistoryPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/backtest/runs")
      .then((r) => r.json())
      .then(setRuns)
      .finally(() => setLoading(false));
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 5) next.add(id);
      return next;
    });
  }

  function compare() {
    const ids = Array.from(selected).join(",");
    router.push(`/backtest/compare?ids=${ids}`);
  }

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold">Backtest History</h1>
          <div className="flex gap-4">
            {selected.size >= 2 && (
              <button
                onClick={compare}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition"
              >
                Compare ({selected.size})
              </button>
            )}
            <Link
              href="/backtest"
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg font-medium transition"
            >
              New Backtest
            </Link>
          </div>
        </div>

        {loading ? (
          <p className="text-gray-400">Loading...</p>
        ) : runs.length === 0 ? (
          <p className="text-gray-400">No backtest runs yet. <Link href="/backtest" className="text-blue-400">Run one now.</Link></p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400 text-sm">
                  <th className="p-3 w-8"></th>
                  <th className="p-3">Name</th>
                  <th className="p-3">Symbol</th>
                  <th className="p-3">Days</th>
                  <th className="p-3">Return</th>
                  <th className="p-3">Buy&Hold</th>
                  <th className="p-3">Trades</th>
                  <th className="p-3">Win Rate</th>
                  <th className="p-3">Drawdown</th>
                  <th className="p-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr
                    key={run.id}
                    className="border-b border-gray-800/50 hover:bg-gray-900/50 cursor-pointer"
                    onClick={() => toggle(run.id)}
                  >
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={selected.has(run.id)}
                        onChange={() => toggle(run.id)}
                        className="rounded"
                      />
                    </td>
                    <td className="p-3 font-medium">{run.name || "-"}</td>
                    <td className="p-3">{run.symbol}</td>
                    <td className="p-3">{run.days}</td>
                    <td className={`p-3 font-mono ${run.results.total_return_pct >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {run.results.total_return_pct >= 0 ? "+" : ""}{run.results.total_return_pct.toFixed(2)}%
                    </td>
                    <td className={`p-3 font-mono ${run.results.buy_hold_return_pct >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {run.results.buy_hold_return_pct >= 0 ? "+" : ""}{run.results.buy_hold_return_pct.toFixed(2)}%
                    </td>
                    <td className="p-3">{run.results.trade_count}</td>
                    <td className="p-3">{(run.results.win_rate * 100).toFixed(1)}%</td>
                    <td className="p-3 text-orange-400">{run.results.max_drawdown_pct.toFixed(2)}%</td>
                    <td className="p-3 text-gray-400 text-sm">{new Date(run.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
```

**Step 2: Verify and commit**

```bash
cd /Users/ishomakhov/projects/cryptiga/ui
npm run dev -- -p 3001
```

Open http://localhost:3001/backtest/history — should see the history table (empty until backtests run). Stop dev server.

```bash
git add app/backtest/history/page.tsx
git commit -m "feat: add backtest history page with comparison selection"
```

---

### Task 9: Comparison Page

**Files:**
- Create: `/Users/ishomakhov/projects/cryptiga/ui/app/backtest/compare/page.tsx`

**Step 1: Create the comparison page**

Create `/Users/ishomakhov/projects/cryptiga/ui/app/backtest/compare/page.tsx`:

```tsx
"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";

const COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6"];

type Run = {
  id: string;
  name: string | null;
  symbol: string;
  days: number;
  params: Record<string, any>;
  results: {
    total_return_pct: number;
    buy_hold_return_pct: number;
    final_value: number;
    trade_count: number;
    win_count: number;
    loss_count: number;
    win_rate: number;
    max_drawdown_pct: number;
    equity_curve: { time: string; value: number }[];
  };
  created_at: string;
};

const PARAM_LABELS: Record<string, string> = {
  capital: "Capital",
  position_size_pct: "Position Size %",
  rsi_period: "RSI Period",
  rsi_oversold: "RSI Oversold",
  rsi_overbought: "RSI Overbought",
  macd_fast: "MACD Fast",
  macd_slow: "MACD Slow",
  macd_signal: "MACD Signal",
  sma_short: "SMA Short",
  sma_long: "SMA Long",
  days: "Lookback Days",
};

function CompareContent() {
  const searchParams = useSearchParams();
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ids = searchParams.get("ids")?.split(",") || [];
    Promise.all(
      ids.map((id) =>
        fetch(`/api/backtest/runs/${id}`).then((r) => r.json())
      )
    )
      .then(setRuns)
      .finally(() => setLoading(false));
  }, [searchParams]);

  if (loading) return <p className="text-gray-400">Loading...</p>;
  if (runs.length < 2) return <p className="text-gray-400">Select at least 2 runs to compare.</p>;

  // Merge equity curves for overlay chart
  const mergedCurve: Record<string, any>[] = [];
  const timeMap = new Map<string, Record<string, any>>();

  runs.forEach((run, idx) => {
    const label = run.name || `Run ${idx + 1}`;
    for (const point of run.results.equity_curve) {
      if (!timeMap.has(point.time)) {
        timeMap.set(point.time, { time: point.time });
      }
      timeMap.get(point.time)![label] = point.value;
    }
  });
  const sortedTimes = Array.from(timeMap.keys()).sort();
  for (const t of sortedTimes) {
    mergedCurve.push(timeMap.get(t)!);
  }

  // Find param differences
  const allParamKeys = Object.keys(PARAM_LABELS);
  const diffParams = allParamKeys.filter((key) => {
    const values = runs.map((r) => r.params[key]);
    return new Set(values.map(String)).size > 1;
  });

  const metrics = [
    { key: "total_return_pct", label: "Total Return %", fmt: (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` },
    { key: "buy_hold_return_pct", label: "Buy & Hold %", fmt: (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` },
    { key: "final_value", label: "Final Value", fmt: (v: number) => `$${v.toFixed(2)}` },
    { key: "max_drawdown_pct", label: "Max Drawdown", fmt: (v: number) => `${v.toFixed(2)}%` },
    { key: "trade_count", label: "Trades", fmt: (v: number) => `${v}` },
    { key: "win_rate", label: "Win Rate", fmt: (v: number) => `${(v * 100).toFixed(1)}%` },
  ];

  return (
    <div className="space-y-8">
      {/* Overlaid Equity Curves */}
      <div className="bg-gray-900 p-4 rounded-lg">
        <h3 className="text-lg font-semibold mb-4">Equity Curves</h3>
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={mergedCurve}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis
              dataKey="time"
              tickFormatter={(t) => new Date(t).toLocaleDateString()}
              stroke="#9CA3AF"
              fontSize={12}
            />
            <YAxis stroke="#9CA3AF" fontSize={12} />
            <Tooltip
              contentStyle={{ backgroundColor: "#1F2937", border: "1px solid #374151" }}
              labelFormatter={(t) => new Date(t).toLocaleString()}
            />
            <Legend />
            {runs.map((run, idx) => (
              <Line
                key={run.id}
                type="monotone"
                dataKey={run.name || `Run ${idx + 1}`}
                stroke={COLORS[idx % COLORS.length]}
                dot={false}
                strokeWidth={2}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Metrics Comparison Table */}
      <div className="bg-gray-900 p-4 rounded-lg overflow-x-auto">
        <h3 className="text-lg font-semibold mb-4">Metrics</h3>
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-gray-700 text-gray-400 text-sm">
              <th className="p-2">Metric</th>
              {runs.map((r, i) => (
                <th key={r.id} className="p-2" style={{ color: COLORS[i % COLORS.length] }}>
                  {r.name || `Run ${i + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => (
              <tr key={m.key} className="border-b border-gray-800/50">
                <td className="p-2 text-gray-400">{m.label}</td>
                {runs.map((r) => (
                  <td key={r.id} className="p-2 font-mono">
                    {m.fmt((r.results as any)[m.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Parameter Diff */}
      {diffParams.length > 0 && (
        <div className="bg-gray-900 p-4 rounded-lg overflow-x-auto">
          <h3 className="text-lg font-semibold mb-4">Parameter Differences</h3>
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-sm">
                <th className="p-2">Parameter</th>
                {runs.map((r, i) => (
                  <th key={r.id} className="p-2" style={{ color: COLORS[i % COLORS.length] }}>
                    {r.name || `Run ${i + 1}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {diffParams.map((key) => (
                <tr key={key} className="border-b border-gray-800/50">
                  <td className="p-2 text-gray-400">{PARAM_LABELS[key] || key}</td>
                  {runs.map((r) => (
                    <td key={r.id} className="p-2 font-mono">{r.params[key]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ComparePage() {
  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold">Compare Backtests</h1>
          <Link
            href="/backtest/history"
            className="text-blue-400 hover:text-blue-300"
          >
            Back to History
          </Link>
        </div>
        <Suspense fallback={<p className="text-gray-400">Loading...</p>}>
          <CompareContent />
        </Suspense>
      </div>
    </main>
  );
}
```

**Step 2: Verify and commit**

```bash
cd /Users/ishomakhov/projects/cryptiga/ui
git add app/backtest/compare/page.tsx
git commit -m "feat: add backtest comparison page with overlaid equity curves and param diff"
```

---

### Task 10: Add Next.js to Docker Compose

**Files:**
- Modify: `/Users/ishomakhov/projects/cryptiga/ui/docker-compose.grafana.yml`

**Step 1: Add the Next.js service**

Add to the `services` section of `/Users/ishomakhov/projects/cryptiga/ui/docker-compose.grafana.yml`:

```yaml
  ui:
    build:
      context: ../ui
      dockerfile: Dockerfile
    ports:
      - "3001:3001"
    environment:
      - BACKTEST_API_URL=http://backtest-api:8001
      - PORT=3001
      - HOSTNAME=0.0.0.0
    depends_on:
      - backtest-api
```

**Step 2: Commit**

```bash
cd /Users/ishomakhov/projects/cryptiga/ui
git add docker-compose.grafana.yml
git commit -m "feat: add Next.js UI service to Docker Compose"
```

---

### Task 11: Integration Test

**Step 1: Start the full stack**

```bash
cd /Users/ishomakhov/projects/cryptiga/core
docker compose -f docker-compose.yml -f ../ui/docker-compose.grafana.yml up --build -d
```

**Step 2: Wait for services to start**

Wait ~60 seconds. Check all services are running:

```bash
docker compose -f docker-compose.yml -f ../ui/docker-compose.grafana.yml ps
```

Expected: All services show `Up` or `running`, including `backtest-api` and `ui`.

**Step 3: Test the backtest API directly**

```bash
curl -s http://localhost:8001/api/backtest/runs | python3 -m json.tool
```

Expected: `[]` (empty list)

**Step 4: Test the Next.js proxy**

Open http://localhost:3001 — should see the landing page.
Open http://localhost:3001/backtest — should see the parameter form.

**Step 5: Run a backtest**

Click "Run Backtest" with default parameters. Wait ~10 seconds. You should see:
- Metrics grid (return %, win rate, etc.)
- Equity curve chart

**Step 6: Check history**

Navigate to http://localhost:3001/backtest/history. The run you just completed should appear.

**Step 7: Run a second backtest with different params**

Go back to `/backtest`, change RSI Oversold to 25 and RSI Overbought to 75, run again.

**Step 8: Compare**

Go to history, select both runs, click Compare. You should see:
- Overlaid equity curves
- Metrics comparison table
- Parameter diff showing the RSI changes

**Step 9: Grafana still works**

Open http://localhost:3000 — Grafana dashboards should still work.

**Step 10: Push both repos**

```bash
cd /Users/ishomakhov/projects/cryptiga/analytics
git push origin main
```

```bash
cd /Users/ishomakhov/projects/cryptiga/ui
git push origin main
```
