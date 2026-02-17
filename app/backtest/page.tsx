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

          {/* Technical Indicators */}
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
