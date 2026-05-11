import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // Proxy all /api/* calls (except Next.js API routes) to the backend
      {
        source: '/api/:path*',
        destination: `${process.env.BACKEND_URL ?? 'http://localhost:4000'}/api/:path*`,
        has: [{ type: 'header', key: 'x-skip-rewrite', missing: true }],
      },
    ];
  },
};

export default nextConfig;
