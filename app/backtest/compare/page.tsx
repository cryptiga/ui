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
  params: Record<string, number | string>;
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
  const [error, setError] = useState("");

  useEffect(() => {
    const ids = searchParams.get("ids")?.split(",") || [];
    if (ids.length < 2) {
      setLoading(false);
      return;
    }
    Promise.all(
      ids.map((id) =>
        fetch(`/api/backtest/runs/${id}`).then((r) => {
          if (!r.ok) throw new Error(`Failed to fetch run ${id}: HTTP ${r.status}`);
          return r.json();
        })
      )
    )
      .then(setRuns)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [searchParams]);

  if (loading) return <p className="text-gray-400">Loading...</p>;
  if (error) return <div className="p-4 bg-red-900/50 border border-red-700 rounded-lg text-red-300">{error}</div>;
  if (runs.length < 2) return <p className="text-gray-400">Select at least 2 runs to compare.</p>;

  // Merge equity curves for overlay chart
  const timeMap = new Map<string, Record<string, number | string>>();

  runs.forEach((run, idx) => {
    const label = run.name || `Run ${idx + 1}`;
    for (const point of run.results.equity_curve) {
      if (!timeMap.has(point.time)) {
        timeMap.set(point.time, { time: point.time });
      }
      timeMap.get(point.time)![label] = point.value;
    }
  });
  const mergedCurve = Array.from(timeMap.keys())
    .sort()
    .map((t) => timeMap.get(t)!);

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
                    {m.fmt((r.results as unknown as Record<string, number>)[m.key])}
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
