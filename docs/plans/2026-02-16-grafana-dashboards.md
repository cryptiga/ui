# Grafana Dashboards — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 5 Grafana dashboards to the Cryptiga system for monitoring and data analysis, auto-provisioned via Docker.

**Architecture:** Grafana runs as a Docker container alongside the existing core services. It connects to TimescaleDB as a PostgreSQL datasource. All dashboards are provisioned from JSON files. A `docker-compose.grafana.yml` overlay adds Grafana to the core stack.

**Tech Stack:** Grafana 11.4, PostgreSQL/TimescaleDB datasource, Docker Compose

**Repo:** `cryptiga/ui` at `/Users/ishomakhov/projects/cryptiga/ui/`

**DB Schema Reference (all tables in TimescaleDB):**
- `price_candles` — coin, timeframe, open, high, low, close, volume, timestamp
- `signals` — id, coin, direction, confidence, source, metadata, timestamp, expires_at
- `trades` — id, coin, side, quantity, price, amount, mode, strategy, signals_snapshot, timestamp
- `positions` — id, coin, entry_price, quantity, opened_at, closed_at, exit_price, realized_pnl
- `portfolio_snapshots` — total_value, cash, invested, positions_count, timestamp
- `on_chain_metrics` — source, metric, value, timestamp
- `news_posts` — id, coin, title, source_url, source_name, sentiment_votes, published_at, fetched_at
- `pending_trades` — id, coin, side, amount, signals_snapshot, status, created_at, decided_at, expires_at

---

### Task 1: Repo Scaffolding, Docker Compose, and Provisioning Configs

**Files:**
- Create: `docker-compose.grafana.yml`
- Create: `grafana/provisioning/datasources/timescaledb.yml`
- Create: `grafana/provisioning/dashboards/dashboards.yml`

**Step 1: Create directory structure**

```bash
cd /Users/ishomakhov/projects/cryptiga/ui
mkdir -p grafana/provisioning/datasources
mkdir -p grafana/provisioning/dashboards
mkdir -p grafana/dashboards
```

**Step 2: Create docker-compose.grafana.yml**

Create `docker-compose.grafana.yml`:

```yaml
services:
  grafana:
    image: grafana/grafana:11.4.0
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_USER=admin
      - GF_SECURITY_ADMIN_PASSWORD=cryptiga
      - GF_AUTH_ANONYMOUS_ENABLED=true
      - GF_AUTH_ANONYMOUS_ORG_ROLE=Admin
      - GF_AUTH_DISABLE_LOGIN_FORM=true
    volumes:
      - grafana_data:/var/lib/grafana
      - ./grafana/provisioning/datasources:/etc/grafana/provisioning/datasources
      - ./grafana/provisioning/dashboards:/etc/grafana/provisioning/dashboards
      - ./grafana/dashboards:/var/lib/grafana/dashboards
    depends_on:
      timescaledb:
        condition: service_healthy

volumes:
  grafana_data:
```

**Step 3: Create datasource provisioning**

Create `grafana/provisioning/datasources/timescaledb.yml`:

```yaml
apiVersion: 1

datasources:
  - name: TimescaleDB
    type: postgres
    access: proxy
    orgId: 1
    uid: timescaledb
    url: timescaledb:5432
    user: cryptiga
    isDefault: true
    editable: false
    jsonData:
      database: cryptiga
      sslmode: disable
      maxOpenConns: 10
      postgresVersion: 1600
      timescaledb: true
    secureJsonData:
      password: cryptiga
```

**Step 4: Create dashboard provider**

Create `grafana/provisioning/dashboards/dashboards.yml`:

```yaml
apiVersion: 1

providers:
  - name: Cryptiga
    orgId: 1
    folder: ''
    type: file
    disableDeletion: false
    updateIntervalSeconds: 10
    allowUiUpdates: true
    options:
      path: /var/lib/grafana/dashboards
```

**Step 5: Verify Grafana starts**

Run from the core repo:

```bash
cd /Users/ishomakhov/projects/cryptiga/core
docker compose -f docker-compose.yml -f ../ui/docker-compose.grafana.yml up -d timescaledb redis grafana
```

Wait 10 seconds, then open `http://localhost:3000`. You should see the Grafana home page without login. Check Connections > Data Sources — "TimescaleDB" should appear and show a green "Data source is working" when you click Test.

**Step 6: Commit**

```bash
cd /Users/ishomakhov/projects/cryptiga/ui
git add docker-compose.grafana.yml grafana/provisioning/
git commit -m "feat: add Grafana Docker Compose and provisioning configs"
```

