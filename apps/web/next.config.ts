import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The shared domain package ships ESM from dist; let Next bundle it.
  transpilePackages: ['@faregate/shared'],
  // The gateway URL is public configuration: it is where the browser talks to.
  env: {
    NEXT_PUBLIC_FAREGATE_GATEWAY_URL:
      process.env.NEXT_PUBLIC_FAREGATE_GATEWAY_URL ?? 'http://localhost:8402',
  },
  // The console asks a wallet to sign approvals, so no other site may frame it
  // and steer a click onto Approve. The rest is standard hardening.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
