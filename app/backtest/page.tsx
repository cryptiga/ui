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

const SYMBOLS = [
  "BTC/USD", "ETH/USD", "SOL/USD", "DOGE/USD",
  "ADA/USD", "AVAX/USD", "LINK/USD", "DOT/USD",
];

const TIMEFRAMES = [
  { value: "1m", label: "1 min" },
  { value: "5m", label: "5 min" },
  { value: "15m", label: "15 min" },
  { value: "1h", label: "1 hour" },
  { value: "4h", label: "4 hour" },
  { value: "1d", label: "1 day" },
];

type Params = {
  name: string;
  symbol: string;
  timeframe: string;
  days: number;
  capital: number;
  position_size_pct: number;
  use_rsi: boolean;
  rsi_period: number;
  rsi_oversold: number;
  rsi_overbought: number;
  use_macd: boolean;
  macd_fast: number;
  macd_slow: number;
  macd_signal: number;
  use_sma: boolean;
  sma_short: number;
  sma_long: number;
  stop_loss_pct: number | null;
  take_profit_pct: number | null;
};

const DEFAULTS: Params = {
  name: "",
  symbol: "BTC/USD",
  timeframe: "1h",
  days: 90,
  capital: 1000,
  position_size_pct: 20,
  use_rsi: true,
  rsi_period: 14,
  rsi_oversold: 30,
  rsi_overbought: 70,
  use_macd: true,
  macd_fast: 12,
  macd_slow: 26,
  macd_signal: 9,
  use_sma: true,
  sma_short: 10,
  sma_long: 20,
  stop_loss_pct: null,
  take_profit_pct: null,
};

const PRESETS: Record<string, { label: string; description: string; params: Partial<Params> }> = {
  default: {
    label: "Default",
    description: "Balanced RSI + MACD + SMA",
    params: {},
  },
  conservative: {
    label: "Conservative",
    description: "Tight stops, smaller positions",
    params: {
      position_size_pct: 10,
      rsi_oversold: 25,
      rsi_overbought: 75,
      sma_short: 20,
      sma_long: 50,
      stop_loss_pct: 3,
      take_profit_pct: 8,
    },
  },
  aggressive: {
    label: "Aggressive",
    description: "Large positions, wide thresholds",
    params: {
      position_size_pct: 40,
      rsi_oversold: 35,
      rsi_overbought: 65,
      sma_short: 5,
      sma_long: 15,
      stop_loss_pct: null,
      take_profit_pct: null,
    },
  },
  trend: {
    label: "Trend Following",
    description: "SMA crossovers only, no RSI",
    params: {
      use_rsi: false,
      use_macd: true,
      use_sma: true,
      sma_short: 10,
      sma_long: 30,
      stop_loss_pct: 5,
      take_profit_pct: 15,
    },
  },
  momentum: {
    label: "Momentum",
    description: "RSI + MACD, no SMA",
    params: {
      use_rsi: true,
      use_macd: true,
      use_sma: false,
      rsi_period: 10,
      rsi_oversold: 25,
      rsi_overbought: 75,
      macd_fast: 8,
      macd_slow: 21,
      macd_signal: 5,
      stop_loss_pct: 4,
      take_profit_pct: 10,
    },
  },
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
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <label className={`block ${disabled ? "opacity-40" : ""}`}>
      <span className="text-sm text-gray-400">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step || 1}
        disabled={disabled}
        className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-gray-100 focus:border-blue-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
      />
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <div
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition ${checked ? "bg-blue-600" : "bg-gray-700"}`}
      >
        <div
          className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${checked ? "translate-x-4" : ""}`}
        />
      </div>
      <span className="text-sm text-gray-300">{label}</span>
    </label>
  );
}