---

### Task 2: System Health Dashboard

**Files:**
- Create: `grafana/dashboards/system-health.json`

**Step 1: Create the dashboard JSON**

Create `grafana/dashboards/system-health.json`:

```json
{
  "uid": "system-health",
  "title": "System Health",
  "tags": ["cryptiga", "monitoring"],
  "timezone": "browser",
  "editable": true,
  "graphTooltip": 1,
  "schemaVersion": 39,
  "version": 0,
  "refresh": "30s",
  "time": { "from": "now-24h", "to": "now" },
  "panels": [
    {
      "id": 1,
      "type": "stat",
      "title": "Price Candles",
      "description": "Total candle records in database",
      "gridPos": { "x": 0, "y": 0, "w": 6, "h": 4 },
      "datasource": { "type": "postgres", "uid": "timescaledb" },
      "targets": [{
        "refId": "A",
        "rawSql": "SELECT COUNT(*) AS \"Total Candles\" FROM price_candles",
        "format": "table"
      }],
      "fieldConfig": { "defaults": { "unit": "short" }, "overrides": [] },
      "options": { "reduceOptions": { "calcs": ["lastNotNull"] } }
    },
    {
      "id": 2,
      "type": "stat",
      "title": "Signals",
      "description": "Total signals generated",
      "gridPos": { "x": 6, "y": 0, "w": 6, "h": 4 },
      "datasource": { "type": "postgres", "uid": "timescaledb" },
      "targets": [{
        "refId": "A",
        "rawSql": "SELECT COUNT(*) AS \"Total Signals\" FROM signals",
        "format": "table"
      }],
      "fieldConfig": { "defaults": { "unit": "short" }, "overrides": [] },
      "options": { "reduceOptions": { "calcs": ["lastNotNull"] } }
    },
    {
      "id": 3,
      "type": "stat",
      "title": "On-Chain Metrics",
      "description": "Total on-chain data points",
      "gridPos": { "x": 12, "y": 0, "w": 6, "h": 4 },
      "datasource": { "type": "postgres", "uid": "timescaledb" },
      "targets": [{
        "refId": "A",
        "rawSql": "SELECT COUNT(*) AS \"Total Metrics\" FROM on_chain_metrics",
        "format": "table"
      }],
      "fieldConfig": { "defaults": { "unit": "short" }, "overrides": [] },
      "options": { "reduceOptions": { "calcs": ["lastNotNull"] } }
    },
    {
      "id": 4,
      "type": "stat",
      "title": "Trades",
      "description": "Total trades executed",
      "gridPos": { "x": 18, "y": 0, "w": 6, "h": 4 },
      "datasource": { "type": "postgres", "uid": "timescaledb" },
      "targets": [{
        "refId": "A",
        "rawSql": "SELECT COUNT(*) AS \"Total Trades\" FROM trades",
        "format": "table"
      }],
      "fieldConfig": { "defaults": { "unit": "short" }, "overrides": [] },
      "options": { "reduceOptions": { "calcs": ["lastNotNull"] } }
    },
    {
      "id": 5,
      "type": "stat",
      "title": "Latest Candle",
      "description": "Most recent candle timestamp",
      "gridPos": { "x": 0, "y": 4, "w": 6, "h": 3 },
      "datasource": { "type": "postgres", "uid": "timescaledb" },
      "targets": [{
        "refId": "A",
        "rawSql": "SELECT MAX(timestamp) AS \"Latest Candle\" FROM price_candles",
        "format": "table"
      }],
      "fieldConfig": { "defaults": { "unit": "dateTimeAsIso" }, "overrides": [] },
      "options": { "reduceOptions": { "calcs": ["lastNotNull"] } }
    },
    {
      "id": 6,
      "type": "stat",
      "title": "Latest Signal",
      "description": "Most recent signal timestamp",
      "gridPos": { "x": 6, "y": 4, "w": 6, "h": 3 },
      "datasource": { "type": "postgres", "uid": "timescaledb" },
      "targets": [{
        "refId": "A",
        "rawSql": "SELECT MAX(timestamp) AS \"Latest Signal\" FROM signals",
        "format": "table"
      }],
      "fieldConfig": { "defaults": { "unit": "dateTimeAsIso" }, "overrides": [] },
      "options": { "reduceOptions": { "calcs": ["lastNotNull"] } }
    },
    {
      "id": 7,
      "type": "stat",
      "title": "Latest On-Chain",
      "description": "Most recent on-chain collection",
      "gridPos": { "x": 12, "y": 4, "w": 6, "h": 3 },
      "datasource": { "type": "postgres", "uid": "timescaledb" },
      "targets": [{
        "refId": "A",
        "rawSql": "SELECT MAX(timestamp) AS \"Latest On-Chain\" FROM on_chain_metrics",
        "format": "table"
      }],
      "fieldConfig": { "defaults": { "unit": "dateTimeAsIso" }, "overrides": [] },
      "options": { "reduceOptions": { "calcs": ["lastNotNull"] } }
    },
    {
      "id": 8,
      "type": "stat",
      "title": "Active Signals",
      "description": "Signals not yet expired",
      "gridPos": { "x": 18, "y": 4, "w": 6, "h": 3 },
      "datasource": { "type": "postgres", "uid": "timescaledb" },
      "targets": [{
        "refId": "A",
        "rawSql": "SELECT COUNT(*) AS \"Active\" FROM signals WHERE expires_at > NOW()",
        "format": "table"
      }],
      "fieldConfig": { "defaults": { "unit": "short", "color": { "mode": "fixed", "fixedColor": "green" } }, "overrides": [] },
      "options": { "reduceOptions": { "calcs": ["lastNotNull"] } }
    },
    {
      "id": 9,
      "type": "timeseries",
      "title": "Data Ingestion Rate",
      "description": "New records per hour by table",
      "gridPos": { "x": 0, "y": 7, "w": 24, "h": 8 },
      "datasource": { "type": "postgres", "uid": "timescaledb" },
      "targets": [
        {
          "refId": "A",
          "rawSql": "SELECT time_bucket('1 hour', timestamp) AS time, COUNT(*) AS \"Candles\" FROM price_candles WHERE $__timeFilter(timestamp) GROUP BY 1 ORDER BY 1",
          "format": "time_series"
        },
        {
          "refId": "B",
          "rawSql": "SELECT time_bucket('1 hour', timestamp) AS time, COUNT(*) AS \"Signals\" FROM signals WHERE $__timeFilter(timestamp) GROUP BY 1 ORDER BY 1",
          "format": "time_series"
        },
        {
          "refId": "C",
          "rawSql": "SELECT time_bucket('1 hour', timestamp) AS time, COUNT(*) AS \"On-Chain\" FROM on_chain_metrics WHERE $__timeFilter(timestamp) GROUP BY 1 ORDER BY 1",
          "format": "time_series"
        }
      ],
      "fieldConfig": { "defaults": { "custom": { "drawStyle": "bars", "fillOpacity": 50 } }, "overrides": [] },
      "options": {}
    }
  ],
  "templating": { "list": [] },
  "annotations": { "list": [] }
}
```

