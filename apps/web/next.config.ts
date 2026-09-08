import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The shared domain package ships ESM from dist; let Next bundle it.
  transpilePackages: ['@faregate/shared'],
  // The gateway URL is public configuration: it is where the browser talks to.
  env: {
    NEXT_PUBLIC_FAREGATE_GATEWAY_URL:
      process.env.NEXT_PUBLIC_FAREGATE_GATEWAY_URL ?? 'http://localhost:8402',
  },
};

export default nextConfig;