export default function BacktestPage() {
  const [params, setParams] = useState<Params>({ ...DEFAULTS });
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activePreset, setActivePreset] = useState("default");

  const set = (key: string, value: number | string | boolean | null) =>
    setParams((p) => ({ ...p, [key]: value }));

  function applyPreset(key: string) {
    const preset = PRESETS[key];
    if (!preset) return;
    setActivePreset(key);
    setParams({ ...DEFAULTS, name: params.name, symbol: params.symbol, timeframe: params.timeframe, days: params.days, capital: params.capital, ...preset.params });
  }

  function resetDefaults() {
    setParams({ ...DEFAULTS });
    setActivePreset("default");
  }

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
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
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

        {/* Presets */}
        <div className="mb-6">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-gray-400">Presets:</span>
            {Object.entries(PRESETS).map(([key, preset]) => (
              <button
                key={key}
                onClick={() => applyPreset(key)}
                title={preset.description}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                  activePreset === key
                    ? "bg-blue-600 text-white"
                    : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                }`}
              >
                {preset.label}
              </button>
            ))}
            <button
              onClick={resetDefaults}
              className="px-3 py-1.5 rounded-lg text-sm text-gray-500 hover:text-gray-300 transition"
            >
              Reset
            </button>
          </div>
        </div>

        {/* Parameter Form */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
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
                {SYMBOLS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm text-gray-400">Timeframe</span>
              <select
                value={params.timeframe}
                onChange={(e) => set("timeframe", e.target.value)}
                className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-gray-100"
              >
                {TIMEFRAMES.map((tf) => (
                  <option key={tf.value} value={tf.value}>{tf.label}</option>
                ))}
              </select>
            </label>
            <NumberInput label="Lookback Days" value={params.days} onChange={(v) => set("days", v)} min={7} max={365} />
            <NumberInput label="Starting Capital ($)" value={params.capital} onChange={(v) => set("capital", v)} min={100} step={100} />
          </div>

          {/* Strategy */}
          <div className="bg-gray-900 p-4 rounded-lg space-y-3">
            <h2 className="font-semibold text-gray-300 mb-2">Strategy</h2>
            <NumberInput label="Position Size %" value={params.position_size_pct} onChange={(v) => set("position_size_pct", v)} min={1} max={100} />
            <div className="pt-2 border-t border-gray-800">
              <h3 className="text-sm text-gray-400 mb-2">Risk Management</h3>
              <label className="flex items-center gap-2 mb-2">
                <input
                  type="checkbox"
                  checked={params.stop_loss_pct !== null}
                  onChange={(e) => set("stop_loss_pct", e.target.checked ? 5 : null)}
                  className="rounded"
                />
                <span className="text-sm text-gray-300">Stop Loss</span>
              </label>
              {params.stop_loss_pct !== null && (
                <NumberInput label="Stop Loss %" value={params.stop_loss_pct} onChange={(v) => set("stop_loss_pct", v)} min={0.5} max={50} step={0.5} />
              )}
              <label className="flex items-center gap-2 mb-2 mt-2">
                <input
                  type="checkbox"
                  checked={params.take_profit_pct !== null}
                  onChange={(e) => set("take_profit_pct", e.target.checked ? 10 : null)}
                  className="rounded"
                />
                <span className="text-sm text-gray-300">Take Profit</span>
              </label>
              {params.take_profit_pct !== null && (
                <NumberInput label="Take Profit %" value={params.take_profit_pct} onChange={(v) => set("take_profit_pct", v)} min={1} max={100} step={0.5} />
              )}
            </div>
          </div>

          {/* RSI + SMA */}
          <div className="bg-gray-900 p-4 rounded-lg space-y-3">
            <h2 className="font-semibold text-gray-300 mb-2">Indicators</h2>
            <Toggle label="RSI" checked={params.use_rsi} onChange={(v) => set("use_rsi", v)} />
            <NumberInput label="RSI Period" value={params.rsi_period} onChange={(v) => set("rsi_period", v)} min={2} max={50} disabled={!params.use_rsi} />
            <NumberInput label="RSI Oversold" value={params.rsi_oversold} onChange={(v) => set("rsi_oversold", v)} min={5} max={50} disabled={!params.use_rsi} />
            <NumberInput label="RSI Overbought" value={params.rsi_overbought} onChange={(v) => set("rsi_overbought", v)} min={50} max={95} disabled={!params.use_rsi} />
            <div className="pt-2 border-t border-gray-800" />
            <Toggle label="SMA Crossover" checked={params.use_sma} onChange={(v) => set("use_sma", v)} />
            <NumberInput label="SMA Short" value={params.sma_short} onChange={(v) => set("sma_short", v)} min={2} max={50} disabled={!params.use_sma} />
            <NumberInput label="SMA Long" value={params.sma_long} onChange={(v) => set("sma_long", v)} min={5} max={200} disabled={!params.use_sma} />
          </div>

          {/* MACD */}
          <div className="bg-gray-900 p-4 rounded-lg space-y-3">
            <h2 className="font-semibold text-gray-300 mb-2">MACD</h2>
            <Toggle label="MACD" checked={params.use_macd} onChange={(v) => set("use_macd", v)} />
            <NumberInput label="Fast" value={params.macd_fast} onChange={(v) => set("macd_fast", v)} min={2} max={50} disabled={!params.use_macd} />
            <NumberInput label="Slow" value={params.macd_slow} onChange={(v) => set("macd_slow", v)} min={5} max={100} disabled={!params.use_macd} />
            <NumberInput label="Signal" value={params.macd_signal} onChange={(v) => set("macd_signal", v)} min={2} max={50} disabled={!params.use_macd} />
          </div>
        </div>

        {!params.use_rsi && !params.use_macd && !params.use_sma && (
          <div className="mb-4 p-3 bg-yellow-900/30 border border-yellow-700/50 rounded-lg text-yellow-300 text-sm">
            No indicators enabled. Enable at least one indicator to generate trading signals.
          </div>
        )}

        <button
          onClick={runBacktest}
          disabled={loading || (!params.use_rsi && !params.use_macd && !params.use_sma)}
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