**Step 2: Verify dashboard loads**

Restart Grafana (or wait 10 seconds for auto-reload):

```bash
cd /Users/ishomakhov/projects/cryptiga/core
docker compose -f docker-compose.yml -f ../ui/docker-compose.grafana.yml restart grafana
```

Open `http://localhost:3000/d/system-health`. You should see the System Health dashboard with stat panels and the data ingestion rate chart. Values will be 0 until the system collects data.

**Step 3: Commit**

```bash
cd /Users/ishomakhov/projects/cryptiga/ui
git add grafana/dashboards/system-health.json
git commit -m "feat: add System Health dashboard"
```

---

### Task 3: Portfolio & Trades Dashboard

**Files:**
- Create: `grafana/dashboards/portfolio-trades.json`

**Step 1: Create the dashboard JSON**

Create `grafana/dashboards/portfolio-trades.json`:

```json
{
  "uid": "portfolio-trades",
  "title": "Portfolio & Trades",
  "tags": ["cryptiga", "monitoring"],
  "timezone": "browser",
  "editable": true,
  "graphTooltip": 1,
  "schemaVersion": 39,
  "version": 0,
  "refresh": "30s",
  "time": { "from": "now-7d", "to": "now" },
  "panels": [
    {
      "id": 1,
      "type": "stat",
      "title": "Portfolio Value",
      "gridPos": { "x": 0, "y": 0, "w": 6, "h": 4 },
      "datasource": { "type": "postgres", "uid": "timescaledb" },
      "targets": [{
        "refId": "A",
        "rawSql": "SELECT total_value AS \"Value\" FROM portfolio_snapshots ORDER BY timestamp DESC LIMIT 1",
        "format": "table"
      }],
      "fieldConfig": { "defaults": { "unit": "currencyUSD" }, "overrides": [] },
      "options": { "reduceOptions": { "calcs": ["lastNotNull"] } }
    },
    {
      "id": 2,
      "type": "stat",
      "title": "Cash",
      "gridPos": { "x": 6, "y": 0, "w": 6, "h": 4 },
      "datasource": { "type": "postgres", "uid": "timescaledb" },
      "targets": [{
        "refId": "A",
        "rawSql": "SELECT cash AS \"Cash\" FROM portfolio_snapshots ORDER BY timestamp DESC LIMIT 1",
        "format": "table"
      }],
      "fieldConfig": { "defaults": { "unit": "currencyUSD", "color": { "mode": "fixed", "fixedColor": "blue" } }, "overrides": [] },
      "options": { "reduceOptions": { "calcs": ["lastNotNull"] } }
    },
    {
      "id": 3,
      "type": "stat",
      "title": "Open Positions",
      "gridPos": { "x": 12, "y": 0, "w": 6, "h": 4 },
      "datasource": { "type": "postgres", "uid": "timescaledb" },
      "targets": [{
        "refId": "A",
        "rawSql": "SELECT COUNT(*) AS \"Positions\" FROM positions WHERE closed_at IS NULL",
        "format": "table"
      }],
      "fieldConfig": { "defaults": { "unit": "short" }, "overrides": [] },
      "options": { "reduceOptions": { "calcs": ["lastNotNull"] } }
    },
    {
      "id": 4,
      "type": "stat",
      "title": "Total P&L",
      "gridPos": { "x": 18, "y": 0, "w": 6, "h": 4 },
      "datasource": { "type": "postgres", "uid": "timescaledb" },
      "targets": [{
        "refId": "A",
        "rawSql": "SELECT COALESCE(SUM(realized_pnl), 0) AS \"P&L\" FROM positions WHERE closed_at IS NOT NULL",
        "format": "table"
      }],
      "fieldConfig": {
        "defaults": {
          "unit": "currencyUSD",
          "thresholds": {
            "mode": "absolute",
            "steps": [
              { "color": "red", "value": null },
              { "color": "green", "value": 0 }
            ]
          },
          "color": { "mode": "thresholds" }
        },
        "overrides": []
      },
      "options": { "reduceOptions": { "calcs": ["lastNotNull"] } }
    },
    {
      "id": 5,
      "type": "timeseries",
      "title": "Portfolio Value Over Time",
      "gridPos": { "x": 0, "y": 4, "w": 24, "h": 8 },
      "datasource": { "type": "postgres", "uid": "timescaledb" },
      "targets": [
        {
          "refId": "A",
          "rawSql": "SELECT timestamp AS time, total_value AS \"Total Value\", cash AS \"Cash\", invested AS \"Invested\" FROM portfolio_snapshots WHERE $__timeFilter(timestamp) ORDER BY timestamp",
          "format": "time_series"
        }
      ],
      "fieldConfig": {
        "defaults": { "unit": "currencyUSD", "custom": { "fillOpacity": 10 } },
        "overrides": []
      },
      "options": {}
    },
    {
      "id": 6,
      "type": "table",
      "title": "Recent Trades",
      "gridPos": { "x": 0, "y": 12, "w": 24, "h": 8 },
      "datasource": { "type": "postgres", "uid": "timescaledb" },
      "targets": [{
        "refId": "A",
        "rawSql": "SELECT timestamp AS \"Time\", coin AS \"Coin\", side AS \"Side\", quantity AS \"Qty\", price AS \"Price\", amount AS \"Amount\", mode AS \"Mode\", strategy AS \"Strategy\" FROM trades WHERE $__timeFilter(timestamp) ORDER BY timestamp DESC LIMIT 50",
        "format": "table"
      }],
      "fieldConfig": { "defaults": {}, "overrides": [] },
      "options": {}
    },
    {
      "id": 7,
      "type": "table",
      "title": "Open Positions",
      "gridPos": { "x": 0, "y": 20, "w": 24, "h": 6 },
      "datasource": { "type": "postgres", "uid": "timescaledb" },
      "targets": [{
        "refId": "A",
        "rawSql": "SELECT coin AS \"Coin\", entry_price AS \"Entry Price\", quantity AS \"Qty\", (quantity * entry_price) AS \"Value\", opened_at AS \"Opened\" FROM positions WHERE closed_at IS NULL ORDER BY opened_at DESC",
        "format": "table"
      }],
      "fieldConfig": { "defaults": {}, "overrides": [] },
      "options": {}
    }
  ],
  "templating": { "list": [] },
  "annotations": { "list": [] }
}
```

