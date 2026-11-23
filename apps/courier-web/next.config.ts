import type { NextConfig } from 'next';
const backend = process.env.API_INTERNAL_ORIGIN || 'http://127.0.0.1:5200';
const config: NextConfig = {
  transpilePackages: ['@porden/sdk', '@porden/contracts'],
  async rewrites() {
    return ['/api/:path*', '/runtime/:path*', '/.well-known/:path*', '/agent-manifest.json', '/links.json',
      '/agent-mcp.json', '/courier.network.json', '/actions.js', '/action-policy.json', '/action-bridge.html']
      .map(source => ({source, destination: `${backend}${source}`}));
  },
};
export default config;
