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
