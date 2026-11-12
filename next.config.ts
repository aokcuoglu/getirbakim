import { join } from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Several app tasks run the same image (AWS). One build id per release lets a browser that loaded an older
  // release detect the skew and reload instead of calling server actions or chunks that no longer exist.
  deploymentId: process.env.BUILD_VERSION,
  // The incremental cache lives in Valkey so a revalidation reaches every task (see cache-handler.mjs); the
  // per-process memory layer is off so no task keeps serving its own stale copy.
  cacheHandler: join(process.cwd(), "cache-handler.mjs"),
  cacheMaxMemorySize: 0,
  // Manual supplier lists are uploaded as xlsx through a server action (up to 8 MB, /yonetim/tedarikciler/manuel).
  experimental: { cpus: 2, serverActions: { bodySizeLimit: "10mb" } },
  // The edge nginx and Cloudflare compress responses; gzip here spent the app container's CPU on every page.
  compress: false,
  // public/ files default to max-age=0, so the CDN revalidates every logo with the origin.
  async headers() {
    const cache = [{ key: "Cache-Control", value: "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800" }];
    return [
      { source: "/media/:path*", headers: cache },
      { source: "/brand/:path*", headers: cache },
    ];
  },
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
