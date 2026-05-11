
/** @type {import('next').NextConfig} */
const catalogueStaticImageBaseUrl =
  process.env.CATALOGUE_STATIC_IMAGE_BASE_URL ||
  'https://raw.githubusercontent.com/dev2495/marble-park-final/main/apps/web/public/catalogue-images';

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['lucide-react'],
  images: {
    domains: ['localhost'],
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/graphql',
  },
  async rewrites() {
    return [
      {
        source: '/catalogue-images/:path((?!imports/|manual/).*)',
        destination: `${catalogueStaticImageBaseUrl}/:path`,
      },
    ];
  },
};

module.exports = nextConfig;