**Step 2: Verify dashboard loads**

Open `http://localhost:3000/d/portfolio-trades`. You should see stat panels, portfolio value chart, trades table, and positions table.

**Step 3: Commit**

```bash
cd /Users/ishomakhov/projects/cryptiga/ui
git add grafana/dashboards/portfolio-trades.json
git commit -m "feat: add Portfolio & Trades dashboard"
```

---

### Task 4: Active Signals Dashboard

**Files:**
- Create: `grafana/dashboards/active-signals.json`

**Step 1: Create the dashboard JSON**

Create `grafana/dashboards/active-signals.json`:

```json
{
  "uid": "active-signals",
  "title": "Active Signals",
  "tags": ["cryptiga", "monitoring"],
  "timezone": "browser",
  "editable": true,
  "graphTooltip": 1,
  "schemaVersion": 39,
  "version": 0,
  "refresh": "30s",
  "time": { "from": "now-24h", "to": "now" },
  "panels": [
    {
      "id": 1,
      "type": "table",
      "title": "Currently Active Signals",
      "gridPos": { "x": 0, "y": 0, "w": 24, "h": 8 },
      "datasource": { "type": "postgres", "uid": "timescaledb" },
      "targets": [{
        "refId": "A",
        "rawSql": "SELECT coin AS \"Coin\", source AS \"Source\", direction AS \"Direction\", confidence AS \"Confidence\", timestamp AS \"Created\", expires_at AS \"Expires\" FROM signals WHERE expires_at > NOW() ORDER BY confidence DESC",
        "format": "table"
      }],
      "fieldConfig": {
        "defaults": {},
        "overrides": [
          {
            "matcher": { "id": "byName", "options": "Direction" },
            "properties": [{
              "id": "custom.cellOptions",
              "value": {
                "type": "color-text"
              }
            }, {
              "id": "mappings",
              "value": [
                { "type": "value", "options": { "bullish": { "text": "BULLISH", "color": "green" }, "bearish": { "text": "BEARISH", "color": "red" } } }
              ]
            }]
          }
        ]
      },
      "options": {}
    },
    {
      "id": 2,
      "type": "timeseries",
      "title": "Signal Frequency Over Time",
      "gridPos": { "x": 0, "y": 8, "w": 24, "h": 8 },
      "datasource": { "type": "postgres", "uid": "timescaledb" },
      "targets": [
        {
          "refId": "A",
          "rawSql": "SELECT time_bucket('1 hour', timestamp) AS time, COUNT(*) FILTER (WHERE direction = 'bullish') AS \"Bullish\", COUNT(*) FILTER (WHERE direction = 'bearish') AS \"Bearish\" FROM signals WHERE $__timeFilter(timestamp) GROUP BY 1 ORDER BY 1",
          "format": "time_series"
        }
      ],
      "fieldConfig": {
        "defaults": { "custom": { "drawStyle": "bars", "fillOpacity": 80, "stacking": { "mode": "normal" } } },
        "overrides": [
          { "matcher": { "id": "byName", "options": "Bullish" }, "properties": [{ "id": "color", "value": { "mode": "fixed", "fixedColor": "green" } }] },
          { "matcher": { "id": "byName", "options": "Bearish" }, "properties": [{ "id": "color", "value": { "mode": "fixed", "fixedColor": "red" } }] }
        ]
      },
      "options": {}
    },
    {
      "id": 3,
      "type": "barchart",
      "title": "Signals by Source",
      "gridPos": { "x": 0, "y": 16, "w": 12, "h": 8 },
      "datasource": { "type": "postgres", "uid": "timescaledb" },
      "targets": [{
        "refId": "A",
        "rawSql": "SELECT source AS \"Source\", COUNT(*) AS \"Count\" FROM signals WHERE $__timeFilter(timestamp) GROUP BY source ORDER BY \"Count\" DESC",
        "format": "table"
      }],
      "fieldConfig": { "defaults": { "color": { "mode": "palette-classic" } }, "overrides": [] },
      "options": {}
    },
    {
      "id": 4,
      "type": "barchart",
      "title": "Average Confidence by Source",
      "gridPos": { "x": 12, "y": 16, "w": 12, "h": 8 },
      "datasource": { "type": "postgres", "uid": "timescaledb" },
      "targets": [{
        "refId": "A",
        "rawSql": "SELECT source AS \"Source\", ROUND(AVG(confidence)) AS \"Avg Confidence\" FROM signals WHERE $__timeFilter(timestamp) GROUP BY source ORDER BY \"Avg Confidence\" DESC",
        "format": "table"
      }],
      "fieldConfig": { "defaults": { "color": { "mode": "palette-classic" }, "max": 100 }, "overrides": [] },
      "options": {}
    }
  ],
  "templating": { "list": [] },
  "annotations": { "list": [] }
}
```

