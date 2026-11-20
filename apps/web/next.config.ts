import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    const api = (process.env.SHANRAIL_API_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
    return [
      { source: '/rail-api/auth/:path*', destination: api + '/auth/:path*' },
      { source: '/rail-api/admin/:path*', destination: api + '/admin/:path*' },
    ];
  },
  experimental: { useTypeScriptCli: false },
};

export default nextConfig;
