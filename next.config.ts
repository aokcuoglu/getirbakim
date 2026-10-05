import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: { cpus: 2 },
  async redirects() {
    return [
      { source: "/tr", destination: "/", permanent: true },
      { source: "/en", destination: "/", permanent: true },
      { source: "/:locale(tr|en)/admin/:path*", destination: "/yonetim", permanent: true },
      { source: "/:locale(tr|en)/search", destination: "/katalog", permanent: true },
      { source: "/:locale(tr|en)/:path*", destination: "/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