**Step 2: Verify and commit**

Open `http://localhost:3000/d/active-signals`.

```bash
cd /Users/ishomakhov/projects/cryptiga/ui
git add grafana/dashboards/active-signals.json
git commit -m "feat: add Active Signals dashboard"
```

---

### Task 5: Price & On-Chain Dashboard

**Files:**
- Create: `grafana/dashboards/price-onchain.json`

**Step 1: Create the dashboard JSON**

This dashboard has template variables for coin and on-chain metric selection.

Create `grafana/dashboards/price-onchain.json`:

```json
{
  "uid": "price-onchain",
  "title": "Price & On-Chain",
  "tags": ["cryptiga", "analysis"],
  "timezone": "browser",
  "editable": true,
  "graphTooltip": 2,
  "schemaVersion": 39,
  "version": 0,
  "refresh": "5m",
  "time": { "from": "now-7d", "to": "now" },
  "templating": {
    "list": [
      {
        "name": "coin",
        "label": "Coin",
        "type": "query",
        "datasource": { "type": "postgres", "uid": "timescaledb" },
        "query": "SELECT DISTINCT coin FROM price_candles ORDER BY coin",
        "refresh": 1,
        "current": { "text": "BTC/USD", "value": "BTC/USD" }
      },
      {
        "name": "metric",
        "label": "On-Chain Metric",
        "type": "query",
        "datasource": { "type": "postgres", "uid": "timescaledb" },
        "query": "SELECT DISTINCT source || '/' || metric AS __text, metric AS __value FROM on_chain_metrics ORDER BY 1",
        "refresh": 1,
        "current": { "text": "blockchain.com/hash_rate", "value": "hash_rate" }
      }
    ]
  },
  "panels": [
    {
      "id": 1,
      "type": "candlestick",
      "title": "$coin Price",
      "gridPos": { "x": 0, "y": 0, "w": 24, "h": 10 },
      "datasource": { "type": "postgres", "uid": "timescaledb" },
      "targets": [{
        "refId": "A",
        "rawSql": "SELECT timestamp AS time, open, high, low, close, volume FROM price_candles WHERE coin = '$coin' AND timeframe = '1h' AND $__timeFilter(timestamp) ORDER BY timestamp",
        "format": "time_series"
      }],
      "fieldConfig": { "defaults": {}, "overrides": [] },
      "options": { "mode": "candles", "colorStrategy": "open-close" }
    },
    {
      "id": 2,
      "type": "timeseries",
      "title": "On-Chain: $metric",
      "gridPos": { "x": 0, "y": 10, "w": 24, "h": 8 },
      "datasource": { "type": "postgres", "uid": "timescaledb" },
      "targets": [{
        "refId": "A",
        "rawSql": "SELECT timestamp AS time, value AS \"$metric\" FROM on_chain_metrics WHERE metric = '$metric' AND $__timeFilter(timestamp) ORDER BY timestamp",
        "format": "time_series"
      }],
      "fieldConfig": { "defaults": { "custom": { "fillOpacity": 10 } }, "overrides": [] },
      "options": {}
    },
    {
      "id": 3,
      "type": "timeseries",
      "title": "Mempool Fees (sat/vB)",
      "gridPos": { "x": 0, "y": 18, "w": 12, "h": 8 },
      "datasource": { "type": "postgres", "uid": "timescaledb" },
      "targets": [{
        "refId": "A",
        "rawSql": "SELECT timestamp AS time, value AS \"Fee Rate\" FROM on_chain_metrics WHERE metric IN ('fastest_fee', 'half_hour_fee', 'hour_fee', 'economy_fee') AND $__timeFilter(timestamp) ORDER BY timestamp",
        "format": "time_series"
      }],
      "fieldConfig": { "defaults": { "unit": "short" }, "overrides": [] },
      "options": {}
    },
    {
      "id": 4,
      "type": "timeseries",
      "title": "Mempool Size",
      "gridPos": { "x": 12, "y": 18, "w": 12, "h": 8 },
      "datasource": { "type": "postgres", "uid": "timescaledb" },
      "targets": [
        {
          "refId": "A",
          "rawSql": "SELECT timestamp AS time, value AS \"TX Count\" FROM on_chain_metrics WHERE metric = 'mempool_count' AND $__timeFilter(timestamp) ORDER BY timestamp",
          "format": "time_series"
        }
      ],
      "fieldConfig": { "defaults": { "unit": "short" }, "overrides": [] },
      "options": {}
    },
    {
      "id": 5,
      "type": "table",
      "title": "Latest On-Chain Metrics",
      "gridPos": { "x": 0, "y": 26, "w": 24, "h": 8 },
      "datasource": { "type": "postgres", "uid": "timescaledb" },
      "targets": [{
        "refId": "A",
        "rawSql": "SELECT DISTINCT ON (source, metric) source AS \"Source\", metric AS \"Metric\", value AS \"Value\", timestamp AS \"Last Updated\" FROM on_chain_metrics ORDER BY source, metric, timestamp DESC",
        "format": "table"
      }],
      "fieldConfig": { "defaults": {}, "overrides": [] },
      "options": {}
    }
  ],
  "annotations": { "list": [] }
}
```

