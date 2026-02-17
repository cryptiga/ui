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
