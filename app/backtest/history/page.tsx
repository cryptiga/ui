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