**Step 2: Verify and commit**

Open `http://localhost:3000/d/price-onchain`. Use the dropdowns at the top to switch coin and on-chain metric.

```bash
cd /Users/ishomakhov/projects/cryptiga/ui
git add grafana/dashboards/price-onchain.json
git commit -m "feat: add Price & On-Chain dashboard with metric selector"
```

---

### Task 6: Signal Attribution Dashboard

**Files:**
- Create: `grafana/dashboards/signal-attribution.json`

**Step 1: Create the dashboard JSON**

Create `grafana/dashboards/signal-attribution.json`:

```json
{
  "uid": "signal-attribution",
  "title": "Signal Attribution",
  "tags": ["cryptiga", "analysis"],
  "timezone": "browser",
  "editable": true,
  "graphTooltip": 1,
  "schemaVersion": 39,
  "version": 0,
  "refresh": "5m",
  "time": { "from": "now-30d", "to": "now" },
  "panels": [
    {
      "id": 1,
      "type": "table",
      "title": "Attribution by Signal Source",
      "description": "Performance of each signal source based on trades where that signal was present",
      "gridPos": { "x": 0, "y": 0, "w": 24, "h": 8 },
      "datasource": { "type": "postgres", "uid": "timescaledb" },
      "targets": [{
        "refId": "A",
        "rawSql": "WITH signal_trades AS ( SELECT t.*, s.value->>'source' AS signal_source, s.value->>'direction' AS signal_direction, (s.value->>'confidence')::int AS signal_confidence FROM trades t, jsonb_array_elements(t.signals_snapshot) AS s WHERE $__timeFilter(t.timestamp) ) SELECT signal_source AS \"Source\", COUNT(*) AS \"Trades\", COUNT(*) FILTER (WHERE side = 'sell') AS \"Closed\", ROUND(AVG(signal_confidence)) AS \"Avg Confidence\", COUNT(DISTINCT coin) AS \"Coins\" FROM signal_trades GROUP BY signal_source ORDER BY \"Trades\" DESC",
        "format": "table"
      }],
      "fieldConfig": { "defaults": {}, "overrides": [] },
      "options": {}
    },
    {
      "id": 2,
      "type": "barchart",
      "title": "Trade Count by Signal Source",
      "gridPos": { "x": 0, "y": 8, "w": 12, "h": 8 },
      "datasource": { "type": "postgres", "uid": "timescaledb" },
      "targets": [{
        "refId": "A",
        "rawSql": "WITH signal_trades AS ( SELECT s.value->>'source' AS source FROM trades t, jsonb_array_elements(t.signals_snapshot) AS s WHERE $__timeFilter(t.timestamp) ) SELECT source AS \"Source\", COUNT(*) AS \"Trades\" FROM signal_trades GROUP BY source ORDER BY \"Trades\" DESC",
        "format": "table"
      }],
      "fieldConfig": { "defaults": { "color": { "mode": "palette-classic" } }, "overrides": [] },
      "options": {}
    },
    {
      "id": 3,
      "type": "barchart",
      "title": "Realized P&L by Coin",
      "gridPos": { "x": 12, "y": 8, "w": 12, "h": 8 },
      "datasource": { "type": "postgres", "uid": "timescaledb" },
      "targets": [{
        "refId": "A",
        "rawSql": "SELECT coin AS \"Coin\", ROUND(SUM(realized_pnl)::numeric, 2) AS \"Total P&L\" FROM positions WHERE closed_at IS NOT NULL AND $__timeFilter(closed_at) GROUP BY coin ORDER BY \"Total P&L\" DESC",
        "format": "table"
      }],
      "fieldConfig": {
        "defaults": {
          "color": { "mode": "palette-classic" },
          "thresholds": {
            "mode": "absolute",
            "steps": [
              { "color": "red", "value": null },
              { "color": "green", "value": 0 }
            ]
          }
        },
        "overrides": []
      },
      "options": {}
    },
    {
      "id": 4,
      "type": "timeseries",
      "title": "Signal Frequency by Source Over Time",
      "gridPos": { "x": 0, "y": 16, "w": 24, "h": 8 },
      "datasource": { "type": "postgres", "uid": "timescaledb" },
      "targets": [{
        "refId": "A",
        "rawSql": "SELECT time_bucket('1 day', timestamp) AS time, source AS metric, COUNT(*) AS value FROM signals WHERE $__timeFilter(timestamp) GROUP BY 1, source ORDER BY 1",
        "format": "time_series"
      }],
      "fieldConfig": { "defaults": { "custom": { "drawStyle": "bars", "fillOpacity": 80, "stacking": { "mode": "normal" } } }, "overrides": [] },
      "options": {}
    },
    {
      "id": 5,
      "type": "timeseries",
      "title": "Cumulative P&L",
      "gridPos": { "x": 0, "y": 24, "w": 24, "h": 8 },
      "datasource": { "type": "postgres", "uid": "timescaledb" },
      "targets": [{
        "refId": "A",
        "rawSql": "SELECT closed_at AS time, SUM(realized_pnl) OVER (ORDER BY closed_at) AS \"Cumulative P&L\" FROM positions WHERE closed_at IS NOT NULL AND $__timeFilter(closed_at) ORDER BY closed_at",
        "format": "time_series"
      }],
      "fieldConfig": {
        "defaults": {
          "unit": "currencyUSD",
          "custom": { "fillOpacity": 10 },
          "thresholds": {
            "mode": "absolute",
            "steps": [
              { "color": "red", "value": null },
              { "color": "green", "value": 0 }
            ]
          },
          "color": { "mode": "thresholds" }
        },
        "overrides": []
      },
      "options": {}
    }
  ],
  "templating": { "list": [] },
  "annotations": { "list": [] }
}
```

