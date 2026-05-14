/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // blob: required for Monaco Editor Web Workers
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' blob:",
              "style-src 'self' 'unsafe-inline'",
              "connect-src 'self' https: wss:",
              "img-src 'self' data: https:",
              "font-src 'self' data:",
              // Monaco Editor spawns language-service workers from blob: URLs
              "worker-src blob:",
              "child-src blob:",
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
