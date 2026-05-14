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
              // Scripts: blob: for workers, CDN for Monaco AMD loader
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' blob: https://cdn.jsdelivr.net",
              "script-src-elem 'self' 'unsafe-inline' blob: https://cdn.jsdelivr.net",
              // Styles: CDN for Monaco editor.main.css
              "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
              "style-src-elem 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
              "connect-src 'self' https: wss:",
              "img-src 'self' data: https:",
              "font-src 'self' data: https://cdn.jsdelivr.net",
              // Monaco Web Workers use blob: URLs
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