**Step 2: Verify and commit**

Open `http://localhost:3000/d/signal-attribution`.

```bash
cd /Users/ishomakhov/projects/cryptiga/ui
git add grafana/dashboards/signal-attribution.json
git commit -m "feat: add Signal Attribution dashboard"
```

---

### Task 7: Integration Test

**Step 1: Start the full stack**

```bash
cd /Users/ishomakhov/projects/cryptiga/core
docker compose -f docker-compose.yml -f ../ui/docker-compose.grafana.yml up --build -d
```

**Step 2: Wait for services to start**

Wait ~30 seconds for all services to boot and start collecting data.

```bash
docker compose -f docker-compose.yml -f ../ui/docker-compose.grafana.yml ps
```

Expected: All services show `Up` or `running`.

**Step 3: Verify Grafana dashboards**

Open `http://localhost:3000`. Navigate to each dashboard:

1. `http://localhost:3000/d/system-health` — Should show row counts increasing
2. `http://localhost:3000/d/portfolio-trades` — Portfolio stats and trade table
3. `http://localhost:3000/d/active-signals` — Active signals table and charts
4. `http://localhost:3000/d/price-onchain` — Candlestick chart and on-chain metrics
5. `http://localhost:3000/d/signal-attribution` — Attribution analysis

All dashboards should load without query errors. Panels may show "No data" until enough data has been collected — that is expected.

**Step 4: Verify data is flowing**

After 2-3 minutes, check that data appears:

```bash
docker compose -f docker-compose.yml -f ../ui/docker-compose.grafana.yml exec timescaledb psql -U cryptiga -c "SELECT 'candles' AS tbl, COUNT(*) FROM price_candles UNION ALL SELECT 'signals', COUNT(*) FROM signals UNION ALL SELECT 'on_chain', COUNT(*) FROM on_chain_metrics UNION ALL SELECT 'trades', COUNT(*) FROM trades;"
```

Expected: candles and on_chain should have rows after the first collection cycle.

**Step 5: Tear down**

```bash
docker compose -f docker-compose.yml -f ../ui/docker-compose.grafana.yml down
```

**Step 6: Final commit and push**

```bash
cd /Users/ishomakhov/projects/cryptiga/ui
git add -A
git commit -m "chore: integration verification complete"
git push origin main
```
