# Backtest UI — Design Document

**Date:** 2026-02-16
**Status:** Approved

## Goal

Build a web-based backtesting UI that lets the user run historical backtests with different parameter combinations and compare results side by side.

## Architecture

Three layers:

1. **Next.js Frontend** (`cryptiga/ui`) — Parameter forms, equity curve charts, comparison views. Port 3001.
2. **Python Backtest API** (`cryptiga/analytics`) — FastAPI service wrapping the existing Python backtest engine. Port 8001.
3. **Go System API** (`cryptiga/core`) — Future phase. Live system control, config adjustment, service health. Not in scope.

The frontend talks to the Python API over HTTP. Both connect to TimescaleDB for data persistence. Everything runs as Docker containers alongside the existing stack.

## Data Model

New table in TimescaleDB:

```sql
CREATE TABLE backtest_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT,
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    days INTEGER NOT NULL,
    params JSONB NOT NULL,
    results JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

- `params` stores the full parameter snapshot as JSON (thresholds, weights, indicator settings, risk params).
- `results` stores backtest output: total return, buy-hold return, win rate, max drawdown, trade count, and equity curve as `[{time, value}]`.
- Each run is immutable — re-running creates a new row.

## Python Backtest API

FastAPI service in `cryptiga/analytics` with 3 endpoints:

- **`POST /api/backtest/run`** — Accepts parameters, runs backtest engine, stores results, returns run ID + results.
- **`GET /api/backtest/runs`** — Lists all past runs with key metrics.
- **`GET /api/backtest/runs/{id}`** — Returns full run details including equity curve.

The API imports the existing `BacktestEngine`, `TechnicalProcessor`, and `DataLoader` directly. Backtests run synchronously (~5 seconds for 365 days).

Docker: Same Python image as signal-worker, different entrypoint (`uvicorn analytics.api:app --host 0.0.0.0 --port 8001`).

## Next.js Frontend

Three pages:

### `/backtest` (Main)
Parameter form with grouped inputs:
- **Strategy:** buy/sell thresholds, strategy weights (4 sliders summing to 1.0)
- **Risk:** max positions, max position %, stop loss %, daily loss limit %, position size %
- **Technical:** RSI period/oversold/overbought, MACD fast/slow/signal, SMA short/long
- **Settings:** symbol, timeframe, lookback days, starting capital

"Run Backtest" button. Results appear below: equity curve chart, key metrics.

### `/backtest/history`
Table of all past runs. Click for details. Checkboxes to select runs for comparison.

### `/backtest/compare`
Overlaid equity curves on one chart. Metrics comparison table (one column per run). Parameter diff highlighting changes between runs.

**Tech:** Next.js 15 (App Router), Tailwind CSS, Recharts.

## Configuration

- Frontend port: 3001
- API port: 8001
- No authentication (local dev only)
- Docker Compose overlay adds both services

## Tunable Parameters

| Category | Parameters |
|----------|-----------|
| Strategy | buy_threshold, sell_threshold, weight_technical, weight_sentiment, weight_external, weight_market |
| Risk | max_positions, max_position_pct, stop_loss_pct, daily_loss_limit_pct, position_size_pct |
| Technical | rsi_period, rsi_oversold, rsi_overbought, macd_fast, macd_slow, macd_signal, sma_short, sma_long |
| Settings | symbol, timeframe, days, starting_capital |

## Not In Scope

- Go system API for live config tuning
- Real-time paper trade adjustment
- User authentication
- Cloud deployment
