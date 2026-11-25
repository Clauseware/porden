import type { NextConfig } from 'next';
const backend = process.env.PORDEN_API_INTERNAL_ORIGIN || 'http://127.0.0.1:5300';
const config: NextConfig = {
  transpilePackages: ['@porden/sdk', '@porden/contracts'],
  async rewrites() {
    return [
      { source: '/api/v2/:path*', destination: `${backend}/api/v2/:path*` },
      { source: '/.well-known/jwks.json', destination: `${backend}/.well-known/jwks.json` },
    ];
  },
};
export default config;
