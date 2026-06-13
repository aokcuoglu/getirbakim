import createNextIntlPlugin from 'next-intl/plugin';
import bundleAnalyzer from '@next/bundle-analyzer';
import { withSentryConfig } from '@sentry/nextjs';

const withNextIntl = createNextIntlPlugin('./lib/i18n.ts');
const withBundleAnalyzer = bundleAnalyzer({
    enabled: process.env.ANALYZE === 'true',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'standalone',
    reactStrictMode: true,
    serverExternalPackages: ['pg', '@prisma/adapter-pg', 'undici'],
    typescript: {
        ignoreBuildErrors: true, // For smoother migration
    },
    images: {
        remotePatterns: [
            {
                protocol: "https",
                hostname: "imgkokpit.dinamik.online",
                pathname: "/**",
            },
            {
                protocol: 'https',
                hostname: 'b2b-admin.setafilter.com.tr',
                pathname: '/**',
            },
            {
                protocol: 'https',
                hostname: 'picdn.trodo.com',
            },
            {
                protocol: 'https',
                hostname: 'www.parts2world.com',
            },
            {
                protocol: 'https',
                hostname: 'mwpvcakzuo0x1ytc.public.blob.vercel-storage.com',
            },
            {
                protocol: 'http',
                hostname: 'localhost',
                port: '3001',
                pathname: '/api/storage/**',
            },
        ],
        // Performance optimizations
        formats: ['image/avif', 'image/webp'],
        deviceSizes: [640, 750, 828, 1080, 1200, 1920],
        imageSizes: [16, 32, 48, 64, 96, 128, 256],
    },
    experimental: {
        optimizeCss: false,
        serverActions: {
            allowedOrigins: [
                'getirbakim.com',
                'www.getirbakim.com',
                'localhost:3000',
                'localhost:3001',
            ],
        },
    },
    onDemandEntries: {
        maxInactiveAge: 120 * 1000,
        pagesBufferLength: 5,
    },
    async redirects() {
        return [
            {
                source: '/:locale/:slug-:id(\\d+)/:rest*',
                destination: '/:locale/:slug/:rest*',
                permanent: true,
            },
            {
                source: '/:locale/:slug-:id(\\d+)',
                destination: '/:locale/:slug',
                permanent: true,
            },
            {
                source: '/:slug-:id(\\d+)/:rest*',
                destination: '/:slug/:rest*',
                permanent: true,
            },
            {
                source: '/:slug-:id(\\d+)',
                destination: '/:slug',
                permanent: true,
            },
        ];
    },
    async rewrites() {
        return [];
    },
};

const sentryConfig = withBundleAnalyzer(withNextIntl(nextConfig));

export default withSentryConfig(sentryConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "plantx-ye",

  project: "getirbakim",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
