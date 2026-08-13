
const catalogueOrigin = (() => {
  try { return new URL(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/graphql'); }
  catch { return new URL('http://localhost:4000/graphql'); }
})();
const managedImageOrigin = (() => {
  try { return new URL(process.env.NEXT_PUBLIC_CATALOGUE_IMAGE_ORIGIN || catalogueOrigin.origin); }
  catch { return catalogueOrigin; }
})();

const imagePattern = (url) => ({
  protocol: url.protocol.replace(':', ''),
  hostname: url.hostname,
  port: url.port,
  pathname: '/catalogue-images/manual/**',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['lucide-react'],
  images: {
    domains: ['localhost', 'api-production-bc49.up.railway.app'],
    remotePatterns: [imagePattern(catalogueOrigin), imagePattern(managedImageOrigin)],
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/graphql',
    NEXT_PUBLIC_CATALOGUE_IMAGE_ORIGIN: managedImageOrigin.origin,
  },
  async headers() {
    return [
      {
        source: '/login',
        headers: [{ key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, max-age=0' }],
      },
      {
        source: '/reset-password',
        headers: [{ key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, max-age=0' }],
      },
    ];
  },
};

module.exports = nextConfig;
