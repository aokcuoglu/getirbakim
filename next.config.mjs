import createNextIntlPlugin from 'next-intl/plugin';
import bundleAnalyzer from '@next/bundle-analyzer';

const withNextIntl = createNextIntlPlugin('./lib/i18n.ts');
const withBundleAnalyzer = bundleAnalyzer({
    enabled: process.env.ANALYZE === 'true',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'standalone',
    reactStrictMode: true,
    serverExternalPackages: ['pg', '@prisma/adapter-pg', 'undici'],
    serverActions: {
        // Allow both apex and www hostnames when nginx/proxy forwards a different Host header.
        allowedOrigins: [
            'getirbakim.com',
            'www.getirbakim.com',
            'localhost:3000',
            'localhost:3001',
        ],
    },
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
                protocol: 'https',
                hostname: 'fbhvayopjuixbyddftbk.supabase.co',
            },
        ],
        // Performance optimizations
        formats: ['image/avif', 'image/webp'],
        deviceSizes: [640, 750, 828, 1080, 1200, 1920],
        imageSizes: [16, 32, 48, 64, 96, 128, 256],
    },
    experimental: {
        optimizeCss: false, // Reduces CSS bundle size
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
};

export default withBundleAnalyzer(withNextIntl(nextConfig));
