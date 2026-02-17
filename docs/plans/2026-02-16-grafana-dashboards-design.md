# Grafana Dashboards — Design Document

**Date:** 2026-02-16
**Status:** Approved

## Goal

Add Grafana dashboards to visualize and monitor the Cryptiga trading system — portfolio performance, active signals, on-chain metrics, trade history, and system health.

## Architecture

Grafana runs as a Docker container alongside the existing core services. It connects to TimescaleDB as a PostgreSQL datasource. All dashboards are provisioned from JSON files committed to the `cryptiga/ui` repo — no manual setup needed.

A `docker-compose.grafana.yml` overlay file adds Grafana to the core stack. Run with:

```bash
cd cryptiga/core
docker compose -f docker-compose.yml -f ../ui/docker-compose.grafana.yml up
```

## Repository Structure

```
cryptiga/ui/
├── docker-compose.grafana.yml
├── grafana/
│   ├── provisioning/
│   │   ├── datasources/
│   │   │   └── timescaledb.yml
│   │   └── dashboards/
│   │       └── dashboards.yml
│   └── dashboards/
│       ├── system-health.json
│       ├── portfolio-trades.json
│       ├── active-signals.json
│       ├── price-onchain.json
│       └── signal-attribution.json
```

## Dashboards

### 1. System Health (Monitoring)
- Service heartbeat status from Redis
- Last collection timestamps per service
- Row counts for key tables (candles, signals, on-chain metrics)
- Error indicators

### 2. Portfolio & Trades (Monitoring)
- Current portfolio value, cash vs invested
- P&L over time (line chart)
- Recent trades table (coin, side, price, amount, timestamp)
- Position breakdown by coin

### 3. Active Signals (Monitoring)
- Current active signals with direction and confidence
- Signal frequency over time (bar chart)
- Signals grouped by source (technical vs sentiment)

### 4. Price & On-Chain (Analysis)
- BTC/USD candlestick chart
- Selectable on-chain metric overlay (hash rate, mempool size, fees, difficulty, etc.)
- Variable selectors for coin and metric

### 5. Signal Attribution (Analysis)
- Win rate by signal source
- P&L contribution by source
- Signal confidence vs actual outcome
- Trade count by source

## Configuration

- **Port:** 3000
- **Login:** admin/admin (local dev, no auth enforcement)
- **Datasource:** TimescaleDB via PostgreSQL plugin, auto-provisioned
- **Dashboards:** Read-only provisioned from JSON; edit in UI for experimentation, export JSON to commit

## Not In Scope

- Custom web application or API layer
- Grafana alerting rules (Telegram bot handles alerts)
- User authentication or multi-tenancy
- Cloud-hosted Grafana
