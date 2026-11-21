import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Several app tasks run the same image (AWS). One build id per release lets a browser that loaded an older
  // release detect the skew and reload instead of calling server actions or chunks that no longer exist.
  deploymentId: process.env.BUILD_VERSION,
  // Shown in the storefront footer and the /yonetim sidebar (#628, src/lib/app-version.ts). Inlined at build time:
  // the runtime image does not carry BUILD_VERSION. Only the package version and the commit id reach the bundle.
  env: {
    APP_VERSION: (JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version: string }).version,
    APP_BUILD: process.env.BUILD_VERSION ?? "",
  },
  // The incremental cache lives in Valkey so a revalidation reaches every task (see cache-handler.mjs); the
  // per-process memory layer is off so no task keeps serving its own stale copy.
  cacheHandler: join(process.cwd(), "cache-handler.mjs"),
  cacheMaxMemorySize: 0,
  // Manual supplier lists are uploaded as xlsx through a server action (up to 8 MB, /yonetim/tedarikciler/manuel).
  experimental: { cpus: 2, serverActions: { bodySizeLimit: "10mb" } },
  // Product and category images go through /_next/image (#737): resized WebP instead of the original upload. Only the
  // media routes may be optimized (localPatterns); logos and SVG icons stay unoptimized. The optimized files live in each
  // task's own .next/cache/images (a disk LRU); customCacheHandler stays off so they never reach Valkey. Media objects are
  // content-addressed (sha256 unique), so a long TTL is safe.
  images: {
    localPatterns: [
      { pathname: "/api/product-media/**", search: "" },
      { pathname: "/api/category-media/**", search: "" },
      { pathname: "/media/**", search: "" },
    ],
    formats: ["image/webp"],
    qualities: [75],
    deviceSizes: [640, 828, 1200, 1920],
    imageSizes: [96, 144, 192, 288, 384, 480],
    minimumCacheTTL: 2_678_400,
    maximumDiskCacheSize: 2_000_000_000,
    maximumResponseBody: 11_000_000,
  },
  // On AWS nothing in front compresses pages: CloudFront's caching-disabled policy cannot, so 600-800 KB of HTML
  // went out raw (#453). The VPS edge nginx and Cloudflare leave an already compressed response as it is.
  compress: true,
  // Security headers go on every response. public/ files default to max-age=0, so the CDN would revalidate every
  // logo with the origin: /media and /brand get a 1-day browser / 7-day CDN cache (bare URLs and ?v= logos keep
  // it). Only the build's own ?dpl=<BUILD_VERSION> (appended by next/image through deploymentId) is immutable:
  // Next does not route on dpl, so during a rolling deploy an old task may serve old content under a new dpl, and
  // any other dpl value must not be cached for a year. The no-referrer entries come last because config headers
  // win over the same header set in route handlers (payment and order-access routes send no-referrer themselves).
  async headers() {
    const security = [
      { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    ];
    const noReferrer = [{ key: "Referrer-Policy", value: "no-referrer" }];
    const cache = [{ key: "Cache-Control", value: "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800" }];
    const immutable = [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }];
    const build = process.env.BUILD_VERSION;
    // Next anchors a has value as ^...$ and reads it as a regex, so the build id is escaped.
    const thisBuild = build
      ? [{ type: "query" as const, key: "dpl", value: build.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") }]
      : undefined;
    return [
      { source: "/:path*", headers: security },
      { source: "/media/:path*", headers: cache },
      { source: "/brand/:path*", headers: cache },
      ...(thisBuild
        ? [
            { source: "/media/:path*", has: thisBuild, headers: immutable },
            { source: "/brand/:path*", has: thisBuild, headers: immutable },
          ]
        : []),
      { source: "/api/payments/tami/:path*", headers: noReferrer },
      { source: "/siparis/:id/erisim", headers: noReferrer },
    ];
  },
  async redirects() {
    return [
      { source: "/tr", destination: "/", permanent: true },
      { source: "/en", destination: "/", permanent: true },
      { source: "/:locale(tr|en)/admin/:path*", destination: "/yonetim", permanent: true },
      { source: "/:locale(tr|en)/search", destination: "/katalog", permanent: true },
      { source: "/:locale(tr|en)/:path*", destination: "/:path*", permanent: true },
      // The bare roots of the listing paths (#638); the old listing addresses move in src/proxy.ts.
      { source: "/yedek-parca", destination: "/arac-markalari", statusCode: 301 },
      { source: "/kategori", destination: "/katalog", statusCode: 301 },
    ];
  },
  // The IndexNow key file /<key>.txt (#645, src/app/api/indexnow/[key]/route.ts). An afterFiles rewrite: robots.txt,
  // llms.txt and public/ files are served first, and no root [key] route spoils the 404 of unknown single-segment paths.
  async rewrites() {
    return [{ source: "/:key([A-Za-z0-9-]{8,128})\\.txt", destination: "/api/indexnow/:key" }];
  },
};

export default nextConfig;
