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
              // blob: and cdn.jsdelivr.net required for Monaco Editor
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' blob: https://cdn.jsdelivr.net",
              // script-src-elem must also allow the CDN (Chrome uses this for <script src=...>)
              "script-src-elem 'self' 'unsafe-inline' blob: https://cdn.jsdelivr.net",
              "style-src 'self' 'unsafe-inline'",
              "connect-src 'self' https: wss:",
              "img-src 'self' data: https:",
              "font-src 'self' data: https://cdn.jsdelivr.net",
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
